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

export class AcpClient {
  private child: ChildProcess | null = null;
  private buffer = '';
  private nextId = 1;
  private pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
  private sessionId: string | null = null;

  constructor(private opts: AcpOptions) {}

  /** Spawns `hermes -p <profile> acp` and completes the ACP handshake. */
  async start(): Promise<void> {
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

    await this.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    });
    const session = (await this.request('session/new', {
      cwd: this.opts.cwd ?? homedir(),
      mcpServers: [],
    })) as { sessionId: string };
    this.sessionId = session.sessionId;
  }

  async prompt(text: string): Promise<void> {
    if (!this.sessionId) throw new Error('ACP session not started');
    await this.request('session/prompt', {
      sessionId: this.sessionId,
      prompt: [{ type: 'text', text }],
    });
  }

  stop(): void {
    this.child?.kill();
    this.child = null;
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
          ? { outcome: { outcome: 'selected', optionId: allow.optionId } }
          : { outcome: { outcome: 'cancelled' } },
      });
    }
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  private send(msg: unknown): void {
    this.child?.stdin?.write(`${JSON.stringify(msg)}\n`);
  }
}
