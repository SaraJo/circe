import { describe, expect, it } from 'vitest';
import {
  EMPTY_STATE,
  parseTileState,
  serializeTileState,
  stateFor,
  withActiveSession,
} from '../src/main/tileState';

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

  it('clamps an activeIndex that points past the end', () => {
    const file = parseTileState(
      JSON.stringify({ version: 1, profiles: { default: { tabs: ['s1'], activeIndex: 4 } } }),
    );
    expect(stateFor(file, 'default').activeIndex).toBe(0);
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
});
