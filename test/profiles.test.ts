import { describe, expect, it } from 'vitest';
import {
  adoptableProfiles,
  displayNameFor,
  hasConfiguredDefault,
  isRealSoul,
} from '../src/main/profiles';
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

  it('treats a setext heading as real', () => {
    expect(isRealSoul('Trillian\n========\n\nYou are Trillian.\n')).toBe(true);
  });

  it('treats an H1 after leading YAML front matter as real', () => {
    expect(
      isRealSoul('---\ntitle: Trillian\n---\n# Trillian — Central Coordinator\n\nprose\n'),
    ).toBe(true);
  });

  it('treats unclosed front matter with no heading as not real', () => {
    expect(isRealSoul('---\ntitle: Trillian\nno closing delimiter\nsome prose\n')).toBe(false);
  });

  it('treats an H1 appearing after a paragraph of prose as real', () => {
    expect(isRealSoul('Some scaffold prose here.\n\n# Trillian\n')).toBe(true);
  });

  it('treats a document whose only heading is an H2 as not real', () => {
    expect(isRealSoul('## Notes\n\nsome prose\n\nmore prose\n')).toBe(false);
  });

  it('treats a CRLF ATX heading as real', () => {
    expect(isRealSoul('# Trillian\r\n\r\nYou are Trillian.\r\n')).toBe(true);
  });

  it('treats a CRLF setext heading as real', () => {
    expect(isRealSoul('Trillian\r\n========\r\n\r\nYou are Trillian.\r\n')).toBe(true);
  });

  it('treats a leading BOM before an H1 as real', () => {
    expect(isRealSoul('﻿# Trillian\n\nYou are Trillian.\n')).toBe(true);
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

  it('reads the name out of a setext heading', () => {
    expect(displayNameFor('default', 'Trillian\n========\n')).toBe('Trillian');
  });

  it('reads the name out of an H1 that follows front matter', () => {
    expect(
      displayNameFor('default', '---\ntitle: Trillian\n---\n# Trillian — Central Coordinator\n'),
    ).toBe('Trillian');
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

describe('adoptableProfiles', () => {
  const scaffoldDefault = {
    id: 'default',
    displayName: 'default',
    model: null,
    isReal: false,
  };

  it('keeps a lone scaffold default on the fresh onboarding path', () => {
    expect(adoptableProfiles([scaffoldDefault])).toEqual([]);
  });

  it('includes default once a configured named profile proves this is an existing fleet', () => {
    const home = { id: 'home', displayName: 'Home', model: null, isReal: true };
    expect(adoptableProfiles([scaffoldDefault, home])).toEqual([scaffoldDefault, home]);
  });

  it('still excludes half-created named profiles', () => {
    const incomplete = { id: 'draft', displayName: 'draft', model: null, isReal: false };
    const home = { id: 'home', displayName: 'Home', model: null, isReal: true };
    expect(adoptableProfiles([scaffoldDefault, incomplete, home])).toEqual([
      scaffoldDefault,
      home,
    ]);
  });
});
