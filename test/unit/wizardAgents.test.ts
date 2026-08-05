import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentBuilder, suggestCharacter } from '../../src/main/wizard/agents';
import { StateStore } from '../../src/main/state/store';
import { DEFAULT_PALETTE } from '../../src/shared/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOCK_BIN = resolve(HERE, '../fixtures/mock-hermes/hermes');
const SCAFFOLD = 'You are Hermes Agent, an intelligent AI assistant created by Nous Research.';

let home: string;
let store: StateStore;

function makeBuilder() {
  return new AgentBuilder({
    store,
    hermesBin: MOCK_BIN,
    hermesHome: home,
    env: { MOCK_HERMES_HOME: home },
  });
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'circe-agents-'));
  writeFileSync(join(home, 'SOUL.md'), SCAFFOLD);
  store = new StateStore(join(home, 'state.json'));
  await store.load();
});
afterEach(async () => {
  await store.whenIdle();
  rmSync(home, { recursive: true, force: true });
});

describe('suggestCharacter', () => {
  it('suggests the first character of the cast', () => {
    expect(suggestCharacter('greek', [])!.name).toBe('Athena');
    expect(suggestCharacter('neutral', [])!.name).toBe('Alpha');
  });

  it('skips characters whose id is already taken', () => {
    expect(suggestCharacter('neutral', ['alpha'])!.name).toBe('Beta');
  });

  it('returns null when the whole cast is taken', () => {
    expect(suggestCharacter('neutral', ['alpha', 'beta', 'gamma', 'delta'])).toBeNull();
  });

  it('returns null for the custom cast, which has no characters', () => {
    expect(suggestCharacter('custom', [])).toBeNull();
  });
});

describe('AgentBuilder', () => {
  it('creates a profile from a character with its suggested palette', async () => {
    const p = await makeBuilder().createFromCharacter({ castId: 'greek', characterName: 'Athena' });
    expect(p.id).toBe('athena');
    expect(p.displayName).toBe('Athena');
    expect(p.tagline).toBe('the strategist');

    const tile = store.get().tiles['athena']!;
    expect(tile.palette.accent).toBe('#c9b273');
    expect(tile.tiled).toBe(true);
  });

  it('writes the heading into SOUL.md', async () => {
    await makeBuilder().createFromCharacter({ castId: 'greek', characterName: 'Athena' });
    const soul = readFileSync(join(home, 'profiles', 'athena', 'SOUL.md'), 'utf8');
    expect(soul.startsWith('# Athena — the strategist')).toBe(true);
  });

  it('opens new profiles unlocked (§6.4)', async () => {
    await makeBuilder().createFromCharacter({ castId: 'greek', characterName: 'Athena' });
    expect(store.get().tiles['athena']!.gateMode).toBe('unlocked');
  });

  it('opens coding profiles locked (§5.5, §6.4)', async () => {
    await makeBuilder().createFromCharacter({
      castId: 'startrek',
      characterName: 'Locutus',
      isCodingProfile: true,
    });
    const tile = store.get().tiles['locutus']!;
    expect(tile.gateMode).toBe('locked');
    expect(tile.isCodingProfile).toBe(true);
  });

  it('accepts a custom profile id and palette', async () => {
    const p = await makeBuilder().createFromCharacter({
      castId: 'custom',
      characterName: 'Sentinel',
      profileId: 'sentinel',
      palette: { accent: '#ff0000', background: '#000000' },
    });
    expect(p.id).toBe('sentinel');
    expect(store.get().tiles['sentinel']!.palette).toEqual({ accent: '#ff0000', background: '#000000' });
  });

  it('falls back to the default palette when none is available', async () => {
    await makeBuilder().createFromCharacter({
      castId: 'custom',
      characterName: 'Sentinel',
      profileId: 'sentinel',
    });
    expect(store.get().tiles['sentinel']!.palette).toEqual(DEFAULT_PALETTE);
  });

  it('sets the first created profile as main operator (§6 Screen 7)', async () => {
    const builder = makeBuilder();
    await builder.createFromCharacter({ castId: 'greek', characterName: 'Athena', makeMainOperator: true });
    await builder.createFromCharacter({ castId: 'greek', characterName: 'Hermes', makeMainOperator: true });
    // Only the first claim wins.
    expect(store.get().mainOperatorId).toBe('athena');
  });

  it('gives the new tile one tab with an empty transcript', async () => {
    await makeBuilder().createFromCharacter({ castId: 'greek', characterName: 'Athena' });
    const tile = store.get().tiles['athena']!;
    expect(tile.tabs).toHaveLength(1);
    expect(tile.tabs[0]!.messages).toEqual([]);
    expect(tile.activeTabId).toBe(tile.tabs[0]!.id);
  });

  it('rejects an unknown character', async () => {
    await expect(
      makeBuilder().createFromCharacter({ castId: 'greek', characterName: 'Nobody' }),
    ).rejects.toThrow(/Nobody/);
  });

  it('leaves the scaffold default untouched (decision 2)', async () => {
    await makeBuilder().createFromCharacter({ castId: 'greek', characterName: 'Athena' });
    expect(readFileSync(join(home, 'SOUL.md'), 'utf8')).toBe(SCAFFOLD);
  });
});

describe('AgentBuilder.adoptProfiles', () => {
  function seed(id: string, soul: string) {
    mkdirSync(join(home, 'profiles', id), { recursive: true });
    writeFileSync(join(home, 'profiles', id, 'SOUL.md'), soul);
  }

  it('gives every real profile a tile so the fleet can launch it', async () => {
    seed('athena', '# Athena — the strategist\n');
    seed('ford', '# Ford — Career\n');

    expect((await makeBuilder().adoptProfiles()).sort()).toEqual(['athena', 'ford']);
    expect(Object.keys(store.get().tiles).sort()).toEqual(['athena', 'ford']);
  });

  it('marks adopted tiles tiled, with one empty tab', async () => {
    seed('athena', '# Athena — the strategist\n');
    await makeBuilder().adoptProfiles();

    const tile = store.get().tiles['athena']!;
    expect(tile.tiled).toBe(true);
    expect(tile.tabs).toHaveLength(1);
    expect(tile.tabs[0]!.messages).toEqual([]);
    expect(tile.activeTabId).toBe(tile.tabs[0]!.id);
  });

  it('infers the §5.5 role and gates coding profiles locked (§6.4)', async () => {
    seed('locutus', '# Locutus — coding agent\n\nYou manage the git repo.\n');
    seed('ford', '# Ford — Career\n\nCareer planning and logistics.\n');
    await makeBuilder().adoptProfiles();

    expect(store.get().tiles['locutus']!.isCodingProfile).toBe(true);
    expect(store.get().tiles['locutus']!.gateMode).toBe('locked');
    expect(store.get().tiles['ford']!.isCodingProfile).toBe(false);
    expect(store.get().tiles['ford']!.gateMode).toBe('unlocked');
  });

  it('ignores the unconfigured scaffold default (§5.4)', async () => {
    seed('athena', '# Athena — the strategist\n');
    await makeBuilder().adoptProfiles();
    expect(Object.keys(store.get().tiles)).toEqual(['athena']);
  });

  it('never overwrites tile state that already exists', async () => {
    seed('athena', '# Athena — the strategist\n');
    await makeBuilder().adoptProfiles();
    await store.updateTile('athena', { gateMode: 'locked' });

    // A second pass must be a no-op, not a reset to defaults.
    expect(await makeBuilder().adoptProfiles()).toEqual([]);
    expect(store.get().tiles['athena']!.gateMode).toBe('locked');
  });

  it('claims main operator only when nothing else has', async () => {
    seed('athena', '# Athena — the strategist\n');
    await makeBuilder().adoptProfiles();
    expect(store.get().mainOperatorId).toBe('athena');
  });

  it('writes only Circe state, never a profile directory (§10.6)', async () => {
    const soul = '# Athena — the strategist\n\noriginal body\n';
    seed('athena', soul);
    await makeBuilder().adoptProfiles();

    expect(readFileSync(join(home, 'profiles', 'athena', 'SOUL.md'), 'utf8')).toBe(soul);
    expect(readFileSync(join(home, 'SOUL.md'), 'utf8')).toBe(SCAFFOLD);
  });
});
