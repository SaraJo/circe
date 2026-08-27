import { describe, expect, it } from 'vitest';
import {
  EMPTY_STATE,
  parseTileState,
  readTileState,
  serializeTileState,
  stateFor,
  TILE_STATE_PATH,
  withActiveSession,
  withProfileTabs,
  writeTileState,
} from '../src/main/tileState';
import { FakeHermes, INSTALLED_EMPTY } from './fake/hermes';

describe('parseTileState', () => {
  it('reads a well-formed record', () => {
    const file = parseTileState(
      JSON.stringify({ version: 1, profiles: { default: { tabs: ['s1'], activeIndex: 0 } } }),
    );
    expect(stateFor(file, 'default')).toEqual({ tabs: ['s1'], activeIndex: 0 });
  });

  it('treats an absent file as empty rather than failing', () => {
    expect(parseTileState(null)).toEqual(EMPTY_STATE);
  });

  it('treats corrupt JSON as empty', () => {
    expect(parseTileState('{not json')).toEqual(EMPTY_STATE);
  });

  // Same rule as startup.ts: a record written by a later Circe may hold fields
  // this build would half-read. Losing which tab was open costs a scroll-back;
  // acting on a shape we don't understand costs correctness.
  it('ignores a record written by a future version', () => {
    const file = parseTileState(JSON.stringify({ version: 2, profiles: { default: { tabs: ['s1'], activeIndex: 0 } } }));
    expect(file).toEqual(EMPTY_STATE);
  });

  it('drops a profile whose tabs are not strings', () => {
    const file = parseTileState(
      JSON.stringify({ version: 1, profiles: { default: { tabs: [7], activeIndex: 0 } } }),
    );
    expect(stateFor(file, 'default')).toEqual({ tabs: [], activeIndex: 0 });
  });

  // The design already spells `bounds` and `accessMode` (§3) for a later
  // phase. Keeping only the two fields this build understands would mean the
  // next write silently deleted a newer Circe's window geometry and access
  // mode — the record survives a version bump, so it has to survive this one.
  it('carries a future build’s unknown fields through parse and serialize', () => {
    const written = {
      version: 1,
      lastOperator: 'ford',
      profiles: {
        default: {
          tabs: ['s1'],
          activeIndex: 0,
          bounds: { x: 100, y: 40, width: 430, height: 480 },
          accessMode: 'ask',
        },
      },
    };
    const round = JSON.parse(serializeTileState(parseTileState(JSON.stringify(written))));
    expect(round).toEqual(written);
  });

  it('keeps unknown fields across a session change', () => {
    const parsed = parseTileState(
      JSON.stringify({
        version: 1,
        lastOperator: 'ford',
        profiles: { default: { tabs: ['s1'], activeIndex: 0, accessMode: 'ask' } },
      }),
    );
    const next = withActiveSession(parsed, 'default', 's2');
    expect(JSON.parse(serializeTileState(next))).toEqual({
      version: 1,
      lastOperator: 'ford',
      profiles: { default: { tabs: ['s2'], activeIndex: 0, accessMode: 'ask' } },
    });
  });

  it('clamps an activeIndex that points past the end', () => {
    const file = parseTileState(
      JSON.stringify({ version: 1, profiles: { default: { tabs: ['s1'], activeIndex: 4 } } }),
    );
    expect(stateFor(file, 'default').activeIndex).toBe(0);
  });
});

// Returned by identity from every degradation path, so one caller mutating it
// would poison every later reader in the process.
describe('EMPTY_STATE', () => {
  it('is frozen, top level and profiles alike', () => {
    expect(Object.isFrozen(EMPTY_STATE)).toBe(true);
    expect(Object.isFrozen(EMPTY_STATE.profiles)).toBe(true);
  });

  it('survives a caller trying to write a profile into it', () => {
    const shared = parseTileState('{not json');
    expect(() => {
      (shared.profiles as Record<string, unknown>)['default'] = { tabs: ['x'], activeIndex: 0 };
    }).toThrow(TypeError);
    expect(stateFor(parseTileState(null), 'default')).toEqual({ tabs: [], activeIndex: 0 });
  });
});

describe('stateFor', () => {
  it('returns an empty state for a profile with no record', () => {
    expect(stateFor(EMPTY_STATE, 'ford')).toEqual({ tabs: [], activeIndex: 0 });
  });
});

describe('withActiveSession', () => {
  it('records the session as the profile\'s only tab', () => {
    const next = withActiveSession(EMPTY_STATE, 'default', 's1');
    expect(stateFor(next, 'default')).toEqual({ tabs: ['s1'], activeIndex: 0 });
  });

  it('leaves other profiles untouched', () => {
    const first = withActiveSession(EMPTY_STATE, 'default', 's1');
    const second = withActiveSession(first, 'ford', 's2');
    expect(stateFor(second, 'default').tabs).toEqual(['s1']);
    expect(stateFor(second, 'ford').tabs).toEqual(['s2']);
  });

  it('round-trips through serialize and parse', () => {
    const next = withActiveSession(EMPTY_STATE, 'default', 's1');
    expect(parseTileState(serializeTileState(next))).toEqual(next);
  });

  it('replaces only the active tab when a saved conversation is stale', () => {
    const file = withProfileTabs(EMPTY_STATE, 'default', ['s1', 'stale', 's3'], 1);
    expect(stateFor(withActiveSession(file, 'default', 'fresh'), 'default')).toEqual({
      tabs: ['s1', 'fresh', 's3'],
      activeIndex: 1,
    });
  });
});

describe('withProfileTabs', () => {
  it('records tab order and the selected conversation', () => {
    const next = withProfileTabs(EMPTY_STATE, 'default', ['s1', 's2'], 1);
    expect(stateFor(next, 'default')).toEqual({ tabs: ['s1', 's2'], activeIndex: 1 });
  });
});

describe('readTileState', () => {
  it('returns EMPTY_STATE when readHomeFile rejects', async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    const realRead = hermes.readHomeFile.bind(hermes);
    hermes.readHomeFile = async (rel: string) => {
      if (rel === TILE_STATE_PATH) throw new Error('EACCES');
      return realRead(rel);
    };
    const result = await readTileState(hermes);
    expect(result).toEqual(EMPTY_STATE);
  });
});

describe('writeTileState', () => {
  it('does not reject when writeHomeFile rejects', async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    const realWrite = hermes.writeHomeFile.bind(hermes);
    hermes.writeHomeFile = async (rel: string, contents: string) => {
      if (rel === TILE_STATE_PATH) throw new Error('EACCES');
      return realWrite(rel, contents);
    };
    const state = withActiveSession(EMPTY_STATE, 'default', 's1');
    // This should not throw even though writeHomeFile will reject.
    await expect(writeTileState(hermes, state)).resolves.toBeUndefined();
  });
});
