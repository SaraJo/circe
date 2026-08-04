import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateProfileId, createProfile } from '../../src/main/hermes/create';
import { enumerateProfiles } from '../../src/main/hermes/profiles';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOCK_BIN = resolve(HERE, '../fixtures/mock-hermes/hermes');
const SCAFFOLD = 'You are Hermes Agent, an intelligent AI assistant created by Nous Research.';

let home: string;

/** Hash every file under a directory so we can prove nothing was touched (§10.6). */
function hashTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string, prefix: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, rel);
      else if (entry.isFile()) out[rel] = createHash('sha256').update(readFileSync(full)).digest('hex');
    }
  };
  if (statSync(dir, { throwIfNoEntry: false })) walk(dir, '');
  return out;
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'circe-create-'));
  writeFileSync(join(home, 'SOUL.md'), SCAFFOLD);
  mkdirSync(join(home, 'profiles', 'ford'), { recursive: true });
  writeFileSync(join(home, 'profiles', 'ford', 'SOUL.md'), '# Ford — Career\n\nbody\n');
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('validateProfileId', () => {
  it('accepts lowercase alphanumerics', () => {
    expect(validateProfileId('athena', []).ok).toBe(true);
  });

  it('accepts hyphens and underscores — deep-thought exists on real installs', () => {
    expect(validateProfileId('deep-thought', []).ok).toBe(true);
    expect(validateProfileId('deep_thought', []).ok).toBe(true);
  });

  it('rejects uppercase, since Hermes ids are lowercase', () => {
    expect(validateProfileId('Athena', []).ok).toBe(false);
  });

  it('rejects spaces and punctuation', () => {
    expect(validateProfileId('deep thought', []).ok).toBe(false);
    expect(validateProfileId('athena!', []).ok).toBe(false);
  });

  it('rejects a leading hyphen, which would parse as a flag', () => {
    expect(validateProfileId('-athena', []).ok).toBe(false);
  });

  it('rejects an id longer than 32 characters (§6 Screen 5)', () => {
    expect(validateProfileId('a'.repeat(33), []).ok).toBe(false);
    expect(validateProfileId('a'.repeat(32), []).ok).toBe(true);
  });

  it('rejects an id already taken', () => {
    const r = validateProfileId('ford', ['default', 'ford']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/already/i);
  });

  it('rejects the reserved id "default"', () => {
    expect(validateProfileId('default', []).ok).toBe(false);
  });

  it('rejects an empty id', () => {
    expect(validateProfileId('', []).ok).toBe(false);
  });
});

describe('createProfile', () => {
  it('creates the profile and writes the heading', async () => {
    const p = await createProfile({
      hermesBin: MOCK_BIN,
      hermesHome: home,
      id: 'athena',
      heading: { name: 'Athena', tagline: 'the strategist' },
      env: { MOCK_HERMES_HOME: home },
    });
    expect(p.id).toBe('athena');
    expect(p.displayName).toBe('Athena');
    expect(p.tagline).toBe('the strategist');
    const soul = readFileSync(join(home, 'profiles', 'athena', 'SOUL.md'), 'utf8');
    expect(soul.startsWith('# Athena — the strategist')).toBe(true);
  });

  it('appends optional persona text below the heading', async () => {
    await createProfile({
      hermesBin: MOCK_BIN,
      hermesHome: home,
      id: 'marvin',
      heading: { name: 'Marvin', tagline: 'the depressed android' },
      persona: 'You still do the work.',
      env: { MOCK_HERMES_HOME: home },
    });
    const soul = readFileSync(join(home, 'profiles', 'marvin', 'SOUL.md'), 'utf8');
    expect(soul).toContain('# Marvin — the depressed android');
    expect(soul).toContain('You still do the work.');
  });

  it('leaves every pre-existing profile byte-identical (§4.9, §10.6)', async () => {
    const before = hashTree(home);
    // Guard against a vacuous pass: if the fixture drifts and `home` ever
    // starts out empty, every assertion below is vacuously true even against
    // a no-op createProfile.
    expect(Object.keys(before).length).toBeGreaterThan(0);
    await createProfile({
      hermesBin: MOCK_BIN,
      hermesHome: home,
      id: 'athena',
      heading: { name: 'Athena', tagline: null },
      env: { MOCK_HERMES_HOME: home },
    });
    const after = hashTree(home);
    // The only difference is the new profile's own files.
    for (const [file, hash] of Object.entries(before)) {
      expect(after[file], `${file} was modified`).toBe(hash);
    }
    const added = Object.keys(after).filter((f) => !(f in before));
    expect(added).toContain('profiles/athena/SOUL.md');
    expect(added.every((f) => f.startsWith('profiles/athena/'))).toBe(true);
  });

  it('rejects a duplicate id without touching disk', async () => {
    const before = hashTree(home);
    await expect(
      createProfile({
        hermesBin: MOCK_BIN,
        hermesHome: home,
        id: 'ford',
        heading: { name: 'Ford', tagline: 'Career' },
        env: { MOCK_HERMES_HOME: home },
      }),
    ).rejects.toThrow(/already/i);
    expect(hashTree(home)).toEqual(before);
  });

  it('surfaces a readable error when the CLI fails', async () => {
    await expect(
      createProfile({
        hermesBin: MOCK_BIN,
        hermesHome: home,
        id: 'Bad Name',
        heading: { name: 'Bad', tagline: null },
        env: { MOCK_HERMES_HOME: home },
      }),
    ).rejects.toThrow();
  });

  // The two tests above never reach the CLI: 'Bad Name' fails ID_RE and 'ford'
  // fails the taken-check, both inside validateProfileId — which is itself a
  // real §4.9 property worth proving (rejection without touching disk). But
  // it leaves the try/catch around the subprocess call, and the mock's exit-1
  // and exit-2 branches, with no coverage. These two drive the subprocess
  // itself to fail, exercising both the stderr-present branch and the
  // stderr-absent (ENOENT) fallback in create.ts.

  it('surfaces the OS-level spawn error when the hermes binary cannot be found', async () => {
    const before = hashTree(home);
    await expect(
      createProfile({
        hermesBin: join(home, 'no-such-hermes-binary'),
        hermesHome: home,
        id: 'nonexistent-bin',
        heading: { name: 'X', tagline: null },
        env: { MOCK_HERMES_HOME: home },
      }),
    ).rejects.toThrow(/create the profile "nonexistent-bin"/);
    expect(hashTree(home)).toEqual(before);
  });

  it("surfaces the CLI's own duplicate-profile error when it disagrees with our pre-check", async () => {
    // validateProfileId only knows about `hermesHome`, which has no `athena`.
    // Point the subprocess at a different MOCK_HERMES_HOME that already has
    // one, so our own check passes but the CLI itself exits 1 — proving the
    // try/catch around `run(...)` actually surfaces what the CLI says.
    const other = mkdtempSync(join(tmpdir(), 'circe-create-other-'));
    mkdirSync(join(other, 'profiles', 'athena'), { recursive: true });
    const before = hashTree(home);
    try {
      await expect(
        createProfile({
          hermesBin: MOCK_BIN,
          hermesHome: home,
          id: 'athena',
          heading: { name: 'Athena', tagline: null },
          env: { MOCK_HERMES_HOME: other },
        }),
      ).rejects.toThrow(/profile already exists: athena/);
      expect(hashTree(home)).toEqual(before);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  // Reaching the mock's exit-2 (invalid name) branch through createProfile's
  // public API is not possible: ID_RE in create.ts is byte-for-byte the same
  // pattern the mock CLI validates against
  // (`/^[a-z0-9][a-z0-9_-]*$/`), so any id that clears our own
  // validateProfileId also clears the CLI's. There's no id that reaches
  // `run(...)` and still trips the CLI's own validation.

  it('leaves the scaffold default untouched — never adopts it (decision 2)', async () => {
    await createProfile({
      hermesBin: MOCK_BIN,
      hermesHome: home,
      id: 'athena',
      heading: { name: 'Athena', tagline: null },
      env: { MOCK_HERMES_HOME: home },
    });
    expect(readFileSync(join(home, 'SOUL.md'), 'utf8')).toBe(SCAFFOLD);
    const def = (await enumerateProfiles(home)).find((p) => p.id === 'default')!;
    expect(def.real).toBe(false);
  });
});
