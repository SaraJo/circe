import { app, BrowserWindow, ipcMain, nativeImage, shell } from 'electron';
import { RealHermes } from './hermes/real';
import { Wizard } from './wizard';
import { adaptTileWindow, createTileWindow, createWizardWindow } from './windows';
import { AcpClient, isPermissionChoice } from './acp';
import { FleetWatch, tileableProfiles } from './fleet';
import { adoptionOpeningMessage, openingMessage } from './orchestrator/opening';
import { characterFor, readStartup } from './startup';
import { TileRegistry } from './tiles';
import { httpDeps } from './avatar';
import type { HermesProfile } from '../shared/types';

app.setName('Circe');

// `contentType` is unused by `nativeImage`, which sniffs the bytes; it stays in
// the signature so the store can shortcut a PNG without decoding it.

// Wikimedia's API policy asks callers to identify themselves. It lives here and
// not in `avatar.ts` because it names a host that is never contacted, and the
// provenance test reads that file's hostnames as outbound destinations.
const USER_AGENT = 'Circe/0.1 (https://github.com/sarachipps/circe-desktop)';

let wizardWin: BrowserWindow | null = null;
let hermes: RealHermes;
let wizard: Wizard | null = null;
let tiles: TileRegistry;
let fleetWatch: (() => void) | null = null;
/**
 * The profile `activate` should raise last, so the tile the user expects in
 * front is the one that ends up in front. Set by whichever path actually
 * opens the first tile — `openFleet` on a cold-fleet boot, or the wizard's
 * `launching` handler on a first run — from the id that path resolved, never
 * re-derived, so it can only ever agree with what actually booted.
 */
let mainProfileId: string | null = null;

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
    createWindow: (character, profileId, index) =>
      adaptTileWindow(createTileWindow(character, profileId, index)),
    createClient: (opts) => new AcpClient(opts),
  });
}

/** Creates the wizard and its window, and wires the one to the other. */
function openWizard(existingProfiles: HermesProfile[] = []): void {
  const w = new Wizard(hermes, {
    deps: httpDeps((url, init) => fetch(url, init), USER_AGENT),
    toPng: (bytes, contentType) => {
      const img = nativeImage.createFromBuffer(Buffer.from(bytes));
      return img.isEmpty() ? null : new Uint8Array(img.toPNG());
    },
  }, existingProfiles);
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
    if (s.kind === 'fleet-launching') {
      wizardWin?.close();
      wizardWin = null;
      mainProfileId = s.mainProfileId;
      void openFleet(s.mainProfileId, s.openingProfileId);
      return;
    }
    if (wizardWin && !wizardWin.isDestroyed()) {
      wizardWin.webContents.send('wizard:step', s);
      wizardWin.webContents.send('wizard:avatar', w.avatarDataUrl());
    }
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
    mainProfileId = s.profileId;
    // A brand-new orchestrator's very first act is usually to create a
    // specialist, and that can happen minutes into the first conversation —
    // long before the *next* app restart, which is the only other place a
    // watch gets started. Without one here, the orchestrator writes
    // `profiles/<id>/SOUL.md`, reports success, and nothing appears: the
    // product's premise fails silently for the person least equipped to
    // notice why.
    void openPreexistingFleetOnHandoff(s.profileId);
  });
}

/**
 * Opens tiles for any already-real profiles besides the one the wizard just
 * created, then watches for more. (I1.)
 *
 * `readStartup` decides wizard-vs-fleet from `default`'s own `SOUL.md` alone,
 * so a machine that already has real specialists — an existing Hermes user
 * installing Circe — goes through onboarding too. Without this, those
 * specialists get no tile here, and none again until the *next* unrelated
 * write anywhere under `profiles/`, whenever that happens to land: the watch
 * then dumps all of them on screen at once, each stealing focus with no
 * explanation, possibly minutes into the user's first conversation with the
 * agent they just met.
 *
 * Deliberately does not touch the orchestrator's own tile, which
 * `tiles.launch` above has already put on screen: `tiles.raise` at the end
 * brings it back in front of whatever this function just opened, rather than
 * this function launching it a second time. That ordering — everyone else
 * first, the orchestrator raised last — is what makes the tile the user just
 * met the one they end up looking at, matching `openFleet`'s own "main
 * operator opens last" rule (spec §6.6).
 *
 * The `try`/`finally` is load-bearing (R2): before this handoff existed, the
 * watch started synchronously and unconditionally. A throw partway through
 * this loop — `createTileWindow` failing inside `tiles.launch`, most
 * plausibly, since that call sits outside `launch`'s own try — must not
 * leave the process with zero fleet watches. The watch always starts, seeded
 * with `tiles.openProfileIds()` — whatever the registry actually has open at
 * that moment, not the ids this function merely hoped to open — so a partial
 * failure here degrades to "some pre-existing agents have no tile yet"
 * rather than "nothing is watched at all, ever."
 *
 * `sweepNow` runs immediately after, same as `openFleet` (I2/R3): the watch
 * is already seeded with every profile that has a tile by this point
 * (including the orchestrator's own), so a sweep here can only pick up a
 * profile that became tileable *during* the loop above — it cannot re-dump
 * anything already on screen.
 */
async function openPreexistingFleetOnHandoff(orchestratorId: string): Promise<void> {
  try {
    const others = (await tileableProfiles(hermes)).filter((p) => p.id !== orchestratorId);
    for (const profile of others) {
      await tiles.launch(await characterFor(hermes, profile), profile.id);
    }
  } catch (err) {
    console.warn('Could not open every pre-existing agent’s tile on the wizard handoff.', err);
  } finally {
    tiles.raise(orchestratorId);
    const watch = startFleetWatch(tiles.openProfileIds());
    void watch.sweepNow();
  }
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
  ipcMain.on('wizard:personalize-fleet', () => wizard?.personalizeExistingFleet());
  ipcMain.on('wizard:keep-fleet-names', () => wizard?.keepExistingFleetNames());
  ipcMain.on('wizard:fleet-fandom', (_e, text: string) => void wizard?.submitFleetFandom(text));
  ipcMain.on('wizard:retry-fleet', () => void wizard?.retryFleetDerivation());
  ipcMain.on('wizard:accept-fleet-renames', (_e, profileIds: unknown) => {
    if (!Array.isArray(profileIds) || !profileIds.every((id) => typeof id === 'string')) return;
    void wizard?.acceptFleetRenames(profileIds);
  });
  ipcMain.on('wizard:choose-coordinator', (_e, profileId: unknown) => {
    if (profileId !== null && typeof profileId !== 'string') return;
    void wizard?.chooseExistingCoordinator(profileId as string | null);
  });
  ipcMain.on('wizard:new-coordinator', () => wizard?.beginNewCoordinator());
  ipcMain.on('wizard:accept-new-coordinator', () => void wizard?.acceptNewCoordinator());
  ipcMain.on('wizard:retry-new-coordinator', () => wizard?.retryNewCoordinator());
  ipcMain.on('wizard:resume-adoption', () => void wizard?.resumeAdoption());
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
  ipcMain.on('tile:permission-answer', (e, answer: { id?: unknown; choice?: unknown }) => {
    const profileId = tiles.profileForSender(e.sender);
    if (profileId === null || !Number.isInteger(answer?.id) || !isPermissionChoice(answer?.choice)) return;
    tiles.answerPermission(profileId, answer.id as number, answer.choice);
  });
}

/**
 * Gates re-entry with the in-flight promise itself, not a boolean: `activate`
 * can call `boot()` again while an earlier call is still awaiting
 * `readStartup`/`openFleet` (nothing has reached the screen yet, so there is
 * nothing for `activate`'s other branches to raise). A flag would only stop a
 * *second* concurrent call from starting a *third* boot; returning the
 * in-flight promise makes every concurrent call resolve together with the one
 * already running, so two dock clicks during a slow cold start produce one
 * wizard, not two. Assigned before `doBoot`'s first `await`, so the window in
 * which a second call could slip through and start its own is zero.
 */
let booting: Promise<void> | null = null;

function boot(): Promise<void> {
  if (booting) return booting;
  booting = doBoot().finally(() => {
    booting = null;
  });
  return booting;
}

async function doBoot(): Promise<void> {
  // Stopped before `hermes`/`tiles` are reassigned below, not after
  // `openFleet` settles: a watch left running from a previous boot stays
  // subscribed to the *old* `RealHermes.watchHome` while its `isOpen`/
  // `onProfile` closures read the *module* bindings — which this function is
  // about to repoint at a new registry. `readStartup` plus a full sequential
  // launch loop can run tens of seconds; a filesystem event landing in that
  // window would have the stale watch launch a tile concurrently with this
  // boot's own loop, which is exactly the concurrent-spawn stall this task
  // exists to prevent, and it could steal focus from the main operator too.
  fleetWatch?.();
  fleetWatch = null;

  hermes = new RealHermes();
  tiles = createRegistry();
  registerIpc();

  // A real SOUL proves Hermes already has an agent; Circe's last-launch record
  // proves the user has completed or skipped Circe adoption. Existing profiles
  // discovered without that record are passed into the non-destructive adoption
  // branch instead of being mistaken for a finished Circe setup.
  const startup = await readStartup(hermes);
  if (startup.kind === 'fleet') {
    await openFleet(startup.mainProfileId);
  } else {
    openWizard(startup.profiles ?? []);
  }
}

/**
 * Opens a tile for every agent on disk, and keeps watching for more.
 *
 * The main operator is opened last because `createTileWindow` raises each
 * window as it appears, so the last one lands in front — and that is the
 * tile the user expects to be looking at (spec §6.6).
 *
 * Tiles open in sequence rather than in parallel: each one spawns a `hermes
 * acp` child and waits on a handshake, and a seven-agent fleet starting seven
 * subprocesses at once on a cold machine is how a launch turns into a stall.
 *
 * `tileableProfiles` answers `[]` both for a home with no other profiles
 * *and* for a hermes binary that is missing or broken (`RealHermes.
 * listProfiles`, which it filters, catches the exec failure and returns the
 * empty array either way) — so the resolved profile list can omit the main
 * operator even when `SOUL.md` holds a real persona. Falling back to the
 * wizard here would be wrong: the wizard's next move once a provider
 * reappears is to overwrite that persona, and a user whose persona is intact
 * must never be walked toward replacing it just because their binary broke.
 * Synthesising the profile record and launching its tile anyway is what puts
 * the tile's own launch-failure copy ("I couldn't reach the Hermes agent
 * behind this tile...") back on screen — the alternative is an app with no
 * windows and nothing to click. `characterFor` already degrades correctly for
 * a profile whose `SOUL.md` can't be read (falls back to `displayName`), so
 * this needs nothing else from it.
 */
async function openFleet(mainId: string, openingProfileId: string | null = null): Promise<void> {
  const profiles = await tileableProfiles(hermes);
  const main = profiles.find((p) => p.id === mainId) ??
    profiles.find((p) => p.id === 'default') ??
    { id: mainId, displayName: mainId, model: null, isReal: true };
  // Set from `main.id`, the id actually resolved and launched — not the
  // requested `mainId` — so a stale `last-launch.json` naming a profile that
  // no longer enumerates can't leave `activate` trying to raise an id with no
  // tile. `main.id` always has a tile by the time this assignment runs.
  mainProfileId = main.id;
  const ordered = [...profiles.filter((p) => p.id !== main.id), main];

  for (const profile of ordered) {
    const character = await characterFor(hermes, profile);
    await tiles.launch(
      character,
      profile.id,
      profile.id === openingProfileId ? adoptionOpeningMessage(character) : null,
    );
  }

  // Exactly what this call just launched — not re-enumerated — so the
  // watch's seen-set agrees with the registry from its very first sweep and
  // never re-reports a profile whose tile is already open.
  const watch = startFleetWatch(ordered.map((p) => p.id));
  // I2: each iteration of the loop above awaits a 30s handshake and a full
  // session restore (held messages included), so for a several-agent fleet
  // that loop alone can run for minutes. A profile that became tileable
  // during it would otherwise sit unnoticed until some unrelated later write
  // under `profiles/` happened to trigger the watch, or until the next
  // restart on a quiet machine. One sweep right after the watch exists
  // catches it immediately; everything the loop above already launched is in
  // the watch's seeded set, so this can't re-open any of it.
  //
  // Not inside `startFleetWatch` itself, so each caller opts in explicitly —
  // `openPreexistingFleetOnHandoff` (R3) also calls it, once its own watch is
  // seeded with everyone already open, for the same reason.
  void watch.sweepNow();
}

/**
 * (Re)starts the fleet watch, seeded with the profile ids the caller already
 * has tiles open for. Shared by `openFleet` (cold-fleet boot) and the wizard
 * handoff (first run ever) — both are "a set of tiles just opened; watch for
 * the next one" and neither should re-implement the seeding or the
 * stop-before-replace. Returns the watch itself (not just its stop function)
 * so a caller that wants an immediate `sweepNow` (`openFleet`, I2;
 * `openPreexistingFleetOnHandoff`, R3) can trigger one without this helper
 * doing it unconditionally on every caller's behalf.
 */
function startFleetWatch(seed: Iterable<string>): FleetWatch {
  // Stopped before being replaced, not after: a second call (a re-boot via
  // `activate`, say) must never leave an earlier watch's `hermes.watchHome`
  // subscription running alongside the new one.
  fleetWatch?.();
  const watch = new FleetWatch({
    hermes,
    alreadyTiled: seed,
    isOpen: (id) => tiles.has(id),
    onProfile: async (profile) => {
      await tiles.launch(await characterFor(hermes, profile), profile.id);
    },
    // The same read the launch does, against a tile that already exists.
    // `characterFor` is the only thing that knows how to turn a profile into
    // what a tile shows, and `retheme` is silent unless something actually
    // changed, so this costs two small file reads per open tile per sweep —
    // against an enumeration that already shells out to `hermes profile list`.
    onKnownProfile: async (profile) => {
      tiles.retheme(profile.id, await characterFor(hermes, profile));
    },
  });
  fleetWatch = watch.start();
  return watch;
}

app.whenReady().then(() => {
  void boot();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
// Stops `hermes.watchHome`'s filesystem subscription so it doesn't outlive
// the app it was watching for.
app.on('will-quit', () => {
  fleetWatch?.();
  fleetWatch = null;
});
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
//
// Registered at module scope, not inside `boot()`: attaching it there meant
// it existed only after the *previous* boot had fully resolved — i.e. after
// `client.start()`'s 30s handshake and a full session restore on a cold
// start — so a dock click during exactly the window a user is most likely to
// make one did nothing at all. It also meant every re-run of `boot()` that
// reached this point added a second listener, stacking without bound. Module
// scope means it exists exactly once, from process start, independent of
// where `boot()` currently is in its own lifecycle.
app.on('activate', () => {
  // `boot()` hasn't been called yet, or is still in its synchronous setup
  // before `tiles`/`hermes` are assigned — nothing exists to raise yet, so
  // starting (or joining) a boot is the only sensible move. `boot()`'s own
  // in-flight guard makes this safe to call even while one is already
  // running.
  if (!tiles) {
    void boot();
    return;
  }
  const openIds = tiles.openProfileIds();
  if (openIds.length > 0) {
    // Raised in two passes, not in map order: every window's `show()`/
    // `focus()` lands it on top of whatever came before, so raising in map
    // order left whichever tile happened to be last in the registry
    // focused — not necessarily the main operator the user expects to see
    // (§6.6). The others go first; the main operator, if it still has a
    // tile, goes last. `raise` no-ops on an id with no tile, which covers
    // "the main operator's tile is closed" (nothing to raise last, but
    // nothing throws) as well as the sliver of time between `boot()` starting
    // and either `openFleet` or the wizard handoff actually setting
    // `mainProfileId`.
    for (const id of openIds) {
      if (id !== mainProfileId) tiles.raise(id);
    }
    if (mainProfileId !== null) tiles.raise(mainProfileId);
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
