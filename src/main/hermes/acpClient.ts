import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import type { GateMode } from '../../shared/types';
import { isAllowOption, isRejectOption } from '../../shared/gate';

export interface PermissionOption {
  optionId?: string;
  name?: string;
  /** ACP option kinds: allow_once, allow_always, reject_once, reject_always. */
  kind?: string;
}

export interface ToolCallRef {
  toolCallId?: string;
  title?: string;
  kind?: string;
}

export interface SessionUpdate {
  sessionUpdate: string;
  content?: { type: string; text: string };
  toolCallId?: string;
  title?: string;
  status?: string;
}

export interface PermissionEvent {
  /** Non-null only when the request is parked awaiting the user (ask mode). */
  requestKey: string | null;
  /** Set when the gate resolved the request without the user. */
  resolved: 'locked' | 'unlocked' | null;
  toolCall: ToolCallRef | null;
  options: PermissionOption[];
}

export interface InitializeResult {
  protocolVersion: number;
  agentCapabilities?: Record<string, unknown>;
}

export interface PromptResult {
  stopReason?: string;
}

export interface AcpClientOptions {
  hermesBin: string;
  profileId: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  gateMode?: GateMode;
  onUpdate?: (update: SessionUpdate, sessionId: string) => void;
  onPermission?: (event: PermissionEvent) => void;
  onExit?: (code: number | null) => void;
}

interface Pending {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
}

export class AcpClient {
  readonly profileId: string;
  readonly spawnArgs: string[];
  onUpdate: (update: SessionUpdate, sessionId: string) => void;
  onPermission: (event: PermissionEvent) => void;
  onExit: (code: number | null) => void;

  protected gateMode: GateMode;
  private readonly hermesBin: string;
  private readonly cwd: string;
  private readonly env: NodeJS.ProcessEnv;
  private child: ChildProcess | null = null;
  private ready: Promise<InitializeResult> | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private buf = '';
  /** Requests parked awaiting the user in ask mode. */
  private pendingPermissions = new Map<string, { rpcId: number; options: PermissionOption[] }>();
  private nextPermKey = 1;

  constructor(opts: AcpClientOptions) {
    this.hermesBin = opts.hermesBin;
    this.profileId = opts.profileId;
    this.cwd = opts.cwd ?? homedir();
    this.env = { ...process.env, ...opts.env, HERMES_ACCEPT_HOOKS: '1' };
    this.gateMode = opts.gateMode ?? 'unlocked';
    this.onUpdate = opts.onUpdate ?? (() => {});
    this.onPermission = opts.onPermission ?? (() => {});
    this.onExit = opts.onExit ?? (() => {});
    // §4.3 — the one and only transport.
    this.spawnArgs = ['-p', this.profileId, 'acp', '--accept-hooks'];
  }

  start(): Promise<InitializeResult> {
    if (this.ready) return this.ready;

    this.child = spawn(this.hermesBin, this.spawnArgs, {
      env: this.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.child.stdout!.on('data', (b: Buffer) => this.ingest(b.toString()));
    this.child.stderr!.on('data', () => {
      // Hermes writes progress noise to stderr; it is not part of the protocol.
    });
    this.child.on('error', (err) => this.failAll(new Error(`Couldn’t start Hermes: ${err.message}`)));
    this.child.on('exit', (code) => {
      this.failAll(new Error(`hermes acp exited (${code})`));
      this.onExit(code);
    });

    this.ready = this.send<InitializeResult>('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
      clientInfo: { name: 'circe', version: '0.1.0' },
    });
    return this.ready;
  }

  async newSession(): Promise<string> {
    await this.ready;
    const r = await this.send<{ sessionId: string }>('session/new', { cwd: this.cwd, mcpServers: [] });
    return r.sessionId;
  }

  async loadSession(sessionId: string): Promise<void> {
    await this.ready;
    await this.send('session/load', { cwd: this.cwd, sessionId, mcpServers: [] });
  }

  async prompt(sessionId: string, text: string): Promise<PromptResult> {
    await this.ready;
    return this.send<PromptResult>('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text }],
    });
  }

  async cancelSession(sessionId: string): Promise<void> {
    try {
      await this.send('session/cancel', { sessionId });
    } catch {
      // Cancelling a dead session is not an error worth surfacing.
    }
  }

  stop(): void {
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
    this.ready = null;
  }

  get pendingPermissionCount(): number {
    return this.pendingPermissions.size;
  }

  /**
   * Takes effect on the next inbound request — no session or turn boundary
   * (§10.4). Leaving `ask` resolves every parked card as cancelled so the agent
   * is not left waiting on a prompt the user has abandoned (§6.4).
   */
  setGateMode(mode: GateMode): void {
    const previous = this.gateMode;
    this.gateMode = mode;
    if (previous === 'ask' && mode !== 'ask') this.cancelPendingPermissions();
  }

  resolvePermission(requestKey: string, optionId: string | null): boolean {
    const entry = this.pendingPermissions.get(requestKey);
    if (!entry) return false;
    this.pendingPermissions.delete(requestKey);
    if (optionId) {
      const match = entry.options.find((o) => (o.optionId ?? o.name) === optionId);
      this.reply(entry.rpcId, {
        outcome: { outcome: 'selected', optionId: match?.optionId ?? match?.name ?? optionId },
      });
    } else {
      this.reply(entry.rpcId, { outcome: { outcome: 'cancelled' } });
    }
    return true;
  }

  cancelPendingPermissions(): void {
    for (const [key, entry] of this.pendingPermissions) {
      this.reply(entry.rpcId, { outcome: { outcome: 'cancelled' } });
      this.pendingPermissions.delete(key);
    }
  }

  /** Test seam so the line framer can be exercised without a subprocess. */
  ingestForTest(chunk: string): void {
    this.ingest(chunk);
  }

  protected send<T>(method: string, params: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  protected reply(id: number, result: unknown): void {
    this.write({ jsonrpc: '2.0', id, result });
  }

  protected replyError(id: number, code: number, message: string): void {
    this.write({ jsonrpc: '2.0', id, error: { code, message } });
  }

  private write(obj: unknown): void {
    if (this.child?.stdin?.writable) {
      this.child.stdin.write(JSON.stringify(obj) + '\n');
    }
  }

  private failAll(err: Error): void {
    for (const [, p] of this.pending) p.reject(err);
    this.pending.clear();
  }

  private ingest(chunk: string): void {
    this.buf += chunk;
    let i: number;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // Not protocol traffic — ignore rather than crash.
      }
      this.dispatch(msg);
    }
  }

  private dispatch(msg: any): void {
    // A response to something we sent.
    if (msg.id !== undefined && msg.method === undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message || 'rpc error'));
      else p.resolve(msg.result);
      return;
    }

    // A notification.
    if (msg.method === 'session/update' && msg.params) {
      this.onUpdate(msg.params.update as SessionUpdate, msg.params.sessionId as string);
      return;
    }

    // A server-initiated request.
    if (msg.method && msg.id !== undefined) {
      this.handleServerRequest(msg.id, msg.method, msg.params);
    }
  }

  protected handleServerRequest(id: number, method: string, params: any): void {
    if (method === 'session/request_permission') {
      this.handlePermissionRequest(id, params);
      return;
    }
    if (method === 'fs/read_text_file') {
      readFile(params.path, 'utf8').then(
        (content) => this.reply(id, { content }),
        (err) => this.replyError(id, -32603, err.message),
      );
      return;
    }
    if (method === 'fs/write_text_file') {
      writeFile(params.path, params.content, 'utf8').then(
        () => this.reply(id, {}),
        (err) => this.replyError(id, -32603, err.message),
      );
      return;
    }
    this.replyError(id, -32601, `method not implemented: ${method}`);
  }

  private handlePermissionRequest(rpcId: number, params: any): void {
    const options: PermissionOption[] = params?.options ?? [];
    const toolCall: ToolCallRef | null = params?.toolCall ?? null;

    if (this.gateMode === 'unlocked') {
      const allow = options.find(isAllowOption) ?? options[0];
      this.reply(rpcId, {
        outcome: { outcome: 'selected', optionId: allow?.optionId ?? allow?.name ?? 'allow' },
      });
      return;
    }

    if (this.gateMode === 'locked') {
      const reject = options.find(isRejectOption);
      if (reject) {
        this.reply(rpcId, {
          outcome: { outcome: 'selected', optionId: reject.optionId ?? reject.name },
        });
      } else {
        this.reply(rpcId, { outcome: { outcome: 'cancelled' } });
      }
      // Still surface it, already resolved, so the transcript can render a card
      // showing what was denied — the user must be able to see the agent tried.
      this.onPermission({ requestKey: null, resolved: 'locked', toolCall, options });
      return;
    }

    // ask — park it and wait for resolvePermission().
    const requestKey = `p${this.nextPermKey++}`;
    this.pendingPermissions.set(requestKey, { rpcId, options });
    try {
      this.onPermission({ requestKey, resolved: null, toolCall, options });
    } catch {
      // If the UI could not take the handoff, do not leave Hermes hanging.
      this.pendingPermissions.delete(requestKey);
      this.reply(rpcId, { outcome: { outcome: 'cancelled' } });
    }
  }
}
