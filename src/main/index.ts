import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { RealHermes } from './hermes/real';
import { Wizard } from './wizard';
import { createTileWindow, createWizardWindow } from './windows';
import { AcpClient } from './acp';
import { openingMessage } from './orchestrator/opening';
import type { Character } from '../shared/types';
import { readStartup } from './startup';
import { readTileState, stateFor, withActiveSession, writeTileState } from './tileState';

app.setName('Circe');

let wizardWin: BrowserWindow | null = null;
let tileWin: BrowserWindow | null = null;
let acp: AcpClient | null = null;
let hermes: RealHermes;
let wizard: Wizard | null = null;
/**
 * The character and profile the tile was last opened with, kept so macOS's
 * `activate` can reopen it after a close. Null until onboarding has actually
 * written a persona, which is what makes it the "is onboarding done?" signal.
 */
let lastLaunch: { character: Character; profileId: string } | null = null;

/**
 * Only `https:` links may be handed to `shell.openExternal` — parsed, not
 * `startsWith`-checked, so `https:evil` or whitespace/case tricks can't slip
 * past a naive prefix test. The only caller today is a hardcoded literal,
 * but this is the one place in the app that can make the OS open an
 * arbitrary URI handler, so it stays defended even without a live exploit.
 */
function openExternalSafely(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    console.warn(`Refusing to open external link (unparseable URL): ${url}`);
    return;
  }
  if (parsed.protocol !== 'https:') {
    console.warn(`Refusing to open external link (non-https scheme): ${url}`);
    return;
  }
  void shell.openExternal(parsed.toString());
}

/**
 * Everything the tile needs to talk back to the user, held at module scope
 * because the IPC handlers that use it are registered exactly once (see
 * `registerIpc`) while the tile itself can be opened, closed, and — on macOS
 * — reopened from the dock. Registering the handlers per-launch instead would
 * mean a reopened tile sending every prompt twice.
 */
let tileLoaded = false;
let tileQueue: string[] = [];
/**
 * Resolves when the tile's renderer has registered its listeners. A replay is a
 * burst of `session/update` notifications arriving the moment `session/load`
 * is answered, and `sendTileUpdate` has no queue — so the load must not be
 * issued until there is something on the other end to draw it.
 */
let tileReady: Promise<void> = Promise.resolve();
/** The session the tile is currently showing. Updates for any other are dropped. */
let activeSessionId: string | null = null;

/**
 * `did-finish-load` fires only after the renderer's module script has run and
 * registered its listeners, so anything sent before that point is dropped on
 * the floor. Queue until the page has actually loaded, then flush in order.
 */
function sendToTile(text: string): void {
  if (!tileLoaded) {
    tileQueue.push(text);
    return;
  }
  // A prompt rejection can land after the user has already closed the tile,
  // and `close()` destroys the window before the `closed` handler nulls it.
  if (tileWin && !tileWin.isDestroyed()) tileWin.webContents.send('tile:opening', text);
}

/**
 * Circe's own lifecycle events ride the same channel as real ACP updates,
 * namespaced so they can never collide with a protocol `sessionUpdate` kind.
 * `circe/turn-end` is what tells the tile a reply is finished — ACP signals
 * that by resolving `session/prompt` with a `stopReason`, not by sending an
 * update, so the renderer has no way to know on its own.
 */
function sendTileUpdate(update: Record<string, unknown>): void {
  if (tileWin && !tileWin.isDestroyed()) tileWin.webContents.send('tile:update', update);
}

/**
 * Resumes the conversation this profile's tile was last on, or begins a new one.
 *
 * Hermes owns the conversation: `session/load` asks it to rehydrate from its own
 * store, and it replays the history back as updates. Circe uploads nothing and
 * keeps no copy — the id in `circe/state.json` is the whole of what it remembers.
 *
 * Every failure lands on the same answer, a fresh session, because a tile that
 * refuses to open because last week's conversation went missing is worse than
 * one that opens empty.
 */
async function restoreOrCreateSession(client: AcpClient, profileId: string): Promise<void> {
  const file = await readTileState(hermes);
  const saved = stateFor(file, profileId);
  const prior = saved.tabs[saved.activeIndex] ?? null;

  // `acp` can be reassigned to a later launch's client while any `await` below
  // is in flight (session/load and session/new each have a 30s ceiling, easily
  // long enough for the tile to be closed and reopened). Every write to the
  // module-level session state is guarded so a superseded launch never clobbers
  // the launch that replaced it.
  if (prior && client.canLoadSession) {
    if (acp !== client) return;
    activeSessionId = prior; // set first: the replay's updates carry this id
    await tileReady;
    if (acp !== client) return;
    sendTileUpdate({ sessionUpdate: 'circe/replay-start' });
    const resumed = await client.loadSession(prior);
    if (acp !== client) return;
    sendTileUpdate({ sessionUpdate: 'circe/replay-end' });
    if (resumed) return;
  }

  if (acp !== client) return;
  const sessionId = await client.newSession();
  if (acp !== client) return;
  activeSessionId = sessionId;
  await writeTileState(hermes, withActiveSession(file, profileId, activeSessionId));
}

/**
 * Opens the tile and starts the ACP session behind it. Wired to the wizard's
 * `launching` step, which `wizard.ts` only reaches once per run — but that's
 * an assumption about a module this function doesn't own, so the guard below
 * makes a second call a safe no-op. The macOS `activate` handler calls it
 * again deliberately, after the tile has been closed and `tileWin` is null.
 *
 * `start()` can reject — most likely the 30s handshake timeout in acp.ts. That
 * rejection does *not* kill the child process, so a caller that doesn't also
 * call `stop()` leaks a `hermes acp` process per failed start (Amendment 1).
 * On failure we reap the child and tell the user in the tile itself, through
 * the same `tile:opening` channel the greeting uses — one honest message with
 * the underlying error text attached, not a branch on which of acp.ts's three
 * failure strings came back.
 *
 * The wizard window closes either way (Amendment 2): a half-dismissed wizard
 * left open behind a broken tile is worse than a tile that clearly explains
 * it couldn't start. The tile is the one true state once launch begins; there
 * is no useful "back to the wizard" once the character has been handed off.
 */
async function launchTile(
  character: Character,
  profileId: string,
  greeting: string | null = null,
): Promise<void> {
  if (tileWin) return; // already launched; see the guard note above.

  lastLaunch = { character, profileId };
  tileWin = createTileWindow(character, profileId);

  tileLoaded = false;
  // The opening message belongs to the handoff out of onboarding and nowhere
  // else: it says "Right now I'm the only agent you have", which stops being
  // true the moment the orchestrator creates the first specialist. Reopening
  // a tile — from the dock, or on a later launch — must not replay it.
  tileQueue = greeting === null ? [] : [greeting];
  tileReady = new Promise<void>((resolve) => {
    const win = tileWin!;
    // `did-finish-load` is the happy path: it flushes the queued greeting and
    // marks the tile ready to draw. But a window can also fail to load
    // (`did-fail-load`) or be destroyed before it ever loads (`closed`) —
    // without an escape on those too, `await tileReady` downstream would hang
    // forever and "every failure path lands on a fresh session" would be a lie.
    // Resolving twice is harmless; only one of these three fires first.
    win.webContents.once('did-finish-load', () => {
      tileLoaded = true;
      for (const text of tileQueue.splice(0)) tileWin?.webContents.send('tile:opening', text);
      resolve();
    });
    win.webContents.once('did-fail-load', () => resolve());
    win.once('closed', () => resolve());
  });

  // Captured locally, not read back off the module-level `acp`: `start()` and
  // `restoreOrCreateSession()` below each await for up to 30s, easily enough
  // time for this tile to be closed and reopened from the dock, which spins up
  // a second `launchTile` call with its own client and reassigns `acp`. Every
  // access to *this* launch's client goes through `client`, and every write to
  // module-level session state is guarded with `acp === client` so a
  // superseded launch can never stop, or write over, the launch that replaced
  // it.
  const client = new AcpClient({
    profileId,
    onUpdate: (sessionId, u) => {
      if (acp !== client) return; // this launch has been superseded
      // One client can serve several sessions; only the one on screen is drawn.
      if (sessionId !== activeSessionId) return;
      sendTileUpdate(u as Record<string, unknown>);
    },
    onExit: (code) => {
      if (acp !== client) return; // the exit belongs to an already-replaced client
      sendTileUpdate({ sessionUpdate: 'circe/exited', code });
    },
  });
  acp = client;

  // `tile:close` (the in-app `×` button) stops the client, but the native
  // close button, Cmd+W, and `app.quit()` all bypass it entirely and go
  // straight to `close()`/`closed` — that's the far more instinctive way to
  // dismiss a floating window, and nothing on that path stopping the client
  // leaks a `hermes acp` process per close (Amendment 1's leak, reached a
  // different way). `closed` fires on every close path including the `×`
  // button's, so `stop()` must tolerate a second call: it does (a no-op
  // `child?.kill()` on an already-null child, an already-empty `pending` map
  // to reject), so no dedup is needed here.
  //
  // `client.stop()` always targets this launch's own client, closed window or
  // not — but the module-level `acp`/`activeSessionId` are only reset if this
  // launch is still the current one; a stale `closed` handler firing after a
  // fast reopen must not clear the new launch's live session.
  tileWin.on('closed', () => {
    client.stop();
    if (acp === client) {
      acp = null;
      activeSessionId = null;
    }
    tileWin = null;
  });

  try {
    await client.start();
    await restoreOrCreateSession(client, profileId);
  } catch (err) {
    client.stop();
    if (acp === client) {
      acp = null;
      activeSessionId = null;
      const message = err instanceof Error ? err.message : String(err);
      sendToTile(
        "I couldn't reach the Hermes agent behind this tile, so I can't respond yet. " +
          'Check that Hermes is installed and set up (`hermes setup` in a terminal), ' +
          `then close this tile and start over.\n\n(${message})`,
      );
    }
  }

  wizardWin?.close();
  wizardWin = null;
}

/** Creates the wizard and its window, and wires the one to the other. */
function openWizard(): void {
  const w = new Wizard(hermes);
  wizard = w;
  wizardWin = createWizardWindow();
  wizardWin.on('closed', () => {
    wizardWin = null;
  });

  // Both listeners bail if they no longer belong to the current wizard: a
  // derivation left in flight when the window was closed would otherwise
  // resolve into a *replacement* wizard's window.
  w.onChange((s) => {
    if (wizard !== w) return;
    if (wizardWin && !wizardWin.isDestroyed()) wizardWin.webContents.send('wizard:step', s);
  });
  w.onChange((s) => {
    if (wizard !== w) return;
    // `launching` now means "the persona and the skill are on disk" — the
    // wizard writes them *before* announcing it, so the agent this spawns
    // reads the character it is supposed to be. See `Wizard.commitAccept`.
    if (s.kind !== 'launching') return;
    void launchTile(s.character, s.profileId, openingMessage(s.character));
  });
}

/**
 * Registered once, for the life of the process. Every handler reads the
 * current `wizard`/`acp` rather than closing over one, so reopening a window
 * never doubles a subscription.
 */
function registerIpc(): void {
  ipcMain.on('wizard:ready', () => {
    if (!wizard) return;
    const w = wizard;
    if (wizardWin && !wizardWin.isDestroyed()) wizardWin.webContents.send('wizard:step', w.state);
    void w.start();
  });
  ipcMain.on('wizard:fandom', (_e, text: string) => void wizard?.submitFandom(text));
  ipcMain.on('wizard:retry', () => void wizard?.retryDerivation());
  ipcMain.on('wizard:accept', () => void wizard?.accept());
  ipcMain.on('wizard:confirm-claim', () => void wizard?.confirmClaimDefault());
  ipcMain.on('wizard:decline-claim', () => wizard?.declineClaimDefault());
  ipcMain.on('open-external', (_e, url: string) => openExternalSafely(url));

  ipcMain.on('tile:prompt', (_e, text: string) => {
    const client = acp;
    const sessionId = activeSessionId;
    if (!client || !sessionId) return;
    // A turn ends when `session/prompt` resolves — that is ACP's completion
    // signal (it answers with `{ stopReason }`), and it is what the working
    // prototype keys off too (renderer.js:591). Both outcomes end the turn,
    // so a failed prompt doesn't leave the previous bubble open forever.
    void client.prompt(sessionId, text).then(
      () => sendTileUpdate({ sessionUpdate: 'circe/turn-end' }),
      (err: unknown) => {
        sendTileUpdate({ sessionUpdate: 'circe/turn-end' });
        const message = err instanceof Error ? err.message : String(err);
        sendToTile(`Your message wasn't sent — the agent connection is down. (${message})`);
      },
    );
  });
  ipcMain.on('tile:close', () => {
    acp?.stop();
    tileWin?.close();
  });
}

async function boot(): Promise<void> {
  hermes = new RealHermes();
  registerIpc();

  // SOUL.md, not the record, decides whether onboarding has happened — so a
  // user who hand-edits their persona keeps their agent instead of being sent
  // back through a wizard whose next move is to overwrite it. Without this,
  // every cold start reopened onboarding no matter what was already on disk,
  // and re-deriving a character was the only route back to your own agent.
  const startup = await readStartup(hermes);
  if (startup.kind === 'tile') {
    await launchTile(startup.character, startup.profileId);
  } else {
    openWizard();
  }

  // macOS keeps the app alive with no windows (see `window-all-closed`), and
  // without this there was no way back in: closing the tile left Circe inert
  // in the dock, and relaunching from Finder did nothing — while the
  // `provider-missing` screen tells the user to "reopen Circe", which could
  // never work. What "reopen" means depends on how far onboarding got: once
  // the persona is written the tile *is* the app, so reopening it (a fresh
  // ACP session against the agent already on disk) is right, and re-running
  // the wizard would only offer to overwrite the persona it just wrote. If
  // onboarding never finished, nothing has been written and starting it over
  // is exactly what the user wants.
  app.on('activate', () => {
    const existing = tileWin ?? wizardWin;
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
      return;
    }
    if (lastLaunch) {
      void launchTile(lastLaunch.character, lastLaunch.profileId);
      return;
    }
    openWizard();
  });
}

app.whenReady().then(() => {
  void boot();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
