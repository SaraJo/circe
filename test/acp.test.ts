import { afterEach, describe, expect, it, vi } from 'vitest';
import { AcpClient, parseFrames } from '../src/main/acp';

// Reaches into the private `request` method the same way the idempotence test
// below reaches into `doStart`: no subprocess, no faked ACP traffic. `request`'s
// only touch on the child is `this.child?.stdin?.write(...)`, optional-chained,
// so calling it on a never-started client exercises the real timeout/timer logic
// with nothing to fake.
type WithRequest = {
  request(method: string, params: unknown, timeoutMs?: number): Promise<unknown>;
};

// Same pattern, reaching at the private `buffer` field directly rather than
// through a subprocess's stdout stream.
type WithBuffer = { buffer: string };

// And again for the frame dispatcher, so a real `session/update` notification
// can be fed in exactly as it arrives off the wire — no subprocess needed,
// since `handle` is pure dispatch over a parsed frame.
type WithHandle = { handle(msg: Record<string, unknown>): void };

// Same private-reach idiom as the rest of this file: no subprocess, no faked
// protocol traffic. `handshake` is the half of startup that does not spawn.
type WithHandshake = { handshake(): Promise<void> };

afterEach(() => {
  vi.useRealTimers();
});

describe('parseFrames', () => {
  it('reads one complete line as one frame', () => {
    const { frames, rest } = parseFrames('{"jsonrpc":"2.0","id":1}\n');
    expect(frames).toEqual([{ jsonrpc: '2.0', id: 1 }]);
    expect(rest).toBe('');
  });

  it('holds a partial line back for the next chunk', () => {
    const { frames, rest } = parseFrames('{"a":1}\n{"b":');
    expect(frames).toEqual([{ a: 1 }]);
    expect(rest).toBe('{"b":');
  });

  it('skips a line that is not JSON rather than throwing', () => {
    const { frames } = parseFrames('starting up…\n{"a":1}\n');
    expect(frames).toEqual([{ a: 1 }]);
  });

  it('ignores blank lines', () => {
    const { frames } = parseFrames('\n\n{"a":1}\n\n');
    expect(frames).toEqual([{ a: 1 }]);
  });
});

describe('session/update forwarding', () => {
  // The shape is from the working prototype, which runs against the real
  // runtime: acpClient.js:339 forwards `msg.params`, and renderer.js:372/377
  // then reads `params.update` and `update.sessionUpdate`. Forwarding
  // `params` here instead of `params.update` meant `sessionUpdate` was always
  // undefined in the tile and no reply could ever be displayed.
  function collect(): { client: AcpClient; seen: Array<Record<string, unknown>> } {
    const seen: Array<Record<string, unknown>> = [];
    const client = new AcpClient({
      profileId: 'test',
      onUpdate: (_id, u) => seen.push(u as Record<string, unknown>),
      onExit: () => {},
    });
    return { client, seen };
  }

  it('hands the renderer the inner update object, not the params wrapper', () => {
    const { client, seen } = collect();
    (client as unknown as WithHandle).handle({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'sess-1',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } },
      },
    });

    expect(seen).toEqual([
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } },
    ]);
    expect(seen[0]!.sessionUpdate).toBe('agent_message_chunk');
  });

  it('forwards a tool_call update the same way', () => {
    const { client, seen } = collect();
    (client as unknown as WithHandle).handle({
      method: 'session/update',
      params: { sessionId: 's', update: { sessionUpdate: 'tool_call', title: 'read_file' } },
    });

    expect(seen).toEqual([{ sessionUpdate: 'tool_call', title: 'read_file' }]);
  });

  it('drops a notification with no update object rather than forwarding a wrapper', () => {
    const { client, seen } = collect();
    (client as unknown as WithHandle).handle({ method: 'session/update', params: { sessionId: 's' } });
    (client as unknown as WithHandle).handle({ method: 'session/update' });

    expect(seen).toEqual([]);
  });
});

describe('AcpClient session lifecycle', () => {
  function client(): AcpClient {
    return new AcpClient({ profileId: 'test', onUpdate: () => {}, onExit: () => {} });
  }

  it('records that the agent supports loadSession', async () => {
    const c = client();
    vi.spyOn(c as unknown as WithRequest, 'request').mockResolvedValue({
      agentCapabilities: { loadSession: true },
    });

    await (c as unknown as WithHandshake).handshake();

    expect(c.canLoadSession).toBe(true);
  });

  it('treats a missing capability block as no loadSession support', async () => {
    const c = client();
    vi.spyOn(c as unknown as WithRequest, 'request').mockResolvedValue({});

    await (c as unknown as WithHandshake).handshake();

    expect(c.canLoadSession).toBe(false);
  });

  it('refuses to load a session when the agent never advertised support', async () => {
    const c = client();
    const request = vi.spyOn(c as unknown as WithRequest, 'request');

    await expect(c.loadSession('sess-1')).resolves.toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it('reports a failed load as false rather than throwing, so launch can fall back', async () => {
    const c = client();
    vi.spyOn(c as unknown as WithRequest, 'request').mockImplementation(async (method) => {
      if (method === 'initialize') return { agentCapabilities: { loadSession: true } };
      throw new Error('no such session');
    });
    await (c as unknown as WithHandshake).handshake();

    await expect(c.loadSession('gone')).resolves.toBe(false);
  });

  it('returns the id from session/new', async () => {
    const c = client();
    vi.spyOn(c as unknown as WithRequest, 'request').mockResolvedValue({ sessionId: 'sess-9' });

    await expect(c.newSession()).resolves.toBe('sess-9');
  });

  it('prompts the session it was given, not an implicit one', async () => {
    const c = client();
    const request = vi
      .spyOn(c as unknown as WithRequest, 'request')
      .mockResolvedValue({ stopReason: 'end_turn' });

    await c.prompt('sess-3', 'hello');

    expect(request).toHaveBeenCalledWith('session/prompt', {
      sessionId: 'sess-3',
      prompt: [{ type: 'text', text: 'hello' }],
    });
  });
});

describe('session/update routing', () => {
  it('forwards the outer sessionId alongside the inner update', () => {
    const seen: Array<{ id: string; u: Record<string, unknown> }> = [];
    const c = new AcpClient({
      profileId: 'test',
      onUpdate: (id, u) => seen.push({ id, u: u as Record<string, unknown> }),
      onExit: () => {},
    });

    (c as unknown as WithHandle).handle({
      method: 'session/update',
      params: {
        sessionId: 'sess-B',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } },
      },
    });

    expect(seen).toEqual([
      {
        id: 'sess-B',
        u: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } },
      },
    ]);
  });

  it('drops a notification carrying no sessionId, since it cannot be routed', () => {
    const seen: string[] = [];
    const c = new AcpClient({
      profileId: 'test',
      onUpdate: (id) => seen.push(id),
      onExit: () => {},
    });

    (c as unknown as WithHandle).handle({
      method: 'session/update',
      params: { update: { sessionUpdate: 'agent_message_chunk' } },
    });

    expect(seen).toEqual([]);
  });
});

describe('AcpClient.start', () => {
  // This does not spawn a subprocess or fake the ACP protocol: it stubs the
  // private startup routine so the guard's control flow — "a second call while
  // starting returns the same promise, without starting again" — can be checked
  // in isolation. See task-10-report.md for why nothing else about AcpClient is
  // unit-tested here.
  it('is idempotent: a second call before the first resolves does not start again', () => {
    const client = new AcpClient({ profileId: 'test', onUpdate: () => {}, onExit: () => {} });
    const doStart = vi
      .spyOn(client as unknown as { doStart(): Promise<void> }, 'doStart')
      .mockResolvedValue(undefined);

    const first = client.start();
    const second = client.start();

    expect(second).toBe(first);
    expect(doStart).toHaveBeenCalledTimes(1);
  });
});

describe('AcpClient handshake timeout', () => {
  it('rejects with a message naming the stalled method once the timeout elapses', async () => {
    vi.useFakeTimers();
    const client = new AcpClient({ profileId: 'test', onUpdate: () => {}, onExit: () => {} });
    const request = (client as unknown as WithRequest).request.bind(client);

    const pending = request('initialize', {}, 30_000);
    const assertion = expect(pending).rejects.toThrow(
      'hermes acp handshake timed out waiting for initialize',
    );
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });

  it('arms no timer when timeoutMs is omitted: the request stays pending past 30s', async () => {
    vi.useFakeTimers();
    const client = new AcpClient({ profileId: 'test', onUpdate: () => {}, onExit: () => {} });
    const request = (client as unknown as WithRequest).request.bind(client);

    let settled = false;
    request('session/prompt', {}).then(
      () => (settled = true),
      () => (settled = true),
    );

    await vi.advanceTimersByTimeAsync(60_000);

    expect(settled).toBe(false);
  });
});

describe('AcpClient.stop', () => {
  it('rejects a pending request with an error distinct from the handshake timeout', async () => {
    const client = new AcpClient({ profileId: 'test', onUpdate: () => {}, onExit: () => {} });
    const request = (client as unknown as WithRequest).request.bind(client);

    const pending = request('session/prompt', {});
    client.stop();

    await expect(pending).rejects.toThrow('ACP client stopped');
  });

  it('resets buffer so a partial line from a previous session cannot contaminate the next', () => {
    const client = new AcpClient({ profileId: 'test', onUpdate: () => {}, onExit: () => {} });
    const withBuffer = client as unknown as WithBuffer;
    withBuffer.buffer = '{"partial trailing line from the old child":';

    client.stop();

    expect(withBuffer.buffer).toBe('');
  });

  // Task 11's tile close-handler calls stop() unconditionally on every close
  // path (the in-app button and the native close/Cmd+W/quit path both reach
  // it), so a second call landing on an already-stopped client has to be
  // harmless — not throw, and not re-reject a request that already settled.
  it('is idempotent: a second call is a harmless no-op', async () => {
    const client = new AcpClient({ profileId: 'test', onUpdate: () => {}, onExit: () => {} });
    const request = (client as unknown as WithRequest).request.bind(client);
    const pending = request('session/prompt', {});

    client.stop();
    await expect(pending).rejects.toThrow('ACP client stopped');

    expect(() => client.stop()).not.toThrow();
  });
});
