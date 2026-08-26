import { afterEach, describe, expect, it, vi } from 'vitest';
import { AcpClient, optionIdFor, parseFrames } from '../src/main/acp';

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

// `prompt`/`newSession`/`loadSession` now refuse to issue a request when there
// is no live child, because `send()` optional-chains and a destroyed `stdin`
// swallows the write — the request would never settle and `session/prompt` has
// no timeout to rescue it. Tests that are about what those methods *do* with a
// running client stand this stub in for the process. `send()` only ever touches
// `child.stdin`, itself optional-chained, so an empty object is enough.
type WithChild = { child: unknown };
function running(client: AcpClient): AcpClient {
  (client as unknown as WithChild).child = {};
  return client;
}

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

describe('session/request_permission', () => {
  const options = [
    { optionId: 'allow_always', kind: 'allow_always', name: 'Always allow' },
    { optionId: 'allow_once', kind: 'allow_once', name: 'Allow once' },
    { optionId: 'allow_session', kind: 'allow_always', name: 'Allow for session' },
    { optionId: 'deny', kind: 'reject_once', name: 'Deny' },
  ];

  it('never maps a Circe answer to a permanent option', () => {
    expect(optionIdFor('allow_once', options)).toBe('allow_once');
    expect(optionIdFor('allow_session', options)).toBe('allow_session');
    expect(optionIdFor('deny', options)).toBe('deny');
  });

  it('asks the caller and sends the selected non-persistent option', async () => {
    const onPermission = vi.fn(async () => 'allow_session' as const);
    const client = new AcpClient({
      profileId: 'test',
      onUpdate: () => {},
      onExit: () => {},
      onPermission,
    });
    const send = vi
      .spyOn(client as unknown as { send(frame: unknown): void }, 'send')
      .mockImplementation(() => {});

    (client as unknown as WithHandle).handle({
      method: 'session/request_permission',
      id: 7,
      params: {
        toolCall: { rawInput: { command: 'rm -rf build', description: 'Delete build output' } },
        options,
      },
    });
    await Promise.resolve();

    expect(onPermission).toHaveBeenCalledWith({
      id: 7,
      command: 'rm -rf build',
      description: 'Delete build output',
    });
    expect(send).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      id: 7,
      result: { outcome: { outcome: 'selected', optionId: 'allow_session' } },
    });
  });

  it('fails closed when no permission UI is connected', () => {
    const client = new AcpClient({ profileId: 'test', onUpdate: () => {}, onExit: () => {} });
    const send = vi
      .spyOn(client as unknown as { send(frame: unknown): void }, 'send')
      .mockImplementation(() => {});

    (client as unknown as WithHandle).handle({
      method: 'session/request_permission',
      id: 8,
      params: { toolCall: { title: 'Run command' }, options },
    });

    expect(send).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      id: 8,
      result: { outcome: { outcome: 'cancelled' } },
    });
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
    const c = running(client());
    vi.spyOn(c as unknown as WithRequest, 'request').mockImplementation(async (method) => {
      if (method === 'initialize') return { agentCapabilities: { loadSession: true } };
      throw new Error('no such session');
    });
    await (c as unknown as WithHandshake).handshake();

    await expect(c.loadSession('gone')).resolves.toBe(false);
  });

  /**
   * `session/load` cannot tell a live session from a dead one: probed against
   * Hermes 0.14.0, a fabricated session id answers `{}` with no error. Listing
   * is what makes the saved id checkable, so how the capability is *read*
   * matters — the runtime advertises it as `sessionCapabilities: { fork: {},
   * list: {}, resume: {} }` (spec §2), nested and valued with an empty object,
   * not as a boolean sibling of `loadSession`.
   */
  describe('session listing', () => {
    it('reads the capability out of the nested sessionCapabilities block', async () => {
      const c = client();
      vi.spyOn(c as unknown as WithRequest, 'request').mockResolvedValue({
        agentCapabilities: {
          loadSession: true,
          sessionCapabilities: { fork: {}, list: {}, resume: {} },
        },
      });

      await (c as unknown as WithHandshake).handshake();

      // `list === true` would read the captured `{}` as unsupported and
      // silently disable the check the saved id depends on.
      expect(c.canListSessions).toBe(true);
    });

    it('does not mistake a sibling of loadSession for the nested capability', async () => {
      const c = client();
      vi.spyOn(c as unknown as WithRequest, 'request').mockResolvedValue({
        agentCapabilities: { loadSession: true, list: {} },
      });

      await (c as unknown as WithHandshake).handshake();

      expect(c.canListSessions).toBe(false);
    });

    it('honours an explicit refusal', async () => {
      const c = client();
      vi.spyOn(c as unknown as WithRequest, 'request').mockResolvedValue({
        agentCapabilities: { sessionCapabilities: { list: false } },
      });

      await (c as unknown as WithHandshake).handshake();

      expect(c.canListSessions).toBe(false);
    });

    async function listing(c: AcpClient): Promise<AcpClient> {
      const spy = vi.spyOn(c as unknown as WithRequest, 'request');
      spy.mockResolvedValue({ agentCapabilities: { sessionCapabilities: { list: {} } } });
      await (c as unknown as WithHandshake).handshake();
      spy.mockReset();
      return c;
    }

    it('returns the ids out of the captured response shape', async () => {
      const c = running(client());
      await listing(c);
      const request = vi.spyOn(c as unknown as WithRequest, 'request').mockResolvedValue({
        sessions: [
          {
            sessionId: '9a72aa86-0000-0000-0000-000000000000',
            title: 'Spock First Officer Role Introduction',
            cwd: '/Users/sarachipps',
            updatedAt: '2026-08-16T21:54:37+00:00',
          },
        ],
      });

      await expect(c.listSessions()).resolves.toEqual(['9a72aa86-0000-0000-0000-000000000000']);
      expect(request).toHaveBeenCalledWith(
        'session/list',
        { cwd: expect.any(String) },
        expect.any(Number),
      );
    });

    // `[]` is a real answer — an agent with no stored sessions at all — and the
    // caller acts on it by refusing to resume. Everything that means "could not
    // tell" has to be distinguishable from it, or one failed request would
    // throw away a live conversation.
    it('reports an agent with no sessions as an empty list, not as unknown', async () => {
      const c = running(client());
      await listing(c);
      vi.spyOn(c as unknown as WithRequest, 'request').mockResolvedValue({ sessions: [] });

      await expect(c.listSessions()).resolves.toEqual([]);
    });

    it('answers null, not an empty list, when the request fails', async () => {
      const c = running(client());
      await listing(c);
      vi.spyOn(c as unknown as WithRequest, 'request').mockRejectedValue(new Error('boom'));

      await expect(c.listSessions()).resolves.toBeNull();
    });

    it('answers null, not an empty list, when the response is not the documented shape', async () => {
      const c = running(client());
      await listing(c);
      vi.spyOn(c as unknown as WithRequest, 'request').mockResolvedValue({ nothing: 'useful' });

      await expect(c.listSessions()).resolves.toBeNull();
    });

    it('answers null without asking when the agent never advertised listing', async () => {
      const c = running(client());
      const request = vi.spyOn(c as unknown as WithRequest, 'request');

      await expect(c.listSessions()).resolves.toBeNull();
      expect(request).not.toHaveBeenCalled();
    });

    // Same reasoning as loadSession's: the caller's fallback is session/new on
    // this same dead client, which cannot work either.
    it('refuses to list against a client that is not running', async () => {
      const c = client();
      await listing(c);

      await expect(c.listSessions()).rejects.toThrow('ACP client is not running');
    });

    it('forgets the capability on stop, so a later call refuses instead of writing nowhere', async () => {
      const c = client();
      await listing(c);
      expect(c.canListSessions).toBe(true);

      c.stop();

      expect(c.canListSessions).toBe(false);
    });
  });

  it('returns the id from session/new', async () => {
    const c = running(client());
    vi.spyOn(c as unknown as WithRequest, 'request').mockResolvedValue({ sessionId: 'sess-9' });

    await expect(c.newSession()).resolves.toBe('sess-9');
  });

  it('prompts the session it was given, not an implicit one', async () => {
    const c = running(client());
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

/**
 * Every one of these used to *hang* rather than fail. `send()` is
 * `this.child?.stdin?.write(...)`: with no child the optional chain no-ops, and
 * with a dead child the write lands on a destroyed stream and returns false
 * without throwing. Either way the frame goes nowhere and the pending promise
 * is never settled by anything — and `session/prompt` carries no timeout by
 * design, so the tile sits thinking forever with no `circe/turn-end`.
 */
describe('requests against a client that is not running', () => {
  function client(): AcpClient {
    return new AcpClient({ profileId: 'test', onUpdate: () => {}, onExit: () => {} });
  }

  it('rejects prompt rather than leaving the turn open forever', async () => {
    const c = client();
    const request = vi.spyOn(c as unknown as WithRequest, 'request');

    await expect(c.prompt('sess-1', 'hello')).rejects.toThrow('ACP client is not running');
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects newSession rather than burning the full handshake timeout', async () => {
    const c = client();
    const request = vi.spyOn(c as unknown as WithRequest, 'request');

    await expect(c.newSession()).rejects.toThrow('ACP client is not running');
    expect(request).not.toHaveBeenCalled();
  });

  // Not `false`: false means "that conversation is gone, open a fresh one", and
  // the caller acts on it by calling newSession() — which on this same dead
  // client cannot work either. Throwing is what stops a mid-replay death from
  // costing the user 30 more seconds before anyone tells them anything.
  it('rejects loadSession rather than reporting a recoverable false', async () => {
    const c = client();
    vi.spyOn(c as unknown as WithRequest, 'request').mockResolvedValue({
      agentCapabilities: { loadSession: true },
    });
    await (c as unknown as WithHandshake).handshake();

    await expect(c.loadSession('sess-1')).rejects.toThrow('ACP client is not running');
  });

  // The one case a `!this.child` guard would miss on its own: nothing calls
  // `stop()` when the agent dies by itself (`onExit` only draws a notice), so
  // the `ChildProcess` object outlives the process it describes and every later
  // request would be waved through into a destroyed `stdin`. This spawns a real
  // command that exits immediately rather than faking the `exit` event, so it
  // is the actual wiring in `doStart` under test.
  it('drops a child that exited on its own, so later requests refuse instead of hanging', async () => {
    const prior = process.env.CIRCE_HERMES_BIN;
    process.env.CIRCE_HERMES_BIN = '/bin/echo';
    try {
      const c = client();
      await expect(c.start()).rejects.toThrow(/exited/);
      await expect(c.newSession()).rejects.toThrow('ACP client is not running');
    } finally {
      if (prior === undefined) delete process.env.CIRCE_HERMES_BIN;
      else process.env.CIRCE_HERMES_BIN = prior;
    }
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
