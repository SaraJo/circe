import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Fleet } from '../../src/main/fleet';
import { TileManager } from '../../src/main/tiles/manager';
import { StateStore } from '../../src/main/state/store';
import { emptyState, DEFAULT_PALETTE, type TileState } from '../../src/shared/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOCK_BIN = resolve(HERE, '../fixtures/mock-hermes/hermes');

let home: string;
let store: StateStore;

function tile(profileId: string, over: Partial<TileState> = {}): TileState {
  return {
    profileId,
    bounds: { x: 0, y: 0, width: 500, height: 600 },
    gateMode: 'unlocked',
    palette: DEFAULT_PALETTE,
    tabs: [{ id: 't1', title: 'New tab', sessionId: null, messages: [] }],
    activeTabId: 't1',
    tiled: true,
    isCodingProfile: false,
    ...over,
  };
}

function seedProfile(id: string, soul = `# ${id} — test\n`) {
  mkdirSync(join(home, 'profiles', id), { recursive: true });
  writeFileSync(join(home, 'profiles', id, 'SOUL.md'), soul);
}

function makeFleet() {
  const windows: any[] = [];
  const tiles = new TileManager({
    store,
    hermesBin: MOCK_BIN,
    hermesHome: home,
    env: { MOCK_HERMES_SCENARIO: 'stream', MOCK_HERMES_HOME: home },
    createWindow: ((profileId: string) => {
      const w = {
        profileId, sent: [] as any[], destroyed: false,
        send: (c: string, p: unknown) => w.sent.push({ channel: c, payload: p }),
        getBounds: () => ({ x: 0, y: 0, width: 500, height: 600 }),
        close: () => { w.destroyed = true; },
        isDestroyed: () => w.destroyed,
      };
      windows.push(w);
      return w;
    }) as any,
  });
  return { fleet: new Fleet({ store, tiles, hermesHome: home }), tiles, windows };
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'circe-fleet-'));
  writeFileSync(join(home, 'SOUL.md'), 'scaffold prose');
  store = new StateStore(join(home, 'state.json'));
  await store.load();
});
afterEach(async () => {
  await store.whenIdle();
  rmSync(home, { recursive: true, force: true });
});

describe('Fleet.plan', () => {
  it('launches every tiled profile', async () => {
    seedProfile('athena');
    seedProfile('ford');
    await store.save({ ...emptyState(), tiles: { athena: tile('athena'), ford: tile('ford') } });
    const { fleet } = makeFleet();
    expect((await fleet.plan()).launchable.sort()).toEqual(['athena', 'ford']);
  });

  it('skips profiles marked "leave alone" (§6 Screen 4b)', async () => {
    seedProfile('athena');
    seedProfile('ford');
    await store.save({
      ...emptyState(),
      tiles: { athena: tile('athena'), ford: tile('ford', { tiled: false }) },
    });
    const plan = await makeFleet().fleet.plan();
    expect(plan.launchable).toEqual(['athena']);
    expect(plan.skipped).toEqual([{ profileId: 'ford', reason: 'not-tiled' }]);
  });

  it('skips a profile that no longer exists on disk (§8.2)', async () => {
    await store.save({ ...emptyState(), tiles: { ghost: tile('ghost') } });
    const plan = await makeFleet().fleet.plan();
    expect(plan.launchable).toEqual([]);
    expect(plan.skipped).toEqual([{ profileId: 'ghost', reason: 'missing' }]);
  });
});

describe('Fleet.launch', () => {
  it('spawns one tile per launchable profile', async () => {
    seedProfile('athena');
    seedProfile('ford');
    await store.save({ ...emptyState(), tiles: { athena: tile('athena'), ford: tile('ford') } });
    const { fleet, tiles } = makeFleet();
    const result = await fleet.launch();
    expect(result.launched).toBe(2);
    expect(tiles.openTileIds.sort()).toEqual(['athena', 'ford']);
    await tiles.shutdown();
  });

  it('ZERO-TILE GUARD (decision 1): launching nothing reports zero and opens no windows', async () => {
    seedProfile('ford');
    await store.save({ ...emptyState(), tiles: { ford: tile('ford', { tiled: false }) } });
    const { fleet, tiles, windows } = makeFleet();
    const result = await fleet.launch();
    expect(result.launched).toBe(0);
    expect(windows).toHaveLength(0);
    expect(tiles.openTileIds).toEqual([]);
  });

  it('launches the rest when one profile is broken (§8.2)', async () => {
    seedProfile('athena');
    await store.save({ ...emptyState(), tiles: { athena: tile('athena'), ghost: tile('ghost') } });
    const { fleet, tiles } = makeFleet();
    const result = await fleet.launch();
    expect(result.launched).toBe(1);
    expect(result.skipped.map((s) => s.profileId)).toEqual(['ghost']);
    await tiles.shutdown();
  });

  it('restores saved bounds rather than re-laying-out (§10.5)', async () => {
    seedProfile('athena');
    await store.save({
      ...emptyState(),
      tiles: { athena: tile('athena', { bounds: { x: 300, y: 150, width: 640, height: 480 } }) },
    });
    const { fleet, tiles } = makeFleet();
    await fleet.launch();
    expect(store.get().tiles['athena']!.bounds).toEqual({ x: 300, y: 150, width: 640, height: 480 });
    await tiles.shutdown();
  });
});

describe('Fleet.layout', () => {
  it('lays tiles out left to right across the display', () => {
    const { fleet } = makeFleet();
    const boxes = fleet.layout(3, { width: 1800, height: 1000 });
    expect(boxes).toHaveLength(3);
    expect(boxes[0]!.x).toBeLessThan(boxes[1]!.x);
    expect(boxes[1]!.x).toBeLessThan(boxes[2]!.x);
    for (const b of boxes) {
      expect(b.x + b.width).toBeLessThanOrEqual(1800);
      expect(b.y + b.height).toBeLessThanOrEqual(1000);
    }
  });

  it('wraps to a second row when a row is full', () => {
    const { fleet } = makeFleet();
    const boxes = fleet.layout(6, { width: 1200, height: 1400 });
    expect(boxes.some((b) => b.y > boxes[0]!.y)).toBe(true);
  });

  it('returns nothing for an empty fleet', () => {
    expect(makeFleet().fleet.layout(0, { width: 1800, height: 1000 })).toEqual([]);
  });
});
