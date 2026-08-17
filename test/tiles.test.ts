import { describe, expect, it } from 'vitest';
import { TileRegistry, type TileClient, type TileDeps, type TileWindow } from '../src/main/tiles';
import { FakeHermes, INSTALLED_EMPTY } from './fake/hermes';
import type { Character } from '../src/shared/types';

const PALETTE = { bg: '#1e2952', border: '#c7d2fe', accent: '#a5b4fc' };

function character(profileId: string): Character {
  return { name: profileId, profileId, tagline: '', palette: PALETTE, why: '', fandom: '' };
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
  private loaded: Array<() => void> = [];
  private failed: Array<() => void> = [];
  private closedCbs: Array<() => void> = [];

  send(channel: string, payload: unknown): void {
    this.sent.push({ channel, payload });
  }
  isDestroyed(): boolean {
    return this.destroyed;
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
  /** Only the text of `tile:opening`, which is where prose reaches the tile. */
  openings(): string[] {
    return this.sent.filter((s) => s.channel === 'tile:opening').map((s) => s.payload as string);
  }
}

class FakeClient implements TileClient {
  canLoadSession = false;
  canListSessions = false;
  started = false;
  stopped = 0;
  readonly prompts: Array<{ sessionId: string; text: string }> = [];
  /**
   * Armed by the harness at construction, never set afterwards: `launch` calls
   * `start()` before it returns to the test, so a test that assigns this after
   * calling `launch` would arm a gun already fired.
   */
  constructor(readonly startError: Error | null = null) {}
  /** Resolves `prompt`; a test can hold a turn open by not calling it. */
  private resolvePrompt: (() => void) | null = null;
  onUpdate: (sessionId: string, update: Record<string, unknown>) => void = () => {};
  onExit: (code: number | null) => void = () => {};
  private nextSession = 1;

  async start(): Promise<void> {
    if (this.startError) throw this.startError;
    this.started = true;
  }
  stop(): void {
    this.stopped++;
  }
  async newSession(): Promise<string> {
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
}

/**
 * `startError` arms the *next* client to fail its handshake. It is a harness
 * argument rather than a field a test sets afterwards because `launch` calls
 * `client.start()` synchronously, before its promise ever returns to the test.
 */
function harness(startError: Error | null = null): Harness {
  const windows: FakeWindow[] = [];
  const clients: FakeClient[] = [];
  const hermes = new FakeHermes(INSTALLED_EMPTY);
  const deps: TileDeps = {
    hermes,
    createWindow: () => {
      const w = new FakeWindow();
      windows.push(w);
      return w;
    },
    createClient: (opts) => {
      const c = new FakeClient(startError);
      c.onUpdate = opts.onUpdate;
      c.onExit = opts.onExit;
      clients.push(c);
      return c;
    },
  };
  return { registry: new TileRegistry(deps), windows, clients, hermes };
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
    await launched(h);
    h.registry.close('default');

    await launched(h);

    expect(h.windows[1]!.openings()).toEqual([]);
  });

  it('opens a session and remembers it', async () => {
    const h = harness();
    await launched(h);

    expect(h.registry.openProfileIds()).toEqual(['default']);
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

describe('the ready promise', () => {
  it('resolves on a failed load, so a launch never hangs', async () => {
    const h = harness();
    const launch = h.registry.launch(character('default'), 'default');
    h.windows[0]!.fireFailedLoad();

    await expect(launch).resolves.toBeUndefined();
  });

  it('resolves when the window is closed before it ever loads', async () => {
    const h = harness();
    const launch = h.registry.launch(character('default'), 'default');
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
    await expect(h.registry.prompt('nobody', 'hello')).resolves.toBeUndefined();
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

describe('supersession', () => {
  // The guard Phase 1 established, per profile. A launch that has been replaced
  // must not stop, draw into, or clear the launch that replaced it.
  it('a superseded launch does not clear the live tile’s session', async () => {
    const h = harness();
    const first = h.registry.launch(character('default'), 'default');
    const firstWin = h.windows[0]!;

    // The tile is closed and reopened while the first launch is still in flight.
    firstWin.fireClosed();
    await launched(h, 'default');
    await first;

    expect(h.registry.openProfileIds()).toEqual(['default']);
  });

  it('a stale exit handler does not draw into the new tile', async () => {
    const h = harness();
    await launched(h);
    const staleClient = h.clients[0]!;
    h.windows[0]!.fireClosed();
    await launched(h, 'default');
    const newWin = h.windows[1]!;

    staleClient.onExit(1);

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

  // The tile is gone from the registry, so a later message has nowhere to go
  // and must not resurrect it.
  it('forgets the tile, so the profile can be launched again', async () => {
    const h = harness(new Error('spawn ENOENT'));
    const launch = h.registry.launch(character('default'), 'default');
    h.windows[0]!.fireLoaded();
    await launch;

    expect(h.registry.openProfileIds()).toEqual([]);
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
