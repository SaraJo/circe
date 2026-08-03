import { describe, it, expect } from 'vitest';
import { parseSoulHeading, renderSoulHeading, withSoulHeading } from '../../src/main/hermes/soul';

const SCAFFOLD =
  'You are Hermes Agent, an intelligent AI assistant created by Nous Research. ' +
  'You are helpful, knowledgeable, and direct.';

describe('parseSoulHeading', () => {
  it('parses an em-dash heading', () => {
    expect(parseSoulHeading('# Ford — Career\n\nbody')).toEqual({ name: 'Ford', tagline: 'Career' });
  });

  it('parses a hyphen heading', () => {
    expect(parseSoulHeading('# Data - the analyst\n')).toEqual({ name: 'Data', tagline: 'the analyst' });
  });

  it('parses a comma heading', () => {
    expect(parseSoulHeading('# Zaphod, Wealth Planner\n')).toEqual({
      name: 'Zaphod',
      tagline: 'Wealth Planner',
    });
  });

  it('parses a heading with no tagline', () => {
    expect(parseSoulHeading('# Athena\n')).toEqual({ name: 'Athena', tagline: null });
  });

  it('skips leading blank lines', () => {
    expect(parseSoulHeading('\n\n# Marvin — the depressed android\n')).toEqual({
      name: 'Marvin',
      tagline: 'the depressed android',
    });
  });

  it('returns null for the Hermes scaffold, which has no heading', () => {
    expect(parseSoulHeading(SCAFFOLD)).toBeNull();
  });

  it('returns null for an empty file', () => {
    expect(parseSoulHeading('')).toBeNull();
  });

  it('ignores a heading that is not the first non-empty line', () => {
    expect(parseSoulHeading('some prose\n\n# Not A Name — nope\n')).toBeNull();
  });

  it('ignores a level-2 heading', () => {
    expect(parseSoulHeading('## Your scope\n')).toBeNull();
  });
});

describe('renderSoulHeading', () => {
  it('always writes the em-dash form', () => {
    expect(renderSoulHeading({ name: 'Athena', tagline: 'the strategist' })).toBe(
      '# Athena — the strategist',
    );
  });

  it('omits the separator when there is no tagline', () => {
    expect(renderSoulHeading({ name: 'Athena', tagline: null })).toBe('# Athena');
  });
});

describe('withSoulHeading', () => {
  it('prepends a heading to scaffold prose, preserving the body', () => {
    const out = withSoulHeading(SCAFFOLD, { name: 'Athena', tagline: 'the strategist' });
    expect(out.startsWith('# Athena — the strategist\n\n')).toBe(true);
    expect(out).toContain('You are Hermes Agent');
  });

  it('replaces an existing heading without touching the body', () => {
    const out = withSoulHeading('# Old — thing\n\nkeep me\n', { name: 'New', tagline: 'other' });
    expect(out).toBe('# New — other\n\nkeep me\n');
  });

  it('round-trips through the parser', () => {
    const h = { name: 'Deep-Thought', tagline: 'Bakafund' };
    expect(parseSoulHeading(withSoulHeading('body', h))).toEqual(h);
  });
});
