import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { RealHermes } from './hermes/real';
import { Wizard } from './wizard';
import { adaptTileWindow, createTileWindow, createWizardWindow } from './windows';
import { AcpClient } from './acp';
import { openingMessage } from './orchestrator/opening';
import { characterFor, readStartup } from './startup';
import { TileRegistry } from './tiles';

app.setName('Circe');

let wizardWin: BrowserWindow | null = null;
let hermes: RealHermes;
let wizard: Wizard | null = null;
let tiles: TileRegistry;

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
 * The registry owns every tile. `index.ts` keeps only what needs Electron:
 * the wizard, the IPC channels, and the app lifecycle.
 */
function createRegistry(): TileRegistry {
  return new TileRegistry({
    hermes,
    createWindow: (character, profileId) => adaptTileWindow(createTileWindow(character, profileId)),
    createClient: (opts) => new AcpClient(opts),
  });
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
    void tiles.launch(s.character, s.profileId, openingMessage(s.character));
    // The handoff is done as soon as the tile is launched, not after the
    // first agent turn: that turn can legitimately run for minutes, and a
    // wizard sitting on screen for the length of the first reply is not a
    // handoff. The registry doesn't know a wizard exists, so this happens
    // at the call site instead of inside `launch`.
    wizardWin?.close();
    wizardWin = null;
  });
}

/**
 * Registered once, for the life of the process. Every handler reads the
 * current `wizard`/`tiles` rather than closing over one, so reopening a
 * window never doubles a subscription.
 */
let ipcRegistered = false;
function registerIpc(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;

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

  // Routed by sender, never by a profile id the renderer supplies: a tile
  // renders unsanitized agent output into a window holding `send()`, so a
  // renderer that could name its own profile could name someone else's.
  ipcMain.on('tile:prompt', (e, text: string) => {
    const profileId = tiles.profileForSender(e.sender);
    if (profileId === null) return;
    void tiles.prompt(profileId, text);
  });
  ipcMain.on('tile:close', (e) => {
    const profileId = tiles.profileForSender(e.sender);
    if (profileId === null) return;
    tiles.close(profileId);
  });
}

// `activate` re-runs `boot()` when nothing is open (see below), and `boot()`
// used to register this handler itself — so every "reopen with nothing open"
// cycle stacked a second `activate` listener, which on the *next* activation
// would rerun `boot()` twice, reassigning `hermes`/`tiles` out from under any
// registry that call created. Same class of bug `registerIpc` guards against
// with `ipcRegistered`; this guard is the same fix applied to this handler.
let activateHandlerRegistered = false;

async function boot(): Promise<void> {
  hermes = new RealHermes();
  tiles = createRegistry();
  registerIpc();

  // SOUL.md, not the record, decides whether onboarding has happened — so a
  // user who hand-edits their persona keeps their agent instead of being sent
  // back through a wizard whose next move is to overwrite it. Without this,
  // every cold start reopened onboarding no matter what was already on disk,
  // and re-deriving a character was the only route back to your own agent.
  const startup = await readStartup(hermes);
  if (startup.kind === 'fleet') {
    await openFleet(startup.mainProfileId);
  } else {
    openWizard();
  }

  if (activateHandlerRegistered) return;
  activateHandlerRegistered = true;
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
    if (tiles.openProfileIds().length > 0) {
      for (const id of tiles.openProfileIds()) tiles.raise(id);
      return;
    }
    if (wizardWin && !wizardWin.isDestroyed()) {
      if (wizardWin.isMinimized()) wizardWin.restore();
      wizardWin.show();
      wizardWin.focus();
      return;
    }
    void boot();
  });
}

/** Opens a tile for the main operator. Task 9 widens this to the whole fleet. */
async function openFleet(mainProfileId: string): Promise<void> {
  const profiles = await hermes.listProfiles();
  const main = profiles.find((p) => p.id === mainProfileId) ?? profiles.find((p) => p.id === 'default');
  if (!main) return;
  await tiles.launch(await characterFor(hermes, main), main.id);
}

app.whenReady().then(() => {
  void boot();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
