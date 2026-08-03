import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOCK = resolve(HERE, '../fixtures/mock-hermes/hermes');

function run(args: string[], env: Record<string, string> = {}) {
  return new Promise<{ code: number | null; stdout: string }>((res) => {
    const child = spawn(MOCK, args, { env: { ...process.env, ...env } });
    let stdout = '';
    child.stdout.on('data', (b) => (stdout += b.toString()));
    child.on('exit', (code) => res({ code, stdout }));
  });
}

/** Drive an ACP conversation and collect every JSON-RPC line the mock emits. */
function acp(scenario: string, send: string[]) {
  return new Promise<any[]>((res) => {
    const child = spawn(MOCK, ['-p', 'test', 'acp'], {
      env: { ...process.env, MOCK_HERMES_SCENARIO: scenario },
    });
    const out: any[] = [];
    let buf = '';
    child.stdout.on('data', (b) => {
      buf += b.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) out.push(JSON.parse(line));
      }
    });
    for (const line of send) child.stdin.write(line + '\n');
    child.stdin.end();
    child.on('exit', () => res(out));
  });
}

describe('mock hermes', () => {
  it('reports a version', async () => {
    const { code, stdout } = await run(['--version']);
    expect(code).toBe(0);
    expect(stdout).toMatch(/Hermes Agent v\d+\.\d+\.\d+/);
  });

  it('answers initialize with a protocol version', async () => {
    const out = await acp('stream', [
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1 } }),
    ]);
    expect(out[0]).toMatchObject({ id: 1, result: { protocolVersion: 1 } });
  });

  it('streams agent_message_chunk updates in response to a prompt', async () => {
    const out = await acp('stream', [
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1 } }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: '/tmp' } }),
      JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'session/prompt', params: { sessionId: 's1', prompt: [{ type: 'text', text: 'hi' }] } }),
    ]);
    const chunks = out.filter(
      (m) => m.method === 'session/update' && m.params.update.sessionUpdate === 'agent_message_chunk',
    );
    expect(chunks.length).toBeGreaterThan(0);
    const text = chunks.map((c) => c.params.update.content.text).join('');
    expect(text).toContain('Hello');
  });

  it('issues a session/request_permission in the permission scenario', async () => {
    const out = await acp('permission', [
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1 } }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: '/tmp' } }),
      JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'session/prompt', params: { sessionId: 's1', prompt: [{ type: 'text', text: 'write a file' }] } }),
    ]);
    const req = out.find((m) => m.method === 'session/request_permission');
    expect(req).toBeDefined();
    expect(req.params.options.some((o: any) => o.kind === 'allow_once')).toBe(true);
    expect(req.params.options.some((o: any) => o.kind === 'reject_once')).toBe(true);
  });
});
