import { describe, expect, it, vi } from 'vitest';
import { AcpClient, parseFrames } from '../src/main/acp';

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
