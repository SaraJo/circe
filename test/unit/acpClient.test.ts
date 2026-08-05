import { describe, it, expect, afterEach } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AcpClient } from '../../src/main/hermes/acpClient';
import type { SessionUpdate } from '../../src/main/hermes/acpClient';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOCK_BIN = resolve(HERE, '../fixtures/mock-hermes/hermes');

let client: AcpClient | null = null;
afterEach(() => {
  client?.stop();
  client = null;
});

function makeClient(scenario = 'stream', onUpdate?: (u: SessionUpdate) => void) {
  return new AcpClient({
    hermesBin: MOCK_BIN,
    profileId: 'test',
    env: { MOCK_HERMES_SCENARIO: scenario },
    onUpdate,
  });
}

describe('AcpClient', () => {
  it('spawns with `-p <profile> acp` — the §4.3 transport', async () => {
    client = makeClient();
    const result = await client.start();
    expect(result.protocolVersion).toBe(1);
    expect(client.spawnArgs).toEqual(['-p', 'test', 'acp', '--accept-hooks']);
  });

  it('opens a session and returns its id', async () => {
    client = makeClient();
    await client.start();
    expect(await client.newSession()).toBe('s1');
  });

  it('streams agent_message_chunk updates for a prompt', async () => {
    const chunks: string[] = [];
    client = makeClient('stream', (u) => {
      if (u.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text') {
        chunks.push(u.content.text);
      }
    });
    await client.start();
    const sid = await client.newSession();
    const res = await client.prompt(sid, 'hi');
    expect(res.stopReason).toBe('end_turn');
    expect(chunks.join('')).toContain('Hello');
  });

  it('handles a JSON-RPC response split across stdout chunks', async () => {
    // The mock writes whole lines, so exercise the framer directly instead.
    client = makeClient();
    await client.start();
    const seen: SessionUpdate[] = [];
    client.onUpdate = (u) => seen.push(u);
    client.ingestForTest('{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s1","upd');
    client.ingestForTest('ate":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"ok"}}}}\n');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.content?.text).toBe('ok');
  });

  it('ignores non-JSON lines on stdout rather than crashing', async () => {
    client = makeClient();
    await client.start();
    expect(() => client!.ingestForTest('not json at all\n')).not.toThrow();
  });

  it('rejects every in-flight request when the subprocess exits', async () => {
    const exits: (number | null)[] = [];
    client = new AcpClient({
      hermesBin: MOCK_BIN,
      profileId: 'test',
      env: { MOCK_HERMES_SCENARIO: 'crash' },
      onExit: (code) => exits.push(code),
    });
    await expect(client.start()).rejects.toThrow(/exited/);
    expect(exits).toHaveLength(1);
  });

  it('reports a readable error when the binary does not exist', async () => {
    client = new AcpClient({ hermesBin: '/nonexistent/hermes', profileId: 'test' });
    await expect(client.start()).rejects.toThrow();
  });

  it('is idempotent on stop()', async () => {
    client = makeClient();
    await client.start();
    client.stop();
    expect(() => client!.stop()).not.toThrow();
  });
});
