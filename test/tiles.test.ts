import { describe, expect, it } from 'vitest';
import { TileRegistry, type TileClient, type TileDeps, type TileWindow } from '../src/main/tiles';
import { FakeHermes, INSTALLED_EMPTY } from './fake/hermes';
import type { Character } from '../src/shared/types';

const PALETTE = { bg: '#1e2952', border: '#c7d2fe', accent: '#a5b4fc' };

/** A PNG is identified by its 8-byte signature; these tests never need a real image. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function character(profileId: string): Character {
  return {
    name: profileId,
    profileId,
    tagline: '',
    palette: PALETTE,
    why: '',
    fandom: '',
    voice: '',
  intro: '',
    greeting: '',
    voiceCheck: '',
  };
}

/**
 * Drains the microtask queue. `restoreOrCreateSession`'s "resume a prior
 * session" branch is several `await`s deep (a file read, an `isCurrent`
 * check, another) before it reaches `await tileReady` — a test that fires the
 * window's `closed` event immediately, before any of those microtasks run,
 * never gets the code there at all: the map deletion that same event triggers
 * makes the *outer* `isCurrent()` check (the one guarding entry into that
 * branch) return early, and `tileReady` is never awaited in the first place.
 * `setImmediate` is a macrotask, so by the time it fires every microtask
 * queued so far — including that whole chain — has drained, and execution is
 * actually parked at `await tileReady`, which is the state this needs.
 */
async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

/** Seeds `circe/state.json` as if a previous launch had already saved a session. */
function withSavedSession(hermes: FakeHermes, profileId: string, sessionId: string): void {
  hermes.files.set(
    'circe/state.json',
    JSON.stringify({
      version: 1,
      profiles: { [profileId]: { tabs: [sessionId], activeIndex: 0 } },
    }),
  );
}

/** A window that records what it was sent and lets a test fire its events. */
class FakeWindow implements TileWindow {
  readonly sent: Array<{ channel: string; payload: unknown }> = [];
  destroyed = false;
  shown = 0;
  focused = 0;
  minimized = false;
  restored = 0;
  closeCalls = 0;
  readonly sender = {};
  /**
   * Simulates the real-world gap between a window's `closed` event firing and
   * its `isDestroyed()` reporting true — Electron does not guarantee these are
   * atomic. `isCurrent()` is the guard that has to hold even when this lags;
   * `emit()`'s own `isDestroyed()` check is not enough on its own.
   */
  lagDestroy = false;
  private loaded: Array<() => void> = [];
  private failed: Array<() => void> = [];
  private closedCbs: Array<() => void> = [];

  send(channel: string, payload: unknown): void {
    this.sent.push({ channel, payload });
  }
  isDestroyed(): boolean {
    return this.lagDestroy ? false : this.destroyed;
  }
  close(): void {
    this.closeCalls++;
    this.fireClosed();
  }
  show(): void {
    this.shown++;
  }
  focus(): void {
    this.focused++;
  }
  isMinimized(): boolean {
    return this.minimized;
  }
  restore(): void {
    this.restored++;
  }
  ownsSender(s: unknown): boolean {
    return s === this.sender;
  }
  onceLoaded(cb: () => void): void {
    this.loaded.push(cb);
  }
  onceFailedLoad(cb: () => void): void {
    this.failed.push(cb);
  }
  onceClosed(cb: () => void): void {
    this.closedCbs.push(cb);
  }

  fireLoaded(): void {
    this.loaded.splice(0).forEach((cb) => cb());
  }
  fireFailedLoad(): void {
    this.failed.splice(0).forEach((cb) => cb());
  }
  fireClosed(): void {
    this.destroyed = true;
    this.closedCbs.splice(0).forEach((cb) => cb());
  }
  /** Only the payloads of `tile:update`, which is where circe/* events ride. */
  updates(): Array<Record<string, unknown>> {
    return this.sent
      .filter((s) => s.channel === 'tile:update')
      .map((s) => s.payload as Record<string, unknown>);
  }
  /** Only the payloads of `tile:character`, which carries a live re-theme. */
  characters(): Character[] {
    return this.sent
      .filter((s) => s.channel === 'tile:character')
      .map((s) => s.payload as Character);
  }
  /** Only the text of `tile:opening`, which is where prose reaches the tile. */
  openings(): string[] {
    return this.sent.filter((s) => s.channel === 'tile:opening').map((s) => s.payload as string);
  }
  /** Only the payloads of `tile:avatar`, which carries the profile's face or null. */
  avatars(): Array<string | null> {
    return this.sent
      .filter((s) => s.channel === 'tile:avatar')
      .map((s) => s.payload as string | null);
  }
}

class FakeClient implements TileClient {
  canLoadSession = false;
  canListSessions = false;
  started = false;
  stopped = 0;
  readonly prompts: Array<{ sessionId: string; text: string }> = [];
  /** How many times this client's own `newSession` was actually called. */
  newSessionCalls = 0;
  /**
   * Armed by the harness at construction, never set afterwards: `launch` calls
   * `start()` before it returns to the test, so a test that assigns this after
   * calling `launch` would arm a gun already fired.
   */
  constructor(readonly startError: Error | null = null) {}
  /** Resolves `prompt`; a test can hold a turn open by not calling it. */
  private resolvePrompt: (() => void) | null = null;
  /**
   * `start()` waits on this until `releaseStart()` is called, so a test can
   * keep a launch genuinely in flight — mid-`await` — while a second launch
   * for the same profile runs to completion, which is the only way to observe
   * what a superseded launch would have done if `isCurrent()` did not exist.
   */
  private startGate: Promise<void> = Promise.resolve();
  private releaseStartFn: (() => void) | null = null;
  onUpdate: (sessionId: string, update: Record<string, unknown>) => void = () => {};
  onExit: (code: number | null) => void = () => {};
  private nextSession = 1;

  holdStart(): void {
    this.startGate = new Promise((resolve) => {
      this.releaseStartFn = resolve;
    });
  }
  releaseStart(): void {
    this.releaseStartFn?.();
    this.releaseStartFn = null;
  }

  async start(): Promise<void> {
    await this.startGate;
    if (this.startError) throw this.startError;
    this.started = true;
  }
  stop(): void {
    this.stopped++;
  }
  async newSession(): Promise<string> {
    this.newSessionCalls++;
    return `session-${this.nextSession++}`;
  }
  async loadSession(): Promise<boolean> {
    return true;
  }
  async listSessions(): Promise<string[] | null> {
    return null;
  }
  prompt(sessionId: string, text: string): Promise<void> {
    this.prompts.push({ sessionId, text });
    return new Promise((resolve) => {
      this.resolvePrompt = resolve;
    });
  }
  finishTurn(): void {
    this.resolvePrompt?.();
    this.resolvePrompt = null;
  }
}

interface Harness {
  registry: TileRegistry;
  windows: FakeWindow[];
  clients: FakeClient[];
  hermes: FakeHermes;
  /** The cascade `index` each `createWindow` call was given, in call order. */
  indices: number[];
  /**
   * Arms the *next* client `createClient` produces, then resets. Necessary
   * because `launch` creates and starts a client synchronously, before its
   * promise is ever returned to the test — arming a client after the test
   * already holds a reference to it would be arming a gun already fired.
   */
  armNext(opts: { startError?: Error | null; holdStart?: boolean }): void;
}

/**
 * `startError` arms the *first* client to fail its handshake — kept as a
 * constructor argument for the existing "cannot reach its agent" tests.
 * `armNext` on the returned harness covers every other per-launch arming.
 */
function harness(startError: Error | null = null): Harness {
  const windows: FakeWindow[] = [];
  const clients: FakeClient[] = [];
  const hermes = new FakeHermes(INSTALLED_EMPTY);
  const indices: number[] = [];
  let nextStartError = startError;
  let nextHoldStart = false;
  const deps: TileDeps = {
    hermes,
    createWindow: (_character, _profileId, index) => {
      const w = new FakeWindow();
      windows.push(w);
      indices.push(index);
      return w;
    },
    createClient: (opts) => {
      const c = new FakeClient(nextStartError);
      if (nextHoldStart) c.holdStart();
      nextStartError = null;
      nextHoldStart = false;
      c.onUpdate = opts.onUpdate;
      c.onExit = opts.onExit;
      clients.push(c);
      return c;
    },
  };
  return {
    registry: new TileRegistry(deps),
    windows,
    clients,
    hermes,
    indices,
    armNext(opts) {
      if ('startError' in opts) nextStartError = opts.startError ?? null;
      if ('holdStart' in opts) nextHoldStart = opts.holdStart ?? false;
    },
  };
}

/** Launches and lets the window finish loading, which is the happy path. */
async function launched(h: Harness, profileId = 'default'): Promise<void> {
  const launch = h.registry.launch(character(profileId), profileId);
  h.windows[h.windows.length - 1]!.fireLoaded();
  await launch;
}

describe('launching a tile', () => {
  it('creates one window and one client, and starts the client', async () => {
    const h = harness();
    await launched(h);

    expect(h.windows).toHaveLength(1);
    expect(h.clients).toHaveLength(1);
    expect(h.clients[0]!.started).toBe(true);
  });

  it('paints the greeting once the renderer has loaded, not before', async () => {
    const h = harness();
    const launch = h.registry.launch(character('default'), 'default', 'Hello.');
    const win = h.windows[0]!;

    expect(win.openings()).toEqual([]); // queued, not sent

    win.fireLoaded();
    await launch;

    expect(win.openings()).toEqual(['Hello.']);
  });

  it('does not replay the greeting when reopened without one', async () => {
    const h = harness();
    const first = h.registry.launch(character('default'), 'default', 'Hello.');
    h.windows[0]!.fireLoaded();
    await first;
    expect(h.windows[0]!.openings()).toEqual(['Hello.']); // sanity: it did greet the first time

    h.registry.close('default');
    await launched(h); // reopened with no greeting

    expect(h.windows[1]!.openings()).toEqual([]);
  });

  it('opens a session and persists it', async () => {
    const h = harness();
    await launched(h);

    expect(h.registry.openProfileIds()).toEqual(['default']);
    // Persisted only if `restoreOrCreateSession` actually ran and opened one —
    // `openProfileIds()` alone would pass even if it were never called.
    expect(h.hermes.files.has('circe/state.json')).toBe(true);
  });

  it('gives each profile its own window and client', async () => {
    const h = harness();
    await launched(h, 'default');
    await launched(h, 'ford');

    expect(h.windows).toHaveLength(2);
    expect(h.clients).toHaveLength(2);
    expect(h.registry.openProfileIds().sort()).toEqual(['default', 'ford']);
  });
});

// The tile is a window of its own, not the wizard's meet screen, and it reads
// the same stored face on its own channel (`tile:avatar`) because a base64
// PNG does not fit in the window URL alongside the rest of the character.
describe('sending the tile its avatar', () => {
  it('sends the profile’s face once the tile has loaded', async () => {
    const h = harness();
    h.hermes.bytes.set('avatar.png', PNG);
    await launched(h);
    await flushMicrotasks();

    expect(h.windows[0]!.avatars()).toEqual([expect.stringMatching(/^data:image\/png;base64,/)]);
  });

  // The ordinary case: most profiles have no face, and that must not be an
  // error — the renderer falls back to initials on a null, never a thrown
  // exception.
  it('sends null when the profile has no face', async () => {
    const h = harness();
    await launched(h);
    await flushMicrotasks();

    expect(h.windows[0]!.avatars()).toEqual([null]);
  });

  it('resends the avatar when the tile is re-themed', async () => {
    const h = harness();
    await launched(h);
    await flushMicrotasks();
    h.hermes.bytes.set('avatar.png', PNG);

    h.registry.retheme('default', { ...character('default'), name: 'Renamed' });
    await flushMicrotasks();

    expect(h.windows[0]!.avatars()).toEqual([null, expect.stringMatching(/^data:image\/png;base64,/)]);
  });

  // `readAvatarDataUrl` only swallows "the file genuinely isn't there"
  // (ENOENT/ENOTDIR) and rethrows everything else, by design — a permissions
  // problem or a corrupted home directory rejects. Without a `.catch()` at the
  // send site that rejection is an unhandled promise rejection in the main
  // process, not the silent failure this feature requires. This test would
  // fail (an unhandled rejection, and the tile never finishing its launch) if
  // that `.catch()` were removed.
  it('does not throw and still opens the tile when the face read fails for a reason other than "missing"', async () => {
    const h = harness();
    h.hermes.readHomeFileBytes = async () => {
      throw new Error('EACCES: permission denied');
    };

    await launched(h);
    await flushMicrotasks();

    expect(h.registry.openProfileIds()).toEqual(['default']);
    expect(h.windows[0]!.avatars()).toEqual([null]);
  });
});

// The old `if (tileWin) return` was a silent no-op. A directory watch fires
// again on a profile whose files are touched, and `activate` needs to raise a
// specific tile — §4.3.1.
describe('launching a profile that already has a tile', () => {
  it('shows and focuses the existing tile instead of opening a second', async () => {
    const h = harness();
    await launched(h);

    await h.registry.launch(character('default'), 'default');

    expect(h.windows).toHaveLength(1);
    expect(h.windows[0]!.shown).toBe(1);
    expect(h.windows[0]!.focused).toBe(1);
  });

  it('un-minimises it', async () => {
    const h = harness();
    await launched(h);
    h.windows[0]!.minimized = true;

    await h.registry.launch(character('default'), 'default');

    expect(h.windows[0]!.restored).toBe(1);
  });
});

describe('has and raise', () => {
  it('has() reports whether a profile currently has a tile', async () => {
    const h = harness();
    expect(h.registry.has('default')).toBe(false);

    await launched(h);

    expect(h.registry.has('default')).toBe(true);
  });

  it('raise() brings an existing tile forward and reports true', async () => {
    const h = harness();
    await launched(h);

    expect(h.registry.raise('default')).toBe(true);
    expect(h.windows[0]!.shown).toBe(1);
    expect(h.windows[0]!.focused).toBe(1);
  });

  it('raise() reports false for a profile with no tile', () => {
    const h = harness();

    expect(h.registry.raise('nobody')).toBe(false);
  });
});

describe('the ready promise', () => {
  // `tile.ready` is only ever awaited inside `restore.ts`'s "resume a prior
  // session" branch, which requires a saved session id and a client that can
  // load one. Without both, no test below would ever actually await it.
  it('resolves on a failed load, so a launch never hangs', async () => {
    const h = harness();
    withSavedSession(h.hermes, 'default', 'session-1');
    const launch = h.registry.launch(character('default'), 'default');
    h.clients[0]!.canLoadSession = true;
    h.windows[0]!.fireFailedLoad();

    await expect(launch).resolves.toBeUndefined();
  });

  it('resolves when the window is closed before it ever loads', async () => {
    const h = harness();
    withSavedSession(h.hermes, 'default', 'session-1');
    const launch = h.registry.launch(character('default'), 'default');
    h.clients[0]!.canLoadSession = true;

    // Let execution actually reach `await tileReady` before closing the
    // window — see `flushMicrotasks`. Closing it immediately would delete the
    // tile from the map before that point, and the launch would resolve via
    // the outer `isCurrent()` guard instead of via this promise at all.
    await flushMicrotasks();
    h.windows[0]!.fireClosed();

    await expect(launch).resolves.toBeUndefined();
  });
});

describe('routing updates', () => {
  it('draws an update for the session the tile is showing', async () => {
    const h = harness();
    await launched(h);

    h.clients[0]!.onUpdate('session-1', { sessionUpdate: 'agent_message_chunk' });

    expect(h.windows[0]!.updates()).toContainEqual({ sessionUpdate: 'agent_message_chunk' });
  });

  it('drops an update for a session the tile is not showing', async () => {
    const h = harness();
    await launched(h);
    const before = h.windows[0]!.updates().length;

    h.clients[0]!.onUpdate('some-other-session', { sessionUpdate: 'agent_message_chunk' });

    expect(h.windows[0]!.updates()).toHaveLength(before);
  });

  it('sends an update only to the tile that owns the client', async () => {
    const h = harness();
    await launched(h, 'default');
    await launched(h, 'ford');

    h.clients[1]!.onUpdate('session-1', { sessionUpdate: 'agent_message_chunk' });

    expect(h.windows[0]!.updates()).not.toContainEqual({
      sessionUpdate: 'agent_message_chunk',
    });
    expect(h.windows[1]!.updates()).toContainEqual({ sessionUpdate: 'agent_message_chunk' });
  });

  it('tells the tile when its agent exits', async () => {
    const h = harness();
    await launched(h);

    h.clients[0]!.onExit(1);

    expect(h.windows[0]!.updates()).toContainEqual({ sessionUpdate: 'circe/exited', code: 1 });
  });
});

describe('prompting', () => {
  it('sends to the tile’s own session and ends the turn when it resolves', async () => {
    const h = harness();
    await launched(h);

    const turn = h.registry.prompt('default', 'hello');
    expect(h.clients[0]!.prompts).toEqual([{ sessionId: 'session-1', text: 'hello' }]);

    h.clients[0]!.finishTurn();
    await turn;

    expect(h.windows[0]!.updates()).toContainEqual({ sessionUpdate: 'circe/turn-end' });
  });

  // Both outcomes end the turn: a failed prompt must not leave the previous
  // bubble streaming forever.
  it('ends the turn and says so when the prompt fails', async () => {
    const h = harness();
    await launched(h);
    h.clients[0]!.prompt = () => Promise.reject(new Error('connection closed'));

    await h.registry.prompt('default', 'hello');

    expect(h.windows[0]!.updates()).toContainEqual({ sessionUpdate: 'circe/turn-end' });
    expect(h.windows[0]!.openings().some((t) => t.includes('connection closed'))).toBe(true);
  });

  // There is no window to say anything into, so silence is the only option
  // here. Every branch that *does* have a tile ends in something visible.
  it('does nothing for a profile with no tile', async () => {
    const h = harness();
    await launched(h); // a real tile exists, to prove the "no tile" case doesn't touch it
    const sentBefore = h.windows[0]!.sent.length;

    await expect(h.registry.prompt('nobody', 'hello')).resolves.toBeUndefined();

    expect(h.windows[0]!.sent).toHaveLength(sentBefore);
    expect(h.clients[0]!.prompts).toEqual([]);
  });

  // The launch window: from tile creation to a live session, `route()` holds
  // rather than drops. Nothing should be drawn while a message sits there.
  it('holds a message typed during launch without emitting anything yet', () => {
    const h = harness();
    h.armNext({ holdStart: true });
    h.registry.launch(character('default'), 'default');
    const win = h.windows[0]!;

    void h.registry.prompt('default', 'are you there?');

    expect(win.sent).toEqual([]);
  });
});

describe('closing a tile', () => {
  it('stops the client and forgets the tile', async () => {
    const h = harness();
    await launched(h);

    h.registry.close('default');

    expect(h.clients[0]!.stopped).toBeGreaterThan(0);
    expect(h.registry.openProfileIds()).toEqual([]);
  });

  it('stops the client when the window is closed natively', async () => {
    const h = harness();
    await launched(h);

    h.windows[0]!.fireClosed();

    expect(h.clients[0]!.stopped).toBeGreaterThan(0);
    expect(h.registry.openProfileIds()).toEqual([]);
  });

  it('leaves another profile’s tile alone', async () => {
    const h = harness();
    await launched(h, 'default');
    await launched(h, 'ford');

    h.registry.close('ford');

    expect(h.registry.openProfileIds()).toEqual(['default']);
    expect(h.clients[0]!.stopped).toBe(0);
  });
});

// I3: the cascade index used to be `this.tiles.size`, which drops when a
// tile closes and can then repeat — landing a new tile on the exact
// coordinates of one still open. A monotonic counter fixes it; these tests
// are written to go red against `this.tiles.size` (see the report for the
// mutation proof).
describe('cascade index', () => {
  it('never repeats the index of a tile that is still open, even after one closes', async () => {
    const h = harness();
    await launched(h, 'a');
    await launched(h, 'b');
    await launched(h, 'c');
    await launched(h, 'd');
    expect(h.indices).toEqual([0, 1, 2, 3]);

    h.registry.close('b'); // frees up nothing an index-by-size scheme wouldn't reuse

    await launched(h, 'e');

    const liveIndices = [h.indices[0], h.indices[2], h.indices[3]]; // a, c, d
    expect(liveIndices).not.toContain(h.indices[4]);
  });

  it('keeps handing out increasing indices across many opens and closes', async () => {
    const h = harness();
    for (const id of ['a', 'b', 'c']) await launched(h, id);
    h.registry.close('a');
    h.registry.close('b');
    await launched(h, 'd');
    await launched(h, 'e');

    expect(h.indices).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('supersession', () => {
  // The guard Phase 1 established, per profile. A launch that has been
  // replaced must not act on shared state after its replacement is live.
  //
  // Closing the tile is what makes a genuine second launch for the same
  // profile possible at all (`launch` raises rather than duplicates while an
  // entry exists), so launch A's window is closed to free the profile up —
  // but its own `start()` is held open, so launch A is still mid-flight,
  // captured over its own now-stale `isCurrent`, when launch B registers and
  // finishes. Releasing A's start afterwards lets its `restoreOrCreateSession`
  // actually run its course; unguarded, it would call its own `newSession()`
  // and overwrite `circe/state.json` out from under the tile the user is
  // actually looking at.
  it('a superseded launch does not open a session or overwrite the live tile’s state', async () => {
    const h = harness();
    h.armNext({ holdStart: true });
    const first = h.registry.launch(character('default'), 'default');
    const clientA = h.clients[0]!;

    h.windows[0]!.fireClosed(); // frees the profile up for a real second launch
    await launched(h, 'default'); // launch B takes over the profile and finishes

    clientA.releaseStart();
    await first;

    expect(clientA.newSessionCalls).toBe(0);
    expect(h.registry.openProfileIds()).toEqual(['default']);
  });

  // Isolates `isCurrent()`'s own contribution from `emit()`'s `isDestroyed()`
  // fallback: the stale window is made to keep reporting itself as not
  // destroyed (`lagDestroy`), the real-world gap between a window's `closed`
  // event and `isDestroyed()` catching up. If `isCurrent()` weren't checked
  // first, the fallback alone would let this update through.
  it('a stale exit handler draws nothing once superseded, even if the old window has not reported itself destroyed yet', async () => {
    const h = harness();
    await launched(h);
    const staleClient = h.clients[0]!;
    const staleWin = h.windows[0]!;
    staleWin.lagDestroy = true;
    staleWin.fireClosed();
    await launched(h, 'default');
    const newWin = h.windows[1]!;

    staleClient.onExit(1);

    expect(staleWin.updates()).not.toContainEqual({ sessionUpdate: 'circe/exited', code: 1 });
    expect(newWin.updates()).not.toContainEqual({ sessionUpdate: 'circe/exited', code: 1 });
  });
});

describe('a launch that cannot reach its agent', () => {
  it('reaps the client and explains itself in the tile', async () => {
    const h = harness(new Error('spawn ENOENT'));
    const launch = h.registry.launch(character('default'), 'default');
    h.windows[0]!.fireLoaded();
    await launch;

    expect(h.clients[0]!.stopped).toBeGreaterThan(0);
    const text = h.windows[0]!.openings().join('\n');
    expect(text).toContain('spawn ENOENT');
    expect(text).toMatch(/hermes setup/);
  });

  it('reports a message typed while it was starting as unsent', async () => {
    const h = harness(new Error('spawn ENOENT'));
    const launch = h.registry.launch(character('default'), 'default');
    void h.registry.prompt('default', 'are you there?'); // held: launch in flight
    h.windows[0]!.fireLoaded();
    await launch;

    const text = h.windows[0]!.openings().join('\n');
    expect(text).toMatch(/message you typed while it was starting wasn't sent/i);
  });

  // The window is still on screen with an enabled input, so the tile stays
  // registered — orphaning it would make it unreachable by `prompt`, `close`,
  // `raise` and `profileForSender` alike, and a relaunch would then miss it
  // and stack a second window on top. A message typed afterward must land on
  // the "no session" branch, not silence.
  it('keeps the tile registered, so a message typed afterward gets a real answer', async () => {
    const h = harness(new Error('spawn ENOENT'));
    const launch = h.registry.launch(character('default'), 'default');
    h.windows[0]!.fireLoaded();
    await launch;

    expect(h.registry.openProfileIds()).toEqual(['default']);

    await h.registry.prompt('default', 'are you still there?');

    expect(h.windows[0]!.updates()).toContainEqual({ sessionUpdate: 'circe/turn-end' });
    expect(
      h.windows[0]!.openings().some((t) => t.includes('no agent session right now')),
    ).toBe(true);
  });

  // Registered, but with no live session: a relaunch must raise the same
  // window rather than stack a second one on top of it.
  it('raises the same tile on relaunch instead of opening a second one', async () => {
    const h = harness(new Error('spawn ENOENT'));
    const launch = h.registry.launch(character('default'), 'default');
    h.windows[0]!.fireLoaded();
    await launch;

    await h.registry.launch(character('default'), 'default');

    expect(h.windows).toHaveLength(1);
    expect(h.windows[0]!.shown).toBe(1);
    expect(h.windows[0]!.focused).toBe(1);
  });
});

describe('routing an IPC message to the tile that sent it', () => {
  it('names the profile a window belongs to', async () => {
    const h = harness();
    await launched(h, 'default');
    await launched(h, 'ford');

    expect(h.registry.profileForSender(h.windows[1]!.sender)).toBe('ford');
  });

  // A window may only ever speak for itself — §4.3.1.
  it('answers null for a sender it does not recognise', async () => {
    const h = harness();
    await launched(h);

    expect(h.registry.profileForSender({})).toBeNull();
  });
});

// D1 (2026-08-18 walkthrough): `SOUL.md` and `circe.json` do not arrive
// together. A tile launched on the first one shows `DEFAULT_PALETTE`, and
// nothing re-read the second — so every specialist the orchestrator created
// wore the wrong colours for its whole first session.
describe('re-theming an open tile', () => {
  const RECOLOURED = { bg: '#123524', border: '#a7f3d0', accent: '#34d399' };

  it('sends the new character when the palette has changed', async () => {
    const h = harness();
    await launched(h);

    h.registry.retheme('default', { ...character('default'), palette: RECOLOURED });

    expect(h.windows[0]!.characters()).toEqual([{ ...character('default'), palette: RECOLOURED }]);
  });

  it('sends the new character when the name has changed', async () => {
    const h = harness();
    await launched(h);

    h.registry.retheme('default', { ...character('default'), name: 'Master Patterner' });

    expect(h.windows[0]!.characters().map((c) => c.name)).toEqual(['Master Patterner']);
  });

  // The sweep runs on every write under `profiles/`, and an agent in
  // conversation writes memory and session state constantly. Re-sending an
  // identical character on each of those would repaint the tile for nothing.
  it('sends nothing when the character is unchanged', async () => {
    const h = harness();
    await launched(h);

    h.registry.retheme('default', character('default'));

    expect(h.windows[0]!.characters()).toEqual([]);
  });

  it('sends nothing on a second identical call after a real change', async () => {
    const h = harness();
    await launched(h);
    const recoloured = { ...character('default'), palette: RECOLOURED };

    h.registry.retheme('default', recoloured);
    h.registry.retheme('default', recoloured);

    expect(h.windows[0]!.characters()).toHaveLength(1);
  });

  it('does nothing for a profile that has no tile', async () => {
    const h = harness();
    await launched(h);

    h.registry.retheme('ford', { ...character('ford'), palette: RECOLOURED });

    expect(h.windows[0]!.characters()).toEqual([]);
  });
});
