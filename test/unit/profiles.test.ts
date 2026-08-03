import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { enumerateProfiles, isRealProfile, inferCodingProfile } from '../../src/main/hermes/profiles';

const SCAFFOLD =
  'You are Hermes Agent, an intelligent AI assistant created by Nous Research. ' +
  'You are helpful, knowledgeable, and direct.';

let home: string;

function seedDefault(markdown: string) {
  writeFileSync(join(home, 'SOUL.md'), markdown);
}

function seedNamed(id: string, markdown: string) {
  const dir = join(home, 'profiles', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SOUL.md'), markdown);
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'circe-home-'));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('isRealProfile', () => {
  it('treats the untouched scaffold default as not real', () => {
    expect(isRealProfile({ isDefault: true, soulMarkdown: SCAFFOLD })).toBe(false);
  });

  it('treats a default with a heading as real', () => {
    expect(
      isRealProfile({ isDefault: true, soulMarkdown: '# Trillian — Central Coordinator\n' }),
    ).toBe(true);
  });

  it('treats any named profile as real, even with a scaffold SOUL', () => {
    expect(isRealProfile({ isDefault: false, soulMarkdown: SCAFFOLD })).toBe(true);
  });

  it('treats a default with no SOUL.md as not real', () => {
    expect(isRealProfile({ isDefault: true, soulMarkdown: null })).toBe(false);
  });
});

describe('enumerateProfiles', () => {
  it('reports zero real profiles for a fresh Hermes install (§5.4 test requirement)', async () => {
    seedDefault(SCAFFOLD);
    const profiles = await enumerateProfiles(home);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.id).toBe('default');
    expect(profiles.filter((p) => p.real)).toHaveLength(0);
  });

  it('reports one real profile once the user configures one (§5.4 test requirement)', async () => {
    seedDefault(SCAFFOLD);
    seedNamed('ford', '# Ford — Career\n\nbody');
    const real = (await enumerateProfiles(home)).filter((p) => p.real);
    expect(real).toHaveLength(1);
    expect(real[0]!.id).toBe('ford');
    expect(real[0]!.displayName).toBe('Ford');
    expect(real[0]!.tagline).toBe('Career');
  });

  it('resolves the display name from the heading and the id otherwise', async () => {
    seedDefault(SCAFFOLD);
    seedNamed('nameless', SCAFFOLD);
    const byId = Object.fromEntries((await enumerateProfiles(home)).map((p) => [p.id, p]));
    expect(byId['nameless']!.displayName).toBe('nameless');
    expect(byId['nameless']!.tagline).toBeNull();
  });

  it('marks the root profile isDefault and points it at the home dir itself', async () => {
    seedDefault('# Trillian — Central Coordinator\n');
    const [d] = await enumerateProfiles(home);
    expect(d!.isDefault).toBe(true);
    expect(d!.path).toBe(home);
    expect(d!.soulPath).toBe(join(home, 'SOUL.md'));
  });

  it('sorts default first, then named profiles alphabetically', async () => {
    seedDefault(SCAFFOLD);
    seedNamed('zaphod', '# Zaphod, Wealth Planner\n');
    seedNamed('ford', '# Ford — Career\n');
    expect((await enumerateProfiles(home)).map((p) => p.id)).toEqual(['default', 'ford', 'zaphod']);
  });

  it('ignores non-directory entries under profiles/', async () => {
    seedDefault(SCAFFOLD);
    mkdirSync(join(home, 'profiles'), { recursive: true });
    writeFileSync(join(home, 'profiles', '.DS_Store'), 'junk');
    expect(await enumerateProfiles(home)).toHaveLength(1);
  });

  it('returns an empty list when the home directory does not exist', async () => {
    expect(await enumerateProfiles(join(home, 'nope'))).toEqual([]);
  });
});

describe('inferCodingProfile (§5.5 fallback)', () => {
  it('matches coding language in a heading', () => {
    expect(inferCodingProfile('# Locutus — coding agent\n')).toBe(true);
  });

  it('matches repo and shell vocabulary in the body', () => {
    expect(inferCodingProfile('# Data — helper\n\nYou manage the git repo.')).toBe(true);
  });

  it('does not match an unrelated persona', () => {
    expect(inferCodingProfile('# Random — Family\n\nFamily life and logistics.')).toBe(false);
  });
});
