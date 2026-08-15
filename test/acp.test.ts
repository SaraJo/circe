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
});
