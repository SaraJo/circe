import type { Character, TileTabsView } from '../shared/types';
import type { PermissionChoice, PermissionRequest } from './acp';
import { readAvatarDataUrl } from './avatarStore';
import type { HermesRuntime } from './hermes/runtime';
import { restoreOrCreateSession, TileSession, type SessionClient } from './restore';
import { readTileState, withProfileTabs, writeTileState } from './tileState';

/**
 * The slice of `BrowserWindow` a tile actually needs, narrowed to an interface
 * so the registry imports no Electron and can be tested against an object.
 * `windows.ts` adapts a real window to this; `test/tiles.test.ts` supplies a
 * fake. This is the same treatment `restore.ts`'s `SessionClient` gets, applied
 * to the other half of what `index.ts` used to hold.
 */
export interface TileWindow {
  send(channel: string, payload: unknown): void;
  isDestroyed(): boolean;
  close(): void;
  show(): void;
  focus(): void;
  isMinimized(): boolean;
  restore(): void;
  /** True when an IPC event's `sender` is this window's own web contents. */
  ownsSender(sender: unknown): boolean;
  onceLoaded(cb: () => void): void;
  onceFailedLoad(cb: () => void): void;
  onceClosed(cb: () => void): void;
}

/** The slice of `AcpClient` a tile drives. Extends what `restore.ts` needs. */
export interface TileClient extends SessionClient {
  start(): Promise<void>;
  stop(): void;
  prompt(sessionId: string, text: string): Promise<void>;
}

export interface TileClientOptions {
  profileId: string;
  onUpdate(sessionId: string, update: Record<string, unknown>): void;
  onExit(code: number | null): void;
  onPermission(request: PermissionRequest): Promise<PermissionChoice>;
}

export interface TileDeps {
  hermes: HermesRuntime;
  createWindow(character: Character, profileId: string, index: number): TileWindow;
  createClient(opts: TileClientOptions): TileClient;
}

/**
 * Whether two characters would draw the same tile. Field-by-field rather than
 * a stringify: the character arrives from `characterFor`, which builds it
 * fresh each time, so key order is not something to depend on.
 */
function sameCharacter(a: Character, b: Character): boolean {
  return (
    a.name === b.name &&
    a.tagline === b.tagline &&
    a.palette.bg === b.palette.bg &&
    a.palette.border === b.palette.border &&
    a.palette.accent === b.palette.accent
  );
}

/** One profile's live tile. Everything `index.ts` used to hold in singletons. */
interface Tile {
  readonly profileId: string;
  readonly win: TileWindow;
  readonly client: TileClient;
  readonly session: TileSession;
  /**
   * What this tile is currently showing. Kept so `retheme` can tell a real
   * change from the constant noise of an agent writing memory and session
   * state under its own profile directory, which the fleet watch also sees.
   */
  character: Character;
  loaded: boolean;
  queue: string[];
  ready: Promise<void>;
  pendingPermissions: Map<number, (choice: PermissionChoice, outcome?: string) => void>;
  tabs: string[];
  activeIndex: number;
  tabBusy: boolean;
  turnsInFlight: number;
}

export const PERMISSION_TIMEOUT_MS = 60_000;

export class TileRegistry {
  private readonly tiles = new Map<string, Tile>();
  /** Serializes read-modify-write updates shared by every profile's tab strip. */
  private stateWrite: Promise<void> = Promise.resolve();
  /**
   * Only ever increases — never derived from `this.tiles.size`. Size drops
   * when a tile closes, so a caller opening four tiles (indices 0-3), closing
   * the second, then opening a fifth would hand the new tile `size` (3),
   * landing it on the exact coordinates of the tile still open at index 3 and
   * hiding it completely. `tilePosition` cycling through its own grid over a
   * long session is fine and expected; a predictable *immediate* collision
   * with a tile that's currently on screen is the bug this counter closes
   * (I3).
   */
  private nextIndex = 0;

  constructor(private readonly deps: TileDeps) {}

  /** The profiles with a tile on screen right now. */
  openProfileIds(): string[] {
    return [...this.tiles.keys()];
  }

  has(profileId: string): boolean {
    return this.tiles.has(profileId);
  }

  /**
   * Which profile an IPC event belongs to, or null.
   *
   * Routing by sender rather than by a profile id the renderer supplies is
   * deliberate: a tile renders agent output through a markdown renderer that
   * does not sanitize, into a window holding `send()`. A renderer that could
   * name its own profile could name someone else's, and prompt an agent it does
   * not belong to. A window may only ever speak for itself (§4.3.1).
   */
  profileForSender(sender: unknown): string | null {
    for (const tile of this.tiles.values()) {
      if (tile.win.ownsSender(sender)) return tile.profileId;
    }
    return null;
  }

  /**
   * Opens this profile's tile, or raises it if it already has one.
   *
   * The old single-tile guard was `if (tileWin) return` — a silent no-op,
   * adequate when the only second caller was macOS's `activate`. Under a
   * directory watch a profile whose files are touched again must produce no
   * second tile, and `activate` has to be able to raise a *specific* one, so
   * this raises instead of returning.
   */
  async launch(character: Character, profileId: string, greeting: string | null = null): Promise<void> {
    const existing = this.tiles.get(profileId);
    if (existing) {
      this.raiseTile(existing);
      return;
    }

    const session = new TileSession();
    // Opened before the window exists, so there is no instant in which the tile
    // is on screen with an enabled input and nowhere for a message to go.
    session.beginLaunch();
    const win = this.deps.createWindow(character, profileId, this.nextIndex++);

    // Declared before `createClient` so its callbacks close over a real guard
    // rather than a temporal-dead-zone reference — a client implementation
    // that could fire `onExit` during its own construction would otherwise
    // throw. Checked as `tile !== undefined` first: while `tile` is still
    // unassigned, `this.tiles.get(profileId)` is also undefined, and a bare
    // `get(profileId) === tile` would read true before this launch owns
    // anything — the exact inverse of what the guard is supposed to mean.
    //
    // `tile` itself is never read back off the map: `start()` and
    // `restoreOrCreateSession()` each await for up to 30s, easily enough time
    // for this tile to be closed and reopened, which spins up a second launch
    // with its own client. Every access to *this* launch's state goes through
    // the local below, and every write to the map is guarded by `isCurrent`.
    let tile: Tile | undefined;
    const isCurrent = (): boolean => tile !== undefined && this.tiles.get(profileId) === tile;

    const client = this.deps.createClient({
      profileId,
      onUpdate: (sessionId, update) => {
        if (!isCurrent()) return; // this launch has been superseded
        // One client can serve several sessions; only the one on screen is drawn.
        if (sessionId !== session.activeSessionId) return;
        this.emit(win, update);
      },
      onExit: (code) => {
        if (!isCurrent()) return; // the exit belongs to an already-replaced client
        this.emit(win, { sessionUpdate: 'circe/exited', code });
      },
      onPermission: (request) => this.askPermission(profileId, request),
    });

    const newTile: Tile = {
      profileId,
      win,
      client,
      session,
      character,
      loaded: false,
      // The opening message belongs to the handoff out of onboarding and
      // nowhere else: it says "Right now I'm the only agent you have", which
      // stops being true the moment the orchestrator creates the first
      // specialist. Reopening a tile must not replay it.
      queue: greeting === null ? [] : [greeting],
      ready: Promise.resolve(),
      pendingPermissions: new Map(),
      tabs: [],
      activeIndex: 0,
      tabBusy: true,
      turnsInFlight: 0,
    };
    tile = newTile;
    this.tiles.set(profileId, newTile);

    // `did-finish-load` is the happy path: it flushes the queue and marks the
    // tile ready to draw. A window can also fail to load, or be destroyed
    // before it ever loads — without an escape on those, `await ready`
    // downstream would hang forever and "every failure path lands on a fresh
    // session" would be a lie. Resolving twice is harmless.
    newTile.ready = new Promise<void>((resolve) => {
      win.onceLoaded(() => {
        newTile.loaded = true;
        for (const text of newTile.queue.splice(0)) win.send('tile:opening', text);
        this.sendAvatar(win, profileId);
        this.emitTabs(newTile);
        resolve();
      });
      win.onceFailedLoad(() => resolve());
      win.onceClosed(() => resolve());
    });

    // `close(profileId)` stops the client, but the native close button, Cmd+W
    // and `app.quit()` all bypass it and go straight to the window — the far
    // more instinctive way to dismiss a floating window, and nothing on that
    // path stopping the client leaks a `hermes acp` process per close.
    // `stop()` tolerates a second call, so no dedup is needed.
    win.onceClosed(() => {
      for (const answer of newTile.pendingPermissions.values()) answer('deny');
      client.stop();
      if (isCurrent()) this.tiles.delete(profileId);
    });

    try {
      await client.start();
      const restored = await restoreOrCreateSession({
        hermes: this.deps.hermes,
        client,
        profileId,
        session,
        emit: (update) => this.emit(win, update),
        tileReady: newTile.ready,
        isCurrent,
        sendPrompt: (sessionId, text) => this.send(newTile, sessionId, text),
      });
      if (!isCurrent() || restored === null) return;
      newTile.tabs = restored.tabs;
      newTile.activeIndex = restored.activeIndex;
      newTile.tabBusy = false;
      this.emitTabs(newTile);
    } catch (err) {
      client.stop();
      if (!isCurrent()) return;
      // Deliberately does not delete the tile: the window is still on screen
      // with an enabled input, and removing the map entry here would leave it
      // orphaned — reachable by nothing (`prompt`, `close`, `raise`,
      // `profileForSender` all key off this map) while still accepting
      // keystrokes, and a second `launch()` for the same profile would miss
      // the existing window and stack a second one on top of it. The session
      // is reset instead, so `prompt`'s own `no-session` branch is what
      // answers anything typed from here on, and the window's own `closed`
      // handler — not this catch — is what eventually removes the entry, when
      // the user acts on "close this tile and start over" below.
      const unsent = session.failLaunch();
      session.reset();
      newTile.tabBusy = false;
      this.emitTabs(newTile);
      const message = err instanceof Error ? err.message : String(err);
      this.say(newTile,
        "I couldn't reach the Hermes agent behind this tile, so I can't respond yet. " +
          'Check that Hermes is installed and set up (`hermes setup` in a terminal), ' +
          `then close this tile and start over.\n\n(${message})`,
      );
      // Whatever was typed while the tile was starting is already drawn as the
      // user's own bubble. Saying nothing would leave it sitting unanswered
      // forever, which is the silence the holding pen exists to avoid.
      if (unsent.length > 0) {
        this.say(newTile,
          unsent.length === 1
            ? "The message you typed while it was starting wasn't sent."
            : "The messages you typed while it was starting weren't sent.",
        );
      }
    }
  }

  /**
   * Routes a message the user typed. Every branch ends in something they can
   * see: the renderer has already drawn their bubble, so returning quietly is
   * not one of the options.
   */
  async prompt(profileId: string, text: string): Promise<void> {
    const tile = this.tiles.get(profileId);
    if (!tile) return;
    const route = tile.session.route(text);
    // Held: a launch is in flight and will either send this or, if it fails,
    // say so in the tile. Either way the user hears back.
    if (route.kind === 'held') return;
    if (route.kind === 'no-session') {
      this.emit(tile.win, { sessionUpdate: 'circe/turn-end' });
      this.say(tile, "Your message wasn't sent. This tile has no agent session right now.");
      return;
    }
    await this.send(tile, route.sessionId, text);
  }

  /** Starts a blank Hermes conversation and adds it to this tile's tab strip. */
  async newTab(profileId: string): Promise<void> {
    const tile = this.tiles.get(profileId);
    if (!tile || !this.canChangeTabs(tile)) return;
    const previousId = tile.session.activeSessionId;
    tile.tabBusy = true;
    tile.session.beginLaunch();
    this.emitTabs(tile);
    try {
      const sessionId = await tile.client.newSession();
      if (this.tiles.get(profileId) !== tile) return;
      this.emit(tile.win, { sessionUpdate: 'circe/tab-reset' });
      const held = tile.session.openSession(sessionId);
      tile.tabs.push(sessionId);
      tile.activeIndex = tile.tabs.length - 1;
      await this.persistTabs(tile);
      await this.deliverHeld(tile, sessionId, held);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.say(tile, `I couldn't start a new conversation. (${message})`);
      if (previousId) {
        const held = tile.session.openSession(previousId);
        await this.deliverHeld(tile, previousId, held);
      } else {
        tile.session.failLaunch();
      }
    } finally {
      if (this.tiles.get(profileId) === tile) {
        tile.tabBusy = false;
        this.emitTabs(tile);
      }
    }
  }

  /** Reopens one remembered Hermes conversation in this tile. */
  async switchTab(profileId: string, index: number): Promise<void> {
    const tile = this.tiles.get(profileId);
    if (!tile || !this.canChangeTabs(tile) || index === tile.activeIndex) return;
    if (!Number.isInteger(index) || index < 0 || index >= tile.tabs.length) return;
    await this.changeActiveTab(tile, index);
  }

  /** Starts over inside the active tab without adding or removing a tab. */
  async clearTab(profileId: string): Promise<void> {
    const tile = this.tiles.get(profileId);
    if (!tile || !this.canChangeTabs(tile)) return;
    const previousId = tile.session.activeSessionId;
    tile.tabBusy = true;
    tile.session.beginLaunch();
    this.emitTabs(tile);
    try {
      const sessionId = await tile.client.newSession();
      if (this.tiles.get(profileId) !== tile) return;
      this.emit(tile.win, { sessionUpdate: 'circe/tab-reset' });
      const held = tile.session.openSession(sessionId);
      if (tile.tabs.length === 0) {
        tile.tabs = [sessionId];
        tile.activeIndex = 0;
      } else {
        tile.tabs[tile.activeIndex] = sessionId;
      }
      await this.persistTabs(tile);
      await this.deliverHeld(tile, sessionId, held);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.say(tile, `I couldn't clear this conversation. (${message})`);
      if (previousId) {
        const held = tile.session.openSession(previousId);
        await this.deliverHeld(tile, previousId, held);
      } else {
        tile.session.failLaunch();
      }
    } finally {
      if (this.tiles.get(profileId) === tile) {
        tile.tabBusy = false;
        this.emitTabs(tile);
      }
    }
  }

  /** Removes a tab from Circe. It deliberately does not delete the Hermes session. */
  async closeTab(profileId: string, index: number): Promise<void> {
    const tile = this.tiles.get(profileId);
    if (!tile || !this.canChangeTabs(tile)) return;
    if (!Number.isInteger(index) || index < 0 || index >= tile.tabs.length) return;

    if (index !== tile.activeIndex) {
      tile.tabs.splice(index, 1);
      if (index < tile.activeIndex) tile.activeIndex--;
      await this.persistTabs(tile);
      this.emitTabs(tile);
      return;
    }

    if (tile.tabs.length === 1) {
      const previousId = tile.session.activeSessionId;
      tile.tabBusy = true;
      tile.session.beginLaunch();
      this.emitTabs(tile);
      try {
        const sessionId = await tile.client.newSession();
        if (this.tiles.get(profileId) !== tile) return;
        this.emit(tile.win, { sessionUpdate: 'circe/tab-reset' });
        const held = tile.session.openSession(sessionId);
        tile.tabs = [sessionId];
        tile.activeIndex = 0;
        await this.persistTabs(tile);
        await this.deliverHeld(tile, sessionId, held);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.say(tile, `I couldn't start a replacement conversation. (${message})`);
        if (previousId) {
          const held = tile.session.openSession(previousId);
          await this.deliverHeld(tile, previousId, held);
        } else {
          tile.session.failLaunch();
        }
      } finally {
        if (this.tiles.get(profileId) === tile) {
          tile.tabBusy = false;
          this.emitTabs(tile);
        }
      }
      return;
    }

    const target = index === tile.tabs.length - 1 ? index - 1 : index + 1;
    const nextTabs = tile.tabs.filter((_id, i) => i !== index);
    const nextIndex = target > index ? target - 1 : target;
    const changed = await this.changeActiveTab(tile, target, false);
    if (!changed || this.tiles.get(profileId) !== tile) return;
    tile.tabs = nextTabs;
    tile.activeIndex = nextIndex;
    await this.persistTabs(tile);
    this.emitTabs(tile);
  }

  private askPermission(
    profileId: string,
    request: PermissionRequest,
  ): Promise<PermissionChoice> {
    const tile = this.tiles.get(profileId);
    if (!tile || tile.win.isDestroyed()) return Promise.resolve('deny');

    // A repeated protocol id cannot leave the older request hanging.
    tile.pendingPermissions.get(request.id)?.('deny');

    return new Promise((resolve) => {
      let finished = false;
      const finish = (choice: PermissionChoice, outcome: string = choice) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        tile.pendingPermissions.delete(request.id);
        this.emit(tile.win, {
          sessionUpdate: 'circe/permission-resolved',
          id: request.id,
          outcome,
        });
        resolve(choice);
        this.emitTabs(tile);
      };
      const timer = setTimeout(() => finish('deny', 'expired'), PERMISSION_TIMEOUT_MS);
      tile.pendingPermissions.set(request.id, finish);
      this.emitTabs(tile);
      this.emit(tile.win, {
        sessionUpdate: 'circe/permission',
        id: request.id,
        description: request.description,
        command: request.command,
      });
      this.raiseTile(tile);
    });
  }

  /** Answers only a request owned by this tile; unknown and stale ids are ignored. */
  answerPermission(profileId: string, id: number, choice: PermissionChoice): void {
    this.tiles.get(profileId)?.pendingPermissions.get(id)?.(choice);
  }

  /** Closes a tile from inside the app. The native close path lands in the same handler. */
  close(profileId: string): void {
    const tile = this.tiles.get(profileId);
    if (!tile) return;
    for (const answer of tile.pendingPermissions.values()) answer('deny');
    tile.client.stop();
    tile.win.close();
    this.tiles.delete(profileId);
  }

  /**
   * Updates what an open tile shows about its agent, if anything has changed.
   *
   * The two files that describe a profile do not land together: `SOUL.md`
   * makes it tileable and `circe.json` follows in a later write — seconds
   * later when an agent is doing the writing. A tile launched in between shows
   * `DEFAULT_PALETTE` and, before this, kept showing it until the app
   * restarted. This is also what makes a hand-edited persona take effect
   * live, which is the same rule the wizard follows: disk wins.
   *
   * Silent when nothing changed. The fleet watch calls this on every write
   * under `profiles/`, and an agent mid-conversation produces a steady stream
   * of them; re-sending an identical character would repaint the tile for
   * nothing. Compares the whole character rather than only the fields today's
   * renderer reads, so a tile that starts showing the tagline tomorrow cannot
   * quietly go stale.
   */
  retheme(profileId: string, character: Character): void {
    const tile = this.tiles.get(profileId);
    if (!tile) return;
    if (sameCharacter(tile.character, character)) return;
    tile.character = character;
    if (tile.win.isDestroyed()) return;
    tile.win.send('tile:character', character);
    this.sendAvatar(tile.win, profileId);
  }

  /**
   * Reads and sends a profile's face, on its own channel — used on a tile's
   * first load and again on every re-theme. Deliberately not part of the
   * character: the character is agent facts and travels in the window URL,
   * where a base64 PNG would not fit.
   *
   * `readAvatarDataUrl` only swallows "the file genuinely isn't there"
   * (`ENOENT`/`ENOTDIR`, inside `hermes.readHomeFileBytes`) and rethrows
   * everything else, by design, so a caller guarding a destructive write can
   * tell "nothing there" from "couldn't look" — a distinction that stays
   * correct and is not touched here. A tile draws no such distinction: it
   * only cares whether there is a face to show, so a rejection (a
   * permissions problem, a corrupted home directory) is caught and treated
   * the same as a profile with no face, rather than becoming an unhandled
   * rejection in the main process.
   */
  private sendAvatar(win: TileWindow, profileId: string): void {
    void readAvatarDataUrl(this.deps.hermes, profileId)
      .catch(() => null)
      .then((url) => {
        win.send('tile:avatar', url);
      });
  }

  /** Brings a tile to the front. Used by `activate` and by a duplicate launch. */
  raise(profileId: string): boolean {
    const tile = this.tiles.get(profileId);
    if (!tile) return false;
    this.raiseTile(tile);
    return true;
  }

  private raiseTile(tile: Tile): void {
    if (tile.win.isDestroyed()) return;
    if (tile.win.isMinimized()) tile.win.restore();
    tile.win.show();
    tile.win.focus();
  }

  private canChangeTabs(tile: Tile): boolean {
    return (
      tile.client.canLoadSession &&
      !tile.tabBusy &&
      tile.turnsInFlight === 0 &&
      tile.pendingPermissions.size === 0
    );
  }

  /** Loads and replays a tab, retaining the previous one if Hermes cannot. */
  private async changeActiveTab(tile: Tile, index: number, persist = true): Promise<boolean> {
    const target = tile.tabs[index];
    const previousId = tile.tabs[tile.activeIndex];
    const previousIndex = tile.activeIndex;
    if (!target || !previousId) return false;

    tile.tabBusy = true;
    this.emitTabs(tile);
    tile.session.beginLaunch();
    tile.session.expectReplay(target);
    this.emit(tile.win, { sessionUpdate: 'circe/tab-reset' });
    this.emit(tile.win, { sessionUpdate: 'circe/replay-start' });
    let loaded = false;
    try {
      loaded = await tile.client.loadSession(target);
    } catch {
      loaded = false;
    }
    if (this.tiles.get(tile.profileId) !== tile) return false;
    this.emit(tile.win, { sessionUpdate: 'circe/replay-end' });

    if (!loaded) {
      // A failed load can still emit partial history. Clear it, then redraw the
      // conversation that remains active instead of leaving mismatched prose.
      tile.session.expectReplay(previousId);
      this.emit(tile.win, { sessionUpdate: 'circe/tab-reset' });
      this.emit(tile.win, { sessionUpdate: 'circe/replay-start' });
      try {
        await tile.client.loadSession(previousId);
      } catch {
        // The explicit session id still remains usable for a later prompt even
        // if this agent could not replay its history right now.
      } finally {
        if (this.tiles.get(tile.profileId) === tile) {
          this.emit(tile.win, { sessionUpdate: 'circe/replay-end' });
          const held = tile.session.openSession(previousId);
          tile.activeIndex = previousIndex;
          tile.tabBusy = false;
          this.emitTabs(tile);
          this.say(tile, "I couldn't reopen that conversation, so I kept this one open.");
          await this.deliverHeld(tile, previousId, held);
        }
      }
      return false;
    }

    const held = tile.session.openSession(target);
    tile.activeIndex = index;
    if (persist) await this.persistTabs(tile);
    tile.tabBusy = false;
    this.emitTabs(tile);
    await this.deliverHeld(tile, target, held);
    return true;
  }

  private async persistTabs(tile: Tile): Promise<void> {
    const tabs = [...tile.tabs];
    const activeIndex = tile.activeIndex;
    const write = this.stateWrite.then(async () => {
      const file = await readTileState(this.deps.hermes);
      await writeTileState(
        this.deps.hermes,
        withProfileTabs(file, tile.profileId, tabs, activeIndex),
      );
    });
    // Keep the queue usable if a future runtime stops swallowing write errors.
    this.stateWrite = write.catch(() => {});
    await write;
  }

  private async deliverHeld(tile: Tile, sessionId: string, held: string[]): Promise<void> {
    for (const text of held) {
      if (this.tiles.get(tile.profileId) !== tile) return;
      await this.send(tile, sessionId, text);
    }
  }

  private emitTabs(tile: Tile): void {
    if (!tile.loaded || tile.win.isDestroyed()) return;
    const view: TileTabsView = {
      count: tile.tabs.length,
      activeIndex: tile.activeIndex,
      busy: tile.tabBusy || tile.turnsInFlight > 0 || tile.pendingPermissions.size > 0,
      supported: tile.client.canLoadSession,
    };
    tile.win.send('tile:tabs', view);
  }

  /**
   * Sends one message and closes the turn behind it.
   *
   * A turn ends when `prompt` resolves — that is ACP's completion signal, and
   * the renderer has no other way to know a reply is finished. Both outcomes
   * end it, so a failed prompt doesn't leave the previous bubble open forever.
   * Never rejects: `restore.ts` awaits this to deliver held messages one at a
   * time, and a rejection there is not a launch failure.
   */
  private send(tile: Tile, sessionId: string, text: string): Promise<void> {
    tile.turnsInFlight++;
    this.emitTabs(tile);
    return tile.client.prompt(sessionId, text).then(
      () => {
        if (tile.session.activeSessionId === sessionId) {
          this.emit(tile.win, { sessionUpdate: 'circe/turn-end' });
        }
      },
      (err: unknown) => {
        if (tile.session.activeSessionId === sessionId) {
          this.emit(tile.win, { sessionUpdate: 'circe/turn-end' });
        }
        const message = err instanceof Error ? err.message : String(err);
        // Deliberately does not name a cause: this fires for a dead connection,
        // a stopped client and an agent-side error alike, and the attached
        // message is the only thing that actually knows which.
        this.say(tile, `Your message wasn't sent. (${message})`);
      },
    ).finally(() => {
      tile.turnsInFlight = Math.max(0, tile.turnsInFlight - 1);
      this.emitTabs(tile);
    });
  }

  /** Circe's own prose. Queued until the renderer has registered its listeners. */
  private say(tile: Tile, text: string): void {
    if (!tile.loaded) {
      tile.queue.push(text);
      return;
    }
    // A prompt rejection can land after the user has closed the tile, and
    // `close()` destroys the window before the closed handler runs.
    if (!tile.win.isDestroyed()) tile.win.send('tile:opening', text);
  }

  /**
   * Circe's own lifecycle events ride the same channel as real ACP updates,
   * namespaced so they can never collide with a protocol `sessionUpdate` kind.
   */
  private emit(win: TileWindow, update: Record<string, unknown>): void {
    if (!win.isDestroyed()) win.send('tile:update', update);
  }
}
