import { spawn, type ChildProcess } from 'node:child_process';
import { homedir } from 'node:os';
import { hermesPaths } from './hermes/runtime';

export interface AcpUpdate {
  /**
   * The *inner* `update` object of an ACP `session/update` notification —
   * `{ sessionUpdate, ... }` — passed through to the renderer as-is.
   */
  [key: string]: unknown;
}

export interface AcpOptions {
  profileId: string;
  cwd?: string;
  /**
   * `sessionId` is the *outer* `params.sessionId` of the notification; `update`
   * is the inner object carrying `sessionUpdate`. One client serves several
   * sessions, so the id is the only thing that says which tab an update belongs
   * to — forwarding the update alone would land a replayed history in whatever
   * tab happened to be active.
   */
  onUpdate(sessionId: string, update: AcpUpdate): void;
  onExit(code: number | null): void;
}

/** Splits a newline-delimited JSON stream, returning whatever is left over. */
export function parseFrames(buffer: string): { frames: unknown[]; rest: string } {
  const lines = buffer.split('\n');
  const rest = lines.pop() ?? '';
  const frames: unknown[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      frames.push(JSON.parse(trimmed));
    } catch {
      // Hermes writes human-readable startup lines before the protocol begins.
    }
  }
  return { frames, rest };
}

/** initialize / session/new should answer quickly; a stall there is unambiguous. */
const HANDSHAKE_TIMEOUT_MS = 30_000;

export class AcpClient {
  private child: ChildProcess | null = null;
  private buffer = '';
  private nextId = 1;
  private pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
  private loadSessionSupported = false;
  private startPromise: Promise<void> | null = null;

  constructor(private opts: AcpOptions) {}

  /**
   * Spawns `hermes -p <profile> acp` and completes the ACP handshake. Idempotent:
   * a second call while starting (or already started) returns the same promise
   * rather than spawning a second child that would share this instance's request-id
   * space and get its `exit` handler reject the live session's pending requests
   * (ported from acpClient.js:115's `if (this._child) return this._ready;` guard).
   *
   * A failed start stays cached as a rejection: repeated calls keep returning the
   * same rejected promise until `stop()` is called. This is deliberate, not
   * inherited — it matches the prototype's shape, and an explicit stop()-then-
   * start() to retry is more predictable than a silent auto-respawn on every call
   * to a client that's failing to start.
   */
  start(): Promise<void> {
    if (!this.startPromise) this.startPromise = this.doStart();
    return this.startPromise;
  }

  private async doStart(): Promise<void> {
    const { bin } = hermesPaths();
    // Captured locally so the `exit` closure below can tell whether it belongs
    // to the child that's still current by the time it fires. `kill()` is
    // asynchronous, so a superseded child's `exit` can arrive after a restart
    // has already assigned `this.child` to a new process — without this check
    // it would reject the new child's in-flight requests and report a false
    // `onExit` for a session that's actually running fine.
    const child = spawn(bin, ['-p', this.opts.profileId, 'acp', '--accept-hooks'], {
      cwd: this.opts.cwd ?? homedir(),
      env: { ...process.env, HERMES_ACCEPT_HOOKS: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;

    child.stdout!.on('data', (b: Buffer) => this.onData(b.toString()));
    child.stderr!.on('data', (b: Buffer) =>
      process.stderr.write(`[acp:${this.opts.profileId}] ${b}`),
    );
    child.on('exit', (code) => {
      if (this.child !== child) return; // belongs to a superseded child
      for (const p of this.pending.values()) p.reject(new Error(`hermes acp exited (${code})`));
      this.pending.clear();
      this.opts.onExit(code);
    });

    await this.handshake();
  }

  /**
   * The half of startup that talks protocol rather than spawning. Separate so
   * it can be tested without a subprocess, and so `doStart` no longer creates a
   * session: whether to resume an existing conversation or begin a new one is a
   * decision for the caller, made after the handshake tells us whether resuming
   * is possible at all.
   */
  private async handshake(): Promise<void> {
    const init = (await this.request(
      'initialize',
      {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
      },
      HANDSHAKE_TIMEOUT_MS,
    )) as { agentCapabilities?: { loadSession?: unknown } } | null;
    this.loadSessionSupported = init?.agentCapabilities?.loadSession === true;
  }

  /** Whether this agent can resume a prior conversation (Hermes 0.14.0: yes). */
  get canLoadSession(): boolean {
    return this.loadSessionSupported;
  }

  async newSession(): Promise<string> {
    const session = (await this.request(
      'session/new',
      { cwd: this.opts.cwd ?? homedir(), mcpServers: [] },
      HANDSHAKE_TIMEOUT_MS,
    )) as { sessionId: string };
    return session.sessionId;
  }

  /**
   * Resumes a prior conversation. Hermes rehydrates it from its own store and
   * replays the history outbound as `session/update` notifications — Circe
   * uploads nothing.
   *
   * Returns false rather than throwing on every failure path, because every
   * failure has the same sane answer: open a fresh session. A session id can
   * legitimately go stale (the profile was deleted, the store was cleared), and
   * a tile that refuses to open because last week's conversation is gone would
   * be worse than one that starts empty.
   */
  async loadSession(sessionId: string): Promise<boolean> {
    if (!this.loadSessionSupported) return false;
    try {
      await this.request(
        'session/load',
        { cwd: this.opts.cwd ?? homedir(), sessionId, mcpServers: [] },
        HANDSHAKE_TIMEOUT_MS,
      );
      return true;
    } catch (err) {
      console.warn(`Could not resume ACP session ${sessionId}; starting a new one.`, err);
      return false;
    }
  }

  // No timeout on session/prompt: a real agent turn can legitimately run for
  // minutes (reasoning, tool calls, network round-trips). Any timeout short enough
  // to be useful would abort real work, and any value long enough to be safe
  // wouldn't catch anything — killing a working agent mid-thought is worse than
  // the hang it would prevent. If the process actually dies, the `exit` handler
  // above still rejects every pending request, prompt included.
  async prompt(sessionId: string, text: string): Promise<void> {
    await this.request('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text }],
    });
  }

  // Returns the client to a genuinely restartable state and leaves nothing behind
  // for a killed child to act on later. Clearing only `child` would leave
  // `startPromise` cached (so a later start() replays the stale settled promise
  // instead of spawning), `loadSessionSupported` set (so a later loadSession()
  // would attempt a request against a null child instead of correctly refusing),
  // `pending` requests waiting on an `exit` event that may arrive late or never
  // (the exit-identity check above would in fact ignore it, since `this.child`
  // is about to become a different process or null), and a trailing partial
  // line in `buffer` that would otherwise get concatenated onto the next
  // child's first stdout chunk. `nextId` is left alone: monotonic ids across
  // restarts are harmless and avoid any chance of id reuse.
  stop(): void {
    this.child?.kill();
    this.child = null;
    this.startPromise = null;
    this.loadSessionSupported = false;
    this.buffer = '';
    for (const p of this.pending.values()) p.reject(new Error('ACP client stopped'));
    this.pending.clear();
  }

  private onData(chunk: string): void {
    const { frames, rest } = parseFrames(this.buffer + chunk);
    this.buffer = rest;
    for (const frame of frames) this.handle(frame as Record<string, unknown>);
  }

  private handle(msg: Record<string, unknown>): void {
    // A reply to something we asked.
    if (typeof msg.id === 'number' && !('method' in msg)) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result);
      return;
    }
    // A streaming update from the agent. ACP wraps the interesting part one
    // level down: params are `{ sessionId, update: { sessionUpdate, ... } }`,
    // and `sessionUpdate` — the discriminator every consumer branches on —
    // lives on the inner object, never on `params` itself. Forwarding
    // `params` handed the renderer an object whose `sessionUpdate` was always
    // `undefined`, so no branch ever fired and no reply was ever displayed.
    // The inner object is what goes out; the outer `sessionId` goes out too,
    // separately, because one client now serves several sessions and it is the
    // only thing that says which one this update belongs to.
    if (msg.method === 'session/update') {
      const params = (msg.params ?? {}) as { sessionId?: unknown; update?: unknown };
      const { sessionId, update } = params;
      if (typeof sessionId === 'string' && update && typeof update === 'object') {
        this.opts.onUpdate(sessionId, update as AcpUpdate);
      }
      return;
    }
    // A permission request. This slice runs the tile unlocked, so approve the
    // first allow-shaped option. A gate UI is a later phase (spec §6.4).
    if (msg.method === 'session/request_permission' && typeof msg.id === 'number') {
      const params = (msg.params ?? {}) as { options?: Array<Record<string, string>> };
      const allow = params.options?.find((o) => (o.kind ?? '').startsWith('allow'));
      this.send({
        jsonrpc: '2.0',
        id: msg.id,
        result: allow
          ? { outcome: { outcome: 'selected', optionId: allow.optionId || allow.name } }
          : { outcome: { outcome: 'cancelled' } },
      });
    }
  }

  /**
   * `timeoutMs` is only passed by the handshake (`initialize`, `session/new`) —
   * see the comment on `prompt()` for why `session/prompt` deliberately omits it.
   */
  private request(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (timeoutMs !== undefined) {
        timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`hermes acp handshake timed out waiting for ${method}`));
        }, timeoutMs);
      }
      this.pending.set(id, {
        resolve: (v) => {
          if (timer) clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          if (timer) clearTimeout(timer);
          reject(e);
        },
      });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  private send(msg: unknown): void {
    this.child?.stdin?.write(`${JSON.stringify(msg)}\n`);
  }
}
