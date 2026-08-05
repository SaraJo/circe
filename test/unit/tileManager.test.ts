import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TileManager } from '../../src/main/tiles/manager';
import { StateStore } from '../../src/main/state/store';
import { emptyState, DEFAULT_PALETTE } from '../../src/shared/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOCK_BIN = resolve(HERE, '../fixtures/mock-hermes/hermes');

let home: string;
let store: StateStore;

/** A fake window that records what the renderer would have been sent. */
function fakeWindowFactory() {
  const windows: any[] = [];
  const factory = (profileId: string) => {
    const win = {
      profileId,
      sent: [] as { channel: string; payload: unknown }[],
      bounds: { x: 0, y: 0, width: 500, height: 600 },
      destroyed: false,
      send: (channel: string, payload: unknown) => win.sent.push({ channel, payload }),
      getBounds: () => win.bounds,
      close: () => { win.destroyed = true; },
      isDestroyed: () => win.destroyed,
    };
    windows.push(win);
    return win;
  };
  return { factory, windows };
}

function makeManager(scenario = 'stream') {
  const { factory, windows } = fakeWindowFactory();
  const manager = new TileManager({
    store,
    hermesBin: MOCK_BIN,
    hermesHome: home,
    env: { MOCK_HERMES_SCENARIO: scenario, MOCK_HERMES_HOME: home },
    createWindow: factory as any,
  });
  return { manager, windows };
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'circe-tiles-'));
  writeFileSync(join(home, 'SOUL.md'), 'scaffold prose');
  mkdirSync(join(home, 'profiles', 'athena'), { recursive: true });
  writeFileSync(join(home, 'profiles', 'athena', 'SOUL.md'), '# Athena — the strategist\n');
  store = new StateStore(join(home, 'state.json'));
  const s = emptyState();
  s.tiles = {
    athena: {
      profileId: 'athena',
      bounds: { x: 0, y: 0, width: 500, height: 600 },
      gateMode: 'unlocked',
      palette: DEFAULT_PALETTE,
      tabs: [{ id: 't1', title: 'New tab', sessionId: null, messages: [] }],
      activeTabId: 't1',
      tiled: true,
      isCodingProfile: false,
    },
  };
  await store.save(s);
});

afterEach(async () => {
  // closeTile persists bounds without awaiting; let that land before the
  // directory disappears, or the in-flight mkdir races rmSync.
  await store.whenIdle();
  rmSync(home, { recursive: true, force: true });
});

describe('TileManager', () => {
  it('spawns a tile and reports it open', async () => {
    const { manager, windows } = makeManager();
    await manager.spawnTile('athena');
    expect(manager.openTileIds).toEqual(['athena']);
    expect(windows).toHaveLength(1);
    await manager.shutdown();
  });

  it('sends the resolved display name, tagline, and palette to the renderer', async () => {
    const { manager, windows } = makeManager();
    await manager.spawnTile('athena');
    const init = windows[0].sent.find((m: any) => m.channel === 'tile:init');
    expect(init.payload.displayName).toBe('Athena');
    expect(init.payload.tagline).toBe('the strategist');
    expect(init.payload.palette).toEqual(DEFAULT_PALETTE);
    expect(init.payload.gateMode).toBe('unlocked');
    await manager.shutdown();
  });

  it('streams agent chunks through to the renderer', async () => {
    const { manager, windows } = makeManager();
    await manager.spawnTile('athena');
    await manager.sendPrompt('athena', 'hi');
    const chunks = windows[0].sent.filter((m: any) => m.channel === 'tile:chunk');
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.map((c: any) => c.payload.text).join('')).toContain('Hello');
    await manager.shutdown();
  });

  it('persists the user message and the agent reply to the transcript', async () => {
    const { manager } = makeManager();
    await manager.spawnTile('athena');
    await manager.sendPrompt('athena', 'hi there');
    const tab = store.get().tiles['athena']!.tabs[0]!;
    expect(tab.messages[0]).toEqual({ role: 'user', text: 'hi there' });
    expect(tab.messages[1]!.role).toBe('agent');
    expect(tab.messages[1]!.text).toContain('Hello');
    await manager.shutdown();
  });

  it('cycles the gate and persists it (§6.4)', async () => {
    const { manager } = makeManager();
    await manager.spawnTile('athena');
    expect(await manager.cycleGate('athena')).toBe('locked');
    expect(store.get().tiles['athena']!.gateMode).toBe('locked');
    expect(await manager.cycleGate('athena')).toBe('ask');
    expect(await manager.cycleGate('athena')).toBe('unlocked');
    await manager.shutdown();
  });

  it('renders a denied card in the transcript when locked (§6.4)', async () => {
    const { manager, windows } = makeManager('permission');
    await manager.spawnTile('athena');
    await manager.cycleGate('athena'); // unlocked → locked
    await manager.sendPrompt('athena', 'write a file');

    const denied = windows[0].sent.filter((m: any) => m.channel === 'tile:denied');
    expect(denied).toHaveLength(1);
    expect(denied[0].payload.title).toBe('write_file');

    const messages = store.get().tiles['athena']!.tabs[0]!.messages;
    expect(messages.some((m) => m.kind === 'denied')).toBe(true);
    await manager.shutdown();
  });

  it('persists window bounds on close (§10.5)', async () => {
    const { manager, windows } = makeManager();
    await manager.spawnTile('athena');
    windows[0].bounds = { x: 120, y: 240, width: 640, height: 480 };
    manager.closeTile('athena');
    await vi.waitFor(() =>
      expect(store.get().tiles['athena']!.bounds).toEqual({ x: 120, y: 240, width: 640, height: 480 }),
    );
    expect(manager.openTileIds).toEqual([]);
  });

  it('does not spawn a second tile for the same profile', async () => {
    const { manager, windows } = makeManager();
    await manager.spawnTile('athena');
    await manager.spawnTile('athena');
    expect(windows).toHaveLength(1);
    await manager.shutdown();
  });

  it('refuses to spawn a tile for an unknown profile with a readable error (§8.2)', async () => {
    const { manager } = makeManager();
    await expect(manager.spawnTile('ghost')).rejects.toThrow(/ghost/);
  });

  it('surfaces an agent crash to the renderer rather than dying (§8.2)', async () => {
    const { manager, windows } = makeManager('crash');
    await manager.spawnTile('athena').catch(() => {});
    await vi.waitFor(() =>
      expect(windows[0].sent.some((m: any) => m.channel === 'tile:agent-stopped')).toBe(true),
    );
  });

  it('shuts every subprocess down cleanly (§6.3.4)', async () => {
    const { manager } = makeManager();
    await manager.spawnTile('athena');
    await manager.shutdown();
    expect(manager.openTileIds).toEqual([]);
  });
});
