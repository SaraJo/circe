import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RealHermes } from '../src/main/hermes/real';

/**
 * These touch the filesystem, but only inside a throwaway temp directory
 * pointed at by `HERMES_HOME` — the `hermes` binary is never run and the
 * user's real Hermes home is never opened.
 *
 * What's under test is the distinction the non-destruction constraint rests
 * on: `null` from a read means the file is *absent*, and nothing else. When
 * every error collapsed to `null`, an unreadable-but-present `SOUL.md` looked
 * like a fresh scaffold — so no backup was taken and no confirm was shown,
 * and the persona was overwritten with nothing kept.
 */
describe('RealHermes.readHomeFile', () => {
  let home: string;
  let hermes: RealHermes;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'circe-read-'));
    hermes = new RealHermes({ HERMES_HOME: home });
  });

  afterEach(async () => {
    // Restore any mode we cleared, or the cleanup can't recurse.
    await chmod(join(home, 'SOUL.md'), 0o600).catch(() => {});
    await rm(home, { recursive: true, force: true });
  });

  it('returns the contents of a file that is there', async () => {
    await writeFile(join(home, 'SOUL.md'), '# Trillian — coordinator\n');
    expect(await hermes.readHomeFile('SOUL.md')).toBe('# Trillian — coordinator\n');
  });

  it('returns null for a file that is genuinely absent', async () => {
    expect(await hermes.readHomeFile('SOUL.md')).toBeNull();
  });

  it('returns null when a parent path component is not a directory (ENOTDIR)', async () => {
    // `profiles` is a file, so `profiles/ford/SOUL.md` cannot exist.
    await writeFile(join(home, 'profiles'), 'not a directory');
    expect(await hermes.readHomeFile('profiles/ford/SOUL.md')).toBeNull();
  });

  it('raises rather than reporting absent when the path is a directory (EISDIR)', async () => {
    await mkdir(join(home, 'SOUL.md'));
    await expect(hermes.readHomeFile('SOUL.md')).rejects.toThrow(/Cannot read .*SOUL\.md/);
  });

  it('raises rather than reporting absent when the file is unreadable (EACCES)', async () => {
    // Root bypasses the permission bits entirely, so there is no EACCES to
    // provoke; the EISDIR case above still covers the branch there.
    if (typeof process.getuid === 'function' && process.getuid() === 0) return;
    const path = join(home, 'SOUL.md');
    await writeFile(path, '# A hand-written persona\n');
    await chmod(path, 0o000);

    await expect(hermes.readHomeFile('SOUL.md')).rejects.toThrow(/EACCES/);
  });
});
