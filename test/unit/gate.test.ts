import { describe, it, expect, afterEach, vi } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AcpClient, type PermissionEvent } from '../../src/main/hermes/acpClient';
import { nextGateMode, isAllowOption, isRejectOption } from '../../src/shared/gate';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOCK_BIN = resolve(HERE, '../fixtures/mock-hermes/hermes');

let client: AcpClient | null = null;
afterEach(() => {
  client?.stop();
  client = null;
});

function permissionClient(gateMode: 'locked' | 'ask' | 'unlocked', events: PermissionEvent[]) {
  return new AcpClient({
    hermesBin: MOCK_BIN,
    profileId: 'test',
    gateMode,
    env: { MOCK_HERMES_SCENARIO: 'permission' },
    onPermission: (e) => events.push(e),
  });
}

describe('nextGateMode', () => {
  it('cycles locked → ask → unlocked → locked (§6.4)', () => {
    expect(nextGateMode('locked')).toBe('ask');
    expect(nextGateMode('ask')).toBe('unlocked');
    expect(nextGateMode('unlocked')).toBe('locked');
  });
});

describe('option classification', () => {
  it('prefers the ACP kind field', () => {
    expect(isAllowOption({ kind: 'allow_once' })).toBe(true);
    expect(isAllowOption({ kind: 'allow_always' })).toBe(true);
    expect(isRejectOption({ kind: 'reject_once' })).toBe(true);
    expect(isRejectOption({ kind: 'reject_always' })).toBe(true);
  });

  it('falls back to name matching for less strict servers', () => {
    expect(isAllowOption({ name: 'Approve' })).toBe(true);
    expect(isRejectOption({ name: 'Deny' })).toBe(true);
  });

  it('does not classify an unrelated option', () => {
    expect(isAllowOption({ name: 'Explain' })).toBe(false);
    expect(isRejectOption({ name: 'Explain' })).toBe(false);
  });
});

describe('gate behaviour', () => {
  it('auto-approves in unlocked mode and completes the tool call', async () => {
    const events: PermissionEvent[] = [];
    client = permissionClient('unlocked', events);
    const statuses: string[] = [];
    client.onUpdate = (u) => {
      if (u.sessionUpdate === 'tool_call_update' && u.status) statuses.push(u.status);
    };
    await client.start();
    const sid = await client.newSession();
    await client.prompt(sid, 'write a file');
    expect(statuses).toContain('completed');
  });

  it('auto-denies in locked mode and still surfaces a visible denied event (§6.4)', async () => {
    const events: PermissionEvent[] = [];
    client = permissionClient('locked', events);
    const statuses: string[] = [];
    client.onUpdate = (u) => {
      if (u.sessionUpdate === 'tool_call_update' && u.status) statuses.push(u.status);
    };
    await client.start();
    const sid = await client.newSession();
    await client.prompt(sid, 'write a file');
    expect(statuses).toContain('failed');
    expect(events).toHaveLength(1);
    expect(events[0]!.resolved).toBe('locked');
    expect(events[0]!.requestKey).toBeNull();
    expect(events[0]!.toolCall?.title).toBe('write_file');
  });

  it('parks the request in ask mode until the user resolves it', async () => {
    const events: PermissionEvent[] = [];
    client = permissionClient('ask', events);
    await client.start();
    const sid = await client.newSession();
    const promptDone = client.prompt(sid, 'write a file');

    // Wait for the request to be parked rather than racing it.
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]!.requestKey).toBeTruthy();
    expect(events[0]!.resolved).toBeNull();
    expect(client.pendingPermissionCount).toBe(1);

    client.resolvePermission(events[0]!.requestKey!, 'allow-once');
    await promptDone;
    expect(client.pendingPermissionCount).toBe(0);
  });

  it('treats a null optionId as a cancellation', async () => {
    const events: PermissionEvent[] = [];
    client = permissionClient('ask', events);
    await client.start();
    const sid = await client.newSession();
    const promptDone = client.prompt(sid, 'write a file');
    await vi.waitFor(() => expect(events).toHaveLength(1));
    client.resolvePermission(events[0]!.requestKey!, null);
    await promptDone;
    expect(client.pendingPermissionCount).toBe(0);
  });

  it('LIVENESS (§10.4): switching to Locked mid-response denies the very next tool call', async () => {
    const events: PermissionEvent[] = [];
    client = permissionClient('unlocked', events);
    const statuses: string[] = [];
    client.onUpdate = (u) => {
      // The tool_call announcement arrives before the permission request, so
      // flipping the gate here proves no session or turn boundary is needed.
      if (u.sessionUpdate === 'tool_call') client!.setGateMode('locked');
      if (u.sessionUpdate === 'tool_call_update' && u.status) statuses.push(u.status);
    };
    await client.start();
    const sid = await client.newSession();
    await client.prompt(sid, 'write a file');

    expect(statuses).toContain('failed');
    expect(events.some((e) => e.resolved === 'locked')).toBe(true);
  });

  it('cancels pending cards when the mode leaves ask, so Hermes never hangs (§6.4)', async () => {
    const events: PermissionEvent[] = [];
    client = permissionClient('ask', events);
    await client.start();
    const sid = await client.newSession();
    const promptDone = client.prompt(sid, 'write a file');
    await vi.waitFor(() => expect(client!.pendingPermissionCount).toBe(1));

    client.setGateMode('unlocked');
    await promptDone;
    expect(client.pendingPermissionCount).toBe(0);
  });

  it('resolvePermission returns false for an unknown key', async () => {
    client = permissionClient('ask', []);
    await client.start();
    expect(client.resolvePermission('nope', 'allow-once')).toBe(false);
  });
});
