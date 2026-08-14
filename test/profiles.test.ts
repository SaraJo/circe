import { describe, expect, it } from 'vitest';
import { displayNameFor, hasConfiguredDefault, isRealSoul } from '../src/main/profiles';
import { SCAFFOLD_SOUL } from './fake/hermes';

describe('isRealSoul', () => {
  it('treats a missing SOUL.md as not real', () => {
    expect(isRealSoul(null)).toBe(false);
  });

  it('treats the untouched Hermes scaffold as not real', () => {
    expect(isRealSoul(SCAFFOLD_SOUL)).toBe(false);
  });

  it('treats an empty file as not real', () => {
    expect(isRealSoul('   \n\n  ')).toBe(false);
  });

  it('treats a SOUL.md with an H1 as real', () => {
    expect(isRealSoul('# Trillian — Central Coordinator\n\nYou are Trillian.\n')).toBe(true);
  });

  it('does not count an H2 as a heading', () => {
    expect(isRealSoul('## Notes\n\nsome prose\n')).toBe(false);
  });
});

describe('displayNameFor', () => {
  it('falls back to the profile id when there is no heading', () => {
    expect(displayNameFor('ford', SCAFFOLD_SOUL)).toBe('ford');
  });

  it('reads the name out of the heading', () => {
    expect(displayNameFor('default', '# Trillian — Central Coordinator\n')).toBe('Trillian');
  });

  it('handles a heading with no tagline', () => {
    expect(displayNameFor('zaphod', '# Zaphod\n')).toBe('Zaphod');
  });
});

describe('hasConfiguredDefault', () => {
  it('is false when the default is a bare scaffold', () => {
    expect(
      hasConfiguredDefault([{ id: 'default', displayName: 'default', model: null, isReal: false }]),
    ).toBe(false);
  });

  it('is true when the user already wrote a default persona', () => {
    expect(
      hasConfiguredDefault([{ id: 'default', displayName: 'Trillian', model: null, isReal: true }]),
    ).toBe(true);
  });

  it('is false when there is no default profile at all', () => {
    expect(
      hasConfiguredDefault([{ id: 'ford', displayName: 'Ford', model: null, isReal: true }]),
    ).toBe(false);
  });
});
