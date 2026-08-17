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
  private listSessionsSupported = false;
  private startPromise: Promise<void> | null = null;

  constructor(private opts: AcpOptions) {}

  /**
   * The working directory this client presents to Hermes. Resolved in exactly
   * one place because it is not decoration: `session/load` has to present the
   * same `cwd` the session was created with, and separate literals in `spawn`,
   * `session/new` and `session/load` are three chances for them to drift apart.
   */
  private get cwd(): string {
    return this.opts.cwd ?? homedir();
  }

  /**
   * Every request needs a live child to answer it. Without this, a request
   * against a dead or never-started client is *silently accepted*: `send` is
   * optional-chained and a destroyed `stdin.write()` returns false rather than
   * throwing, so the frame goes nowhere and the promise never settles.
   * `session/prompt` deliberately carries no timeout (a real turn can run for
   * minutes), so "never settles" means the tile thinks forever with no
   * `circe/turn-end` — a hang, not an error. Failing loudly here is what turns
   * that into something the user can be told about.
   */
  private assertRunning(): void {
    if (!this.child) throw new Error('ACP client is not running');
  }

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
      cwd: this.cwd,
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
      // Dropped here, not just in `stop()`. A child that dies on its own leaves
      // a `ChildProcess` object behind whose `stdin` is destroyed, so keeping
      // the reference would let `assertRunning()` wave through every later
      // request into a write that goes nowhere — the exact hang the guard
      // exists to prevent, reached without anyone ever calling `stop()`.
      this.child = null;
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
    )) as {
      agentCapabilities?: { loadSession?: unknown; sessionCapabilities?: { list?: unknown } };
    } | null;
    this.loadSessionSupported = init?.agentCapabilities?.loadSession === true;
    // Not a sibling of `loadSession` and not a boolean: Hermes 0.14.0 answers
    // `sessionCapabilities: { fork: {}, list: {}, resume: {} }` (spec §2), so
    // the capability is carried by the key's *presence* and its value is an
    // empty object. `=== true` would therefore read it as unsupported and
    // silently disable the staleness check below. An explicit `false` is still
    // honoured as a refusal, in case a later agent spells it that way.
    const list = init?.agentCapabilities?.sessionCapabilities?.list;
    this.listSessionsSupported = list === true || (typeof list === 'object' && list !== null);
  }

  /** Whether this agent can resume a prior conversation (Hermes 0.14.0: yes). */
  get canLoadSession(): boolean {
    return this.loadSessionSupported;
  }

  /** Whether this agent can enumerate its stored sessions (Hermes 0.14.0: yes). */
  get canListSessions(): boolean {
    return this.listSessionsSupported;
  }

  /**
   * The ids of the conversations the agent still has. Used to check a saved id
   * before resuming it, because `session/load` is not a check: Hermes 0.14.0
   * answers `{}` — success — for a session id it has never seen. Without this
   * the tile "resumes" a conversation that does not exist, comes back empty
   * with no explanation, and keeps the dead id in `circe/state.json` forever,
   * retrying the same corpse on every later cold start.
   *
   * Returns `null`, not `[]`, for every case where the answer is unknown: the
   * agent does not support listing, the request failed, or the response was
   * not the documented shape. The distinction is load-bearing — `[]` is a real
   * answer meaning "this agent has no sessions at all", which is precisely the
   * cleared-store case the caller must act on, and conflating it with "could
   * not tell" would either re-open the defect or throw away a live session id
   * because one request failed.
   *
   * A dead client throws, as `loadSession` does and for the same reason: the
   * caller's fallback is `session/new` on this same client, which cannot work
   * either, and the launch should fail loudly now rather than 30s from now.
   */
  async listSessions(): Promise<string[] | null> {
    if (!this.listSessionsSupported) return null;
    this.assertRunning();
    try {
      // Answered identically with no params and with `{cwd}` when probed; the
      // cwd goes with it for the same reason `session/load` carries one — every
      // request this client makes describes the same working directory.
      const result = (await this.request(
        'session/list',
        { cwd: this.cwd },
        HANDSHAKE_TIMEOUT_MS,
      )) as { sessions?: unknown } | null;
      const sessions = result?.sessions;
      if (!Array.isArray(sessions)) return null;
      return sessions
        .map((s) => (s as { sessionId?: unknown } | null)?.sessionId)
        .filter((id): id is string => typeof id === 'string');
    } catch (err) {
      // Survivable: the caller falls back to attempting the load, which is the
      // behaviour of every build before listing existed.
      console.warn('Could not list ACP sessions; resuming without checking the saved id.', err);
      return null;
    }
  }

  async newSession(): Promise<string> {
    this.assertRunning();
    const session = (await this.request(
      'session/new',
      { cwd: this.cwd, mcpServers: [] },
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
   *
   * A dead client is the one failure that *throws* instead, because it is the
   * one where a fresh session is not the sane answer: `session/new` on the same
   * dead client cannot succeed either, and answering false here would send the
   * caller off to burn the full 30s handshake timeout before the user is told
   * anything. The capability check comes first, so a client that was never
   * started still answers the documented false rather than throwing.
   */
  async loadSession(sessionId: string): Promise<boolean> {
    if (!this.loadSessionSupported) return false;
    this.assertRunning();
    try {
      await this.request(
        'session/load',
        { cwd: this.cwd, sessionId, mcpServers: [] },
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
    this.assertRunning();
    await this.request('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text }],
    });
  }

  // Returns the client to a genuinely restartable state and leaves nothing behind
  // for a killed child to act on later. Clearing only `child` would leave
  // `startPromise` cached (so a later start() replays the stale settled promise
  // instead of spawning), the capability flags set (so a later loadSession() or
  // listSessions() would attempt a request against a null child instead of
  // correctly refusing),
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
    this.listSessionsSupported = false;
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
