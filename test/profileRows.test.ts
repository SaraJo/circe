import { describe, expect, it } from 'vitest';
import { parseProfileRows } from '../src/main/hermes/real';

/** Real captured output of `hermes profile list` (piped, so no colour). */
const PLAIN = ` Profile          Model                        Gateway      Alias        Distribution
 ───────────────    ───────────────────────────    ───────────    ───────────    ────────────────────
 ◆default         claude-opus-4-7              running      —            —
  deep-thought    claude-opus-4-7              stopped      deep-thought —
  eddie           claude-sonnet-4-5            stopped      eddie        —
  ford            claude-opus-4-7              stopped      ford         —
`;

/** Same rows, as they appear on a TTY: ids wrapped in ANSI colour codes. */
const COLOURISED = ` Profile          Model                        Gateway      Alias        Distribution
 ───────────────    ───────────────────────────    ───────────    ───────────    ────────────────────
 ◆\x1b[36mdefault\x1b[0m         claude-opus-4-7              running      —            —
  \x1b[36mdeep-thought\x1b[0m    claude-opus-4-7              stopped      deep-thought —
  \x1b[36meddie\x1b[0m           claude-sonnet-4-5            stopped      eddie        —
  \x1b[36mford\x1b[0m            claude-opus-4-7              stopped      ford         —
`;

const EXPECTED = new Map([
  ['default', 'claude-opus-4-7'],
  ['deep-thought', 'claude-opus-4-7'],
  ['eddie', 'claude-sonnet-4-5'],
  ['ford', 'claude-opus-4-7'],
]);

describe('parseProfileRows', () => {
  it('parses real captured `hermes profile list` output into id -> model', () => {
    expect(parseProfileRows(PLAIN)).toEqual(EXPECTED);
  });

  it('excludes the header row and the rule row', () => {
    const ids = [...parseProfileRows(PLAIN).keys()];
    expect(ids).toHaveLength(4);
    expect(ids).not.toContain('Profile');
  });

  it('parses identically when ids are wrapped in ANSI colour codes', () => {
    expect(parseProfileRows(COLOURISED)).toEqual(EXPECTED);
  });
});
