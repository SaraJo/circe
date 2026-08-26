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
    // Application icon concepts, not character likenesses.
    const allowlist = [
      'resources/icon.png',
      'resources/icon-v2.png',
      'resources/icon-v3.png',
      'resources/icon-v4.png',
    ];

    const images = tracked.filter((file) => /\.(png|jpe?g|gif|webp)$/i.test(file));
    const offenders = images.filter((file) => !allowlist.includes(file));

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

  // The second source, added once Wikipedia was measured at 7 of 12 and shown
  // not to carry the rest. Constraint 4 now permits two more destinations, and
  // this states exactly which: any Fandom wiki, because the wiki is named per
  // character and cannot be enumerated here, and the single host every Fandom
  // wiki serves its images from.
  it('names only fandom wikis and their image host in the second source', async () => {
    const src = await readFile(join(ROOT, 'src/main/fandom.ts'), 'utf8');
    const hosts = [...src.matchAll(/\b(?:[a-z0-9-]+\.)+(?:org|com|net|io)\b/g)].map((m) => m[0]);
    const strays = [...new Set(hosts)].filter(
      (h) => h !== 'static.wikia.nocookie.net' && !/^[a-z0-9-]+\.fandom\.com$/.test(h),
    );
    expect(strays).toEqual([]);
  });

  // The wiki host is the one value in a model's reply that chooses where Circe
  // connects to. The validator that bounds it is the whole defence, so its
  // anchors are pinned here rather than left to be loosened by a later edit
  // that only means to be permissive.
  it('bounds the model-supplied wiki host at both ends', async () => {
    for (const file of ['src/main/derive.ts', 'src/main/fandom.ts']) {
      const src = await readFile(join(ROOT, file), 'utf8');
      expect(src, file).toMatch(/\/\^\[a-z0-9-\]\+\\\.fandom\\\.com\$\//);
    }
  });
});
