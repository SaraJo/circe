import { describe, expect, it } from 'vitest';
import { nextToolTitle, toolLabel, WORKING } from '../src/renderer/tile/toolLabel';

/**
 * The defect: during the Phase 2 walkthrough the orchestrator's transcript drew
 * `⚙ toolu_01VsyAkmt8QqNFMnbPNhP96g`.
 *
 * ACP requires `title` on `tool_call` and makes every field except `toolCallId`
 * optional on `tool_call_update` — "only the fields being changed need to be
 * included" — so a status-only update carrying no title is the ordinary case,
 * not a malformed one. The renderer answered it by falling back to the
 * `toolCallId`, which overwrote a good label with a raw id the moment the tool
 * it had just named finished.
 */
describe('nextToolTitle', () => {
  it('takes the title from an update that carries one', () => {
    expect(nextToolTitle({ title: 'Read' }, '')).toBe('Read');
  });

  // The bug, stated as behaviour: a status-only update must not disturb the
  // label the initiating `tool_call` set.
  it('keeps the title already showing when an update carries none', () => {
    expect(nextToolTitle({ toolCallId: 'toolu_01VsyAkmt8QqNFMnbPNhP96g' }, 'Read')).toBe('Read');
  });

  it('never takes a tool call id as a title', () => {
    const title = nextToolTitle({ toolCallId: 'toolu_01VsyAkmt8QqNFMnbPNhP96g' }, '');
    expect(title).not.toContain('toolu_');
  });

  it('moves to the next tool when a new call names itself', () => {
    expect(nextToolTitle({ title: 'Write' }, 'Read')).toBe('Write');
  });

  // A title that is present but useless is the same case as absent: the point
  // of the bubble is that the tile is visibly working, and a blank label reads
  // as broken rather than as busy.
  it('ignores a title that is blank or not a string', () => {
    expect(nextToolTitle({ title: '   ' }, 'Read')).toBe('Read');
    expect(nextToolTitle({ title: 42 }, 'Read')).toBe('Read');
    expect(nextToolTitle({ title: null }, 'Read')).toBe('Read');
  });

  it('survives an update that is not an object at all', () => {
    expect(nextToolTitle(null, 'Read')).toBe('Read');
    expect(nextToolTitle(undefined, 'Read')).toBe('Read');
  });
});

describe('toolLabel', () => {
  it('shows the tool the agent named', () => {
    expect(toolLabel('Read')).toBe('⚙ Read');
  });

  // Reachable when the first thing a tile sees is an update rather than the
  // `tool_call` that opened it — on replay, or when a tile attaches to a turn
  // already in flight. The bubble still has a job to do (this turn is not
  // frozen), so it says so in words rather than in an id.
  it('says something a person can read when no tool has been named', () => {
    expect(toolLabel('')).toBe(`⚙ ${WORKING}`);
    expect(WORKING).not.toContain('toolu_');
    expect(WORKING).toMatch(/\w/);
  });
});
