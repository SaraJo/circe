import { spawn, type ChildProcess } from 'node:child_process';
import { homedir } from 'node:os';
import { hermesPaths } from './hermes/runtime';

export interface AcpUpdate {
  /** ACP session/update payload, passed through to the renderer as-is. */
  [key: string]: unknown;
}

export interface AcpOptions {
  profileId: string;
  cwd?: string;
  onUpdate(update: AcpUpdate): void;
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
  private sessionId: string | null = null;
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
    this.child = spawn(bin, ['-p', this.opts.profileId, 'acp', '--accept-hooks'], {
      cwd: this.opts.cwd ?? homedir(),
      env: { ...process.env, HERMES_ACCEPT_HOOKS: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.child.stdout!.on('data', (b: Buffer) => this.onData(b.toString()));
    this.child.stderr!.on('data', (b: Buffer) =>
      process.stderr.write(`[acp:${this.opts.profileId}] ${b}`),
    );
    this.child.on('exit', (code) => {
      for (const p of this.pending.values()) p.reject(new Error(`hermes acp exited (${code})`));
      this.pending.clear();
      this.opts.onExit(code);
    });

    await this.request(
      'initialize',
      {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
      },
      HANDSHAKE_TIMEOUT_MS,
    );
    const session = (await this.request(
      'session/new',
      { cwd: this.opts.cwd ?? homedir(), mcpServers: [] },
      HANDSHAKE_TIMEOUT_MS,
    )) as { sessionId: string };
    this.sessionId = session.sessionId;
  }

  // No timeout on session/prompt: a real agent turn can legitimately run for
  // minutes (reasoning, tool calls, network round-trips). Any timeout short enough
  // to be useful would abort real work, and any value long enough to be safe
  // wouldn't catch anything — killing a working agent mid-thought is worse than
  // the hang it would prevent. If the process actually dies, the `exit` handler
  // above still rejects every pending request, prompt included.
  async prompt(text: string): Promise<void> {
    if (!this.sessionId) throw new Error('ACP session not started');
    await this.request('session/prompt', {
      sessionId: this.sessionId,
      prompt: [{ type: 'text', text }],
    });
  }

  // Returns the client to a genuinely restartable state: clearing only `child`
  // would leave `startPromise` cached (so a later start() replays the stale
  // settled promise instead of spawning) and `sessionId` set (so prompt() would
  // pass its own guard and write to a null child, hanging with no exit event to
  // ever reject it). All three must go together.
  stop(): void {
    this.child?.kill();
    this.child = null;
    this.startPromise = null;
    this.sessionId = null;
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
    // A streaming update from the agent.
    if (msg.method === 'session/update') {
      this.opts.onUpdate((msg.params ?? {}) as AcpUpdate);
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
