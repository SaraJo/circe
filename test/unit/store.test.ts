import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateStore, migrate } from '../../src/main/state/store';
import { emptyState, DEFAULT_PALETTE, type TileState } from '../../src/shared/types';

let dir: string;
let file: string;

function tile(profileId: string, over: Partial<TileState> = {}): TileState {
  return {
    profileId,
    bounds: { x: 10, y: 20, width: 500, height: 600 },
    gateMode: 'unlocked',
    palette: DEFAULT_PALETTE,
    tabs: [{ id: 't1', title: 'New tab', sessionId: null, messages: [] }],
    activeTabId: 't1',
    tiled: true,
    isCodingProfile: false,
    ...over,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'circe-state-'));
  file = join(dir, 'state.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('StateStore', () => {
  it('returns empty state when the file does not exist', async () => {
    expect(await new StateStore(file).load()).toEqual(emptyState());
  });

  it('round-trips a three-tile fleet exactly (§10.5)', async () => {
    const store = new StateStore(file);
    const state = emptyState();
    state.onboarded = true;
    state.mainOperatorId = 'athena';
    state.tiles = {
      athena: tile('athena', {
        bounds: { x: 0, y: 0, width: 500, height: 600 },
        gateMode: 'locked',
        palette: { accent: '#ff0000', background: '#111111' },
        tabs: [
          { id: 't1', title: 'first', sessionId: 's1', messages: [{ role: 'user', text: 'hi' }] },
          { id: 't2', title: 'second', sessionId: 's2', messages: [] },
        ],
        activeTabId: 't2',
        isCodingProfile: true,
      }),
      ford: tile('ford', { bounds: { x: 520, y: 0, width: 480, height: 640 }, gateMode: 'ask' }),
      marvin: tile('marvin', { bounds: { x: 1040, y: 0, width: 500, height: 600 }, tiled: false }),
    };

    await store.save(state);
    expect(await new StateStore(file).load()).toEqual(state);
  });

  it('preserves every field §10.5 names', async () => {
    const store = new StateStore(file);
    const state = emptyState();
    state.tiles = { athena: tile('athena', { gateMode: 'ask', activeTabId: 't1' }) };
    await store.save(state);

    const loaded = await new StateStore(file).load();
    const t = loaded.tiles['athena']!;
    expect(t.bounds).toEqual({ x: 10, y: 20, width: 500, height: 600 });
    expect(t.gateMode).toBe('ask');
    expect(t.tabs).toHaveLength(1);
    expect(t.activeTabId).toBe('t1');
    expect(t.palette).toEqual(DEFAULT_PALETTE);
  });

  it('writes atomically, leaving no temp files behind', async () => {
    const store = new StateStore(file);
    await store.save(emptyState());
    expect(readdirSync(dir)).toEqual(['state.json']);
  });

  it('recovers to empty state from a truncated file rather than throwing', async () => {
    writeFileSync(file, '{"version":1,"tiles":{');
    expect(await new StateStore(file).load()).toEqual(emptyState());
  });

  it('recovers from a file that is valid JSON but the wrong shape', async () => {
    writeFileSync(file, '["not", "an", "object"]');
    expect(await new StateStore(file).load()).toEqual(emptyState());
  });

  it('drops tiles that are missing required fields instead of loading them broken', async () => {
    writeFileSync(
      file,
      JSON.stringify({ version: 1, onboarded: true, mainOperatorId: null, tiles: { bad: { profileId: 'bad' } } }),
    );
    const loaded = await new StateStore(file).load();
    expect(loaded.onboarded).toBe(true);
    expect(loaded.tiles).toEqual({});
  });

  it('updateTile patches one tile and persists', async () => {
    const store = new StateStore(file);
    const state = emptyState();
    state.tiles = { athena: tile('athena') };
    await store.save(state);

    await store.updateTile('athena', { gateMode: 'locked' });
    expect(store.get().tiles['athena']!.gateMode).toBe('locked');
    expect((await new StateStore(file).load()).tiles['athena']!.gateMode).toBe('locked');
  });

  it('updateTile on an unknown profile is a no-op', async () => {
    const store = new StateStore(file);
    await store.save(emptyState());
    await store.updateTile('ghost', { gateMode: 'locked' });
    expect(store.get().tiles).toEqual({});
  });

  it('removeTile deletes and persists', async () => {
    const store = new StateStore(file);
    const state = emptyState();
    state.tiles = { athena: tile('athena'), ford: tile('ford') };
    await store.save(state);

    await store.removeTile('athena');
    expect(Object.keys((await new StateStore(file).load()).tiles)).toEqual(['ford']);
  });

  it('serialises concurrent saves without interleaving', async () => {
    const store = new StateStore(file);
    await store.save(emptyState());
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => store.updateTile('athena', { gateMode: i % 2 ? 'locked' : 'ask' })),
    );
    // The file must still parse — the point is no torn write.
    expect(() => JSON.parse(readFileSync(file, 'utf8'))).not.toThrow();
  });
});

describe('migrate', () => {
  it('accepts a well-formed state unchanged', () => {
    const state = emptyState();
    expect(migrate(state)).toEqual(state);
  });

  it('returns empty state for null', () => {
    expect(migrate(null)).toEqual(emptyState());
  });
});
