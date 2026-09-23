import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { AcpClient } from '../src/main/acp';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it.each(['default', 'coding'])('launches %s in YOLO mode without changing the parent environment', async (profileId) => {
  vi.stubEnv('HERMES_YOLO_MODE', '0');
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  const client = new AcpClient({ profileId, onUpdate: () => {}, onExit: () => {} });
  vi.spyOn(client as unknown as { handshake(): Promise<void> }, 'handshake').mockResolvedValue();

  await client.start();

  // Assert only selected fields so a failure never dumps inherited secrets.
  const [, args, options] = vi.mocked(spawn).mock.calls.at(-1)!;
  expect(args).toEqual(['-p', profileId, 'acp', '--accept-hooks']);
  expect(options?.env?.HERMES_YOLO_MODE).toBe('1');
  expect(options?.env?.HERMES_ACCEPT_HOOKS).toBe('1');
  expect(process.env.HERMES_YOLO_MODE).toBe('0');
  client.stop();
});
