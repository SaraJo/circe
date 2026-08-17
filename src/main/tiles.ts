import type { Character } from '../shared/types';
import type { HermesRuntime } from './hermes/runtime';
import { restoreOrCreateSession, TileSession, type SessionClient } from './restore';

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
}

export interface TileDeps {
  hermes: HermesRuntime;
  createWindow(character: Character, profileId: string, index: number): TileWindow;
  createClient(opts: TileClientOptions): TileClient;
}

/** One profile's live tile. Everything `index.ts` used to hold in singletons. */
interface Tile {
  readonly profileId: string;
  readonly win: TileWindow;
  readonly client: TileClient;
  readonly session: TileSession;
  loaded: boolean;
  queue: string[];
  ready: Promise<void>;
}

export class TileRegistry {
  private readonly tiles = new Map<string, Tile>();
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
    });

    const newTile: Tile = {
      profileId,
      win,
      client,
      session,
      loaded: false,
      // The opening message belongs to the handoff out of onboarding and
      // nowhere else: it says "Right now I'm the only agent you have", which
      // stops being true the moment the orchestrator creates the first
      // specialist. Reopening a tile must not replay it.
      queue: greeting === null ? [] : [greeting],
      ready: Promise.resolve(),
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
      client.stop();
      if (isCurrent()) this.tiles.delete(profileId);
    });

    try {
      await client.start();
      await restoreOrCreateSession({
        hermes: this.deps.hermes,
        client,
        profileId,
        session,
        emit: (update) => this.emit(win, update),
        tileReady: newTile.ready,
        isCurrent,
        sendPrompt: (sessionId, text) => this.send(newTile, sessionId, text),
      });
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
      this.say(tile, "Your message wasn't sent — this tile has no agent session right now.");
      return;
    }
    await this.send(tile, route.sessionId, text);
  }

  /** Closes a tile from inside the app. The native close path lands in the same handler. */
  close(profileId: string): void {
    const tile = this.tiles.get(profileId);
    if (!tile) return;
    tile.client.stop();
    tile.win.close();
    this.tiles.delete(profileId);
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
    return tile.client.prompt(sessionId, text).then(
      () => this.emit(tile.win, { sessionUpdate: 'circe/turn-end' }),
      (err: unknown) => {
        this.emit(tile.win, { sessionUpdate: 'circe/turn-end' });
        const message = err instanceof Error ? err.message : String(err);
        // Deliberately does not name a cause: this fires for a dead connection,
        // a stopped client and an agent-side error alike, and the attached
        // message is the only thing that actually knows which.
        this.say(tile, `Your message wasn't sent. (${message})`);
      },
    );
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
