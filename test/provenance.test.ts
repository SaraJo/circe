import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');

/**
 * §10.7, the avatar provenance invariant. These do not test behaviour; they
 * pin the three properties that make the Wikipedia lookup defensible at all,
 * each of which is one careless commit away from being untrue.
 */
describe('avatar provenance (spec §10.7)', () => {
  // The repo ships no likenesses. Every face is fetched for one user, on their
  // machine, or drawn locally from initials. Downloaded avatars live in the
  // user's scratch directory and are never committed.
  it('bundles no character images', () => {
    // Ask git what is tracked, not what happens to be on this developer's disk.
    // This prevents gitignored scratch, build output, and screenshots from
    // creating spurious test failures or requiring an ever-growing exclusion list.
    const ls = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' });
    const tracked = ls.split('\n').filter((line) => line.length > 0);

    // Image files in the repo. allowlist is explicit with comments on why.
    const allowlist = ['resources/icon.png']; // application icon, not character likeness

    const images = tracked.filter((file) => /\.(png|jpe?g|gif|webp)$/i.test(file));
    const offenders = images.filter(
      (file) => !allowlist.includes(file) || /avatar|character|face/i.test(file),
    );

    expect(offenders).toEqual([]);
  });

  // The renderers may load their own files and data URLs, and nothing else.
  // This is the test that should stop a future avatar path that needs a remote
  // load in the renderer.
  it.each(['wizard', 'tile'])('keeps %s CSP refusing remote images', async (which) => {
    const html = await readFile(join(ROOT, 'src/renderer', which, 'index.html'), 'utf8');
    expect(html).toContain(
      "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:",
    );
    expect(html).not.toMatch(/img-src[^"]*https?:/);
  });

  // Constraint 6 names two hosts. A third would be a new outbound destination
  // in an app whose constraint 4 permits almost none.
  it('names only the two Wikimedia hosts in the lookup', async () => {
    const src = await readFile(join(ROOT, 'src/main/avatar.ts'), 'utf8');
    // Matches hostnames wherever they appear, not only inside a URL: the image
    // host is a bare constant (`upload.wikimedia.org`) because it is compared
    // against `URL.hostname`, so a `https?://` pattern would silently miss it
    // and this test would fail against perfectly correct code.
    const hosts = [...src.matchAll(/\b(?:[a-z0-9-]+\.)+(?:org|com|net|io)\b/g)].map((m) => m[0]);
    expect([...new Set(hosts)].sort()).toEqual(['en.wikipedia.org', 'upload.wikimedia.org']);
  });
});
