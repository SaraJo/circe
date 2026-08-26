> **Historical plan:** Do not execute unchecked tasks from this document. See
> [../../CURRENT_BUILD.md](../../CURRENT_BUILD.md) for the current scope.

# Avatar Sourcing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A character derived from a fandom gets that character's face from Wikipedia, written into the profile it belongs to, with initials whenever the lookup finds nothing trustworthy.

**Architecture:** A main-process-only module fetches a Wikipedia summary by character name and applies four guardrails before trusting it. The bytes are held in memory through the meet screen and written to `avatar.png` inside the profile only when the user accepts, because constraint 9 forbids touching a profile the user has not committed to. Both renderers receive the image as a `data:` URL over IPC, never a remote load. Initials stay the fallback element, so every failure path renders exactly today's screen.

**Tech Stack:** TypeScript, Electron 32, electron-vite, Vitest. No new dependencies — JPEG-to-PNG conversion uses Electron's built-in `nativeImage`, injected so tests never load Electron.

**Spec:** `docs/superpowers/specs/2026-08-19-avatar-sourcing-design.md`, which implements `~/Code/circe-oss-spec.md` constraint 4, constraint 6 (§4.6), constraint 9, constraint 10, §6.2 Step 5, §6.3, §8.4, §9 Phase 2, §10.7.

## Global Constraints

Copied from the spec. Every task's requirements implicitly include these.

- **Two hosts, and only two.** `en.wikipedia.org` for the REST summary, `upload.wikimedia.org` for the thumbnail. No other host is ever contacted.
- **The renderer never loads a remote image.** The main process fetches; the renderer sees local bytes or a `data:` URL. The CSP must keep refusing remote images.
- **The repo bundles zero character images.** Nothing is committed under any avatars or characters directory.
- **A profile describes itself (constraint 10).** The face lives at `avatar.png` inside the profile. Circe keeps no private avatar directory and stores no avatar path in its own state.
- **Constraint 9: no write without acceptance.** Nothing reaches disk for a character the user has not accepted, including after "Try someone else".
- **Failure is silent (§10.7).** Every failure yields an initials avatar and no user-visible error. Nothing here may fail an onboarding.
- **No em dashes in copy Circe writes.** Any user-facing string added by this plan follows the rule held by `wizard.test.ts`.
- **macOS only (constraint 1).** No platform abstractions "for later".

## File Structure

| File | Responsibility |
|---|---|
| `src/main/hermes/runtime.ts` | Modify: `readHomeFileBytes` / `writeHomeFileBytes` on the interface; `avatarPath` helper |
| `src/main/hermes/real.ts` | Modify: real binary file I/O |
| `test/fake/hermes.ts` | Modify: in-memory binary file I/O |
| `src/main/avatarStore.ts` | Create: save an avatar into a profile, read one back as a `data:` URL |
| `src/main/avatar.ts` | Create: the Wikipedia lookup and its four guardrails |
| `src/main/wizard.ts` | Modify: fire the lookup on derivation, hold bytes, write on accept |
| `src/main/index.ts` | Modify: wire real `fetch` and `nativeImage` into the injected seams |
| `src/renderer/wizard/{index.html,main.ts,wizard.css}` | Modify: CSP, meet-screen face |
| `src/renderer/tile/{index.html,main.ts,tile.css}` | Modify: CSP, tile-header face |
| `src/renderer/face.ts` | Create: `initials` and `applyFace`, shared by both renderers |
| `src/preload/{wizard.ts,tile.ts}` | Modify: one avatar channel each |
| `test/avatar.test.ts` | Create: guardrails, provenance, failure modes |
| `test/avatarStore.test.ts` | Create: storage paths, conversion, data URL |
| `test/provenance.test.ts` | Create: the §10.7 invariants |

---

### Task 1: Binary file I/O and the avatar store

**Files:**
- Modify: `src/main/hermes/runtime.ts`
- Modify: `src/main/hermes/real.ts:136-144`
- Modify: `test/fake/hermes.ts:99-104`
- Create: `src/main/avatarStore.ts`
- Test: `test/avatarStore.test.ts`

**Interfaces:**
- Consumes: `profileFilePath(profileId, file)` from `runtime.ts`, which already maps the `default` profile to the home root.
- Produces:
  - `avatarPath(profileId: string): string`
  - `HermesRuntime.readHomeFileBytes(relPath: string): Promise<Uint8Array | null>`
  - `HermesRuntime.writeHomeFileBytes(relPath: string, bytes: Uint8Array): Promise<void>`
  - `type ToPng = (bytes: Uint8Array, contentType: string) => Uint8Array | null`
  - `saveAvatar(hermes: HermesRuntime, profileId: string, bytes: Uint8Array, contentType: string, toPng: ToPng): Promise<boolean>`
  - `readAvatarDataUrl(hermes: HermesRuntime, profileId: string): Promise<string | null>`
  - `dataUrl(bytes: Uint8Array, contentType: string): string`

- [ ] **Step 1: Write the failing tests**

Create `test/avatarStore.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { FakeHermes, INSTALLED_EMPTY } from './fake/hermes';
import { avatarPath, dataUrl, readAvatarDataUrl, saveAvatar } from '../src/main/avatarStore';

/** A PNG is identified by its 8-byte signature; these tests never need a real image. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9]);

/** Stands in for Electron's nativeImage: marks the bytes so the test can see conversion ran. */
const toPng = (bytes: Uint8Array, contentType: string): Uint8Array | null =>
  contentType === 'image/png' ? bytes : new Uint8Array([...PNG.slice(0, 8), ...bytes]);

describe('avatarPath', () => {
  // The coordinator IS the default profile, and the default profile keeps its
  // files at the home root — the same rule `soulPath` and `circe.json` follow.
  // Getting this wrong writes the face to `profiles/default/`, a directory
  // Hermes does not use, and the tile would show initials forever.
  it('puts the default profile face at the home root', () => {
    expect(avatarPath('default')).toBe('avatar.png');
  });

  it('puts a specialist face inside its own profile directory', () => {
    expect(avatarPath('killick')).toBe('profiles/killick/avatar.png');
  });
});

describe('saveAvatar', () => {
  it('writes the bytes into the profile', async () => {
    const h = new FakeHermes(INSTALLED_EMPTY);
    const ok = await saveAvatar(h, 'default', PNG, 'image/png', toPng);
    expect(ok).toBe(true);
    expect(await h.readHomeFileBytes('avatar.png')).toEqual(PNG);
  });

  // The spec fixes the filename as avatar.png, and Wikipedia thumbnails are
  // mostly JPEG, so something has to convert. A .jpg written under a .png name
  // is the kind of thing that works until something reads the extension.
  it('converts a non-PNG before writing', async () => {
    const h = new FakeHermes(INSTALLED_EMPTY);
    await saveAvatar(h, 'default', JPEG, 'image/jpeg', toPng);
    const written = await h.readHomeFileBytes('avatar.png');
    expect(written!.slice(0, 8)).toEqual(PNG.slice(0, 8));
  });

  // Failure is silent (§10.7): a face that cannot be converted is not an error,
  // it is a profile with no face, which renders initials.
  it('writes nothing and reports failure when conversion fails', async () => {
    const h = new FakeHermes(INSTALLED_EMPTY);
    const ok = await saveAvatar(h, 'default', JPEG, 'image/jpeg', () => null);
    expect(ok).toBe(false);
    expect(await h.readHomeFileBytes('avatar.png')).toBeNull();
  });
});

describe('readAvatarDataUrl', () => {
  it('reads a stored face back as a data URL the renderer can use', async () => {
    const h = new FakeHermes(INSTALLED_EMPTY);
    await saveAvatar(h, 'default', PNG, 'image/png', toPng);
    const url = await readAvatarDataUrl(h, 'default');
    expect(url).toMatch(/^data:image\/png;base64,/);
  });

  // The ordinary case for most profiles, and the reason nothing downstream may
  // treat null as an error.
  it('is null when the profile has no face', async () => {
    expect(await readAvatarDataUrl(new FakeHermes(INSTALLED_EMPTY), 'default')).toBeNull();
  });
});

describe('dataUrl', () => {
  it('encodes bytes with their type', () => {
    expect(dataUrl(new Uint8Array([1, 2, 3]), 'image/png')).toBe('data:image/png;base64,AQID');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/avatarStore.test.ts`
Expected: FAIL — `Failed to load url ../src/main/avatarStore`.

- [ ] **Step 3: Add binary I/O to the runtime interface**

In `src/main/hermes/runtime.ts`, add to `interface HermesRuntime`, directly below `writeHomeFile`:

```typescript
  /**
   * Read a file under the Hermes home as bytes. Null means absent, matching
   * `readHomeFile`'s contract exactly: a file that exists but cannot be read
   * rejects, so a caller can tell "nothing there" from "couldn't look".
   *
   * Separate from `readHomeFile` rather than replacing it because an avatar is
   * the only binary thing Circe touches, and forcing every persona read through
   * a Buffer would make the common case worse to serve the rare one.
   */
  readHomeFileBytes(relPath: string): Promise<Uint8Array | null>;
  /** Write bytes under the Hermes home, creating parent directories. */
  writeHomeFileBytes(relPath: string, bytes: Uint8Array): Promise<void>;
```

And export the path helper, beside `profileFilePath`:

```typescript
/**
 * A profile's face. Constraint 6 fixes the filename and constraint 10 fixes the
 * location: the face is an agent fact, so it lives with the agent, and the
 * default profile keeps its files at the home root exactly as `SOUL.md` does.
 * A user or an agent that drops an `avatar.png` here gets a face with no
 * involvement from Circe at all.
 */
export function avatarPath(profileId: string): string {
  return profileFilePath(profileId, 'avatar.png');
}
```

- [ ] **Step 4: Implement binary I/O in the real runtime**

In `src/main/hermes/real.ts`, directly after `writeHomeFile`:

```typescript
  async readHomeFileBytes(relPath: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(join(this.p.home, relPath)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async writeHomeFileBytes(relPath: string, bytes: Uint8Array): Promise<void> {
    const abs = join(this.p.home, relPath);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, bytes);
  }
```

Confirm `readFile` is in the `node:fs/promises` import at the top of the file; add it if not.

- [ ] **Step 5: Implement binary I/O in the fake**

In `test/fake/hermes.ts`, add a second map beside `files` and the two methods:

```typescript
  /** Binary files, kept apart from `files` so a text read of a PNG cannot half-work. */
  readonly bytes = new Map<string, Uint8Array>();

  async readHomeFileBytes(relPath: string): Promise<Uint8Array | null> {
    return this.bytes.get(relPath) ?? null;
  }

  async writeHomeFileBytes(relPath: string, bytes: Uint8Array): Promise<void> {
    this.bytes.set(relPath, bytes);
  }
```

- [ ] **Step 6: Implement the avatar store**

Create `src/main/avatarStore.ts`:

```typescript
import { avatarPath, type HermesRuntime } from './hermes/runtime';

/**
 * Converts fetched image bytes to PNG. Injected rather than imported because
 * the only implementation is Electron's `nativeImage`, and importing `electron`
 * here would make this module unloadable under the `node` test environment —
 * the same reason `tiles.ts` takes `createWindow` as a dependency.
 *
 * Returns null when the bytes are not an image it can read, which is a silent
 * failure like every other one in this feature.
 */
export type ToPng = (bytes: Uint8Array, contentType: string) => Uint8Array | null;

/** `data:` URL for bytes, which is the only form the renderers accept (§10.7). */
export function dataUrl(bytes: Uint8Array, contentType: string): string {
  return `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`;
}

/**
 * Writes a face into its profile. Returns whether anything was written, so the
 * caller can carry on either way: a profile with no face is a working profile.
 */
export async function saveAvatar(
  hermes: HermesRuntime,
  profileId: string,
  bytes: Uint8Array,
  contentType: string,
  toPng: ToPng,
): Promise<boolean> {
  const png = contentType === 'image/png' ? bytes : toPng(bytes, contentType);
  if (!png || png.length === 0) return false;
  await hermes.writeHomeFileBytes(avatarPath(profileId), png);
  return true;
}

/** A profile's face for the renderer, or null when it has none. */
export async function readAvatarDataUrl(
  hermes: HermesRuntime,
  profileId: string,
): Promise<string | null> {
  const bytes = await hermes.readHomeFileBytes(avatarPath(profileId));
  return bytes && bytes.length > 0 ? dataUrl(bytes, 'image/png') : null;
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -- test/avatarStore.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 8: Full suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all green. Any other implementer of `HermesRuntime` will fail the typecheck here; add the two methods to it.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: the runtime can read and write bytes, and a profile can hold a face"
```

---

### Task 2: The Wikipedia lookup and its guardrails

**Files:**
- Create: `src/main/avatar.ts`
- Test: `test/avatar.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1. This module is deliberately standalone and does no I/O beyond the two fetches it is given.
- Produces:
  - `type AvatarLicense = 'commons' | 'non-free'`
  - `interface AvatarFind { bytes: Uint8Array; contentType: string; articleUrl: string; title: string; license: AvatarLicense }`
  - `interface AvatarDeps { fetchJson(url: string): Promise<unknown>; fetchImage(url: string): Promise<{ bytes: Uint8Array; contentType: string }> }`
  - `findAvatar(name: string, fandom: string, deps: AvatarDeps): Promise<AvatarFind | null>`
  - `fandomTokens(fandom: string): string[]`
  - `mentionsFandom(extract: string, fandom: string): boolean`
  - `licenseOf(thumbnailUrl: string): AvatarLicense | null`

- [ ] **Step 1: Write the failing tests**

Create `test/avatar.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  fandomTokens,
  findAvatar,
  licenseOf,
  mentionsFandom,
  type AvatarDeps,
} from '../src/main/avatar';

const IMG = { bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' };

/** A summary shaped exactly like the live endpoint's, with the fields the rules read. */
function summary(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'standard',
    title: 'Long John Silver',
    extract: 'Long John Silver is a fictional character in the novel Treasure Island.',
    thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/commons/a/b/Silver.jpg' },
    content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Long_John_Silver' } },
    ...over,
  };
}

function deps(over: Partial<AvatarDeps> = {}): AvatarDeps {
  return {
    fetchJson: async () => summary(),
    fetchImage: async () => IMG,
    ...over,
  };
}

describe('fandomTokens', () => {
  // "Mentions the fandom" has to mean one thing, or it becomes three
  // implementations. Words of three characters or fewer go, which removes
  // "the", "of", "a" and most noise without a stop-word list to maintain.
  it('keeps the significant words and drops the short ones', () => {
    expect(fandomTokens("Hitchhiker's Guide to the Galaxy")).toEqual([
      'hitchhiker',
      'guide',
      'galaxy',
    ]);
    expect(fandomTokens('the Wire')).toEqual(['wire']);
  });

  it('is empty when nothing significant survives', () => {
    expect(fandomTokens('up')).toEqual([]);
  });
});

describe('mentionsFandom', () => {
  it('matches on any significant word, case-insensitively', () => {
    expect(mentionsFandom('a novel by Douglas Adams, The Galaxy series', 'the Galaxy')).toBe(true);
  });

  // Fails closed. A fandom we cannot check is not a fandom we may assume.
  it('is false when the fandom reduces to nothing checkable', () => {
    expect(mentionsFandom('anything at all', 'up')).toBe(false);
  });

  it('is false when no significant word appears', () => {
    expect(mentionsFandom('an instant messaging client for Windows', "Hitchhiker's Guide")).toBe(
      false,
    );
  });
});

describe('licenseOf', () => {
  // The summary response carries no license field. The path segment does:
  // /wikipedia/commons/ is freely licensed, /wikipedia/en/ is uploaded under
  // English Wikipedia's non-free content criteria. Measured 2026-08-19, seven
  // of nine usable thumbnails were non-free, so this is the common case.
  it('reads Commons and non-free apart by their URL path', () => {
    expect(licenseOf('https://upload.wikimedia.org/wikipedia/commons/a/b/X.jpg')).toBe('commons');
    expect(licenseOf('https://upload.wikimedia.org/wikipedia/en/d/d3/X.jpg')).toBe('non-free');
  });

  it('is null for a host or path we do not recognise', () => {
    expect(licenseOf('https://example.com/x.jpg')).toBeNull();
    expect(licenseOf('https://upload.wikimedia.org/other/x.jpg')).toBeNull();
  });
});

describe('findAvatar', () => {
  it('returns the image, the article and the licence for a clean match', async () => {
    const found = await findAvatar('Long John Silver', 'pirates and Treasure Island', deps());
    expect(found).not.toBeNull();
    expect(found!.bytes).toEqual(IMG.bytes);
    expect(found!.license).toBe('commons');
    expect(found!.articleUrl).toBe('https://en.wikipedia.org/wiki/Long_John_Silver');
  });

  // "Cher Horowitz" resolves to "List of Clueless characters". If such a list
  // article had a thumbnail it would be a group shot or a logo, presented as
  // the user's agent.
  it('refuses a redirect to a list article', async () => {
    const fetchJson = async () => summary({ title: 'List of Clueless characters' });
    expect(await findAvatar('Cher Horowitz', 'Clueless', deps({ fetchJson }))).toBeNull();
  });

  it('refuses a disambiguation page', async () => {
    const fetchJson = async () => summary({ type: 'disambiguation' });
    expect(await findAvatar('Trillian', "Hitchhiker's Guide", deps({ fetchJson }))).toBeNull();
  });

  it('refuses an article with no thumbnail', async () => {
    const fetchJson = async () => summary({ thumbnail: undefined });
    expect(await findAvatar('Samwise Gamgee', 'Lord of the Rings', deps({ fetchJson }))).toBeNull();
  });

  /**
   * The failure that matters most, and the one the sample got lucky on.
   * "Trillian" landed on a disambiguation page, but had Wikipedia sent it to
   * the instant-messaging client, this is the shape that would have arrived: a
   * standard article, a real thumbnail, and an extract about entirely the wrong
   * subject. A wrong face is worse than no face.
   */
  it('refuses a standard article about the wrong subject', async () => {
    const fetchJson = async () =>
      summary({
        title: 'Trillian (software)',
        extract: 'Trillian is a proprietary multiprotocol instant messaging application.',
      });
    expect(await findAvatar('Trillian', "Hitchhiker's Guide", deps({ fetchJson }))).toBeNull();
  });

  // Redirects are not suspect in themselves, so rule 4 must not reject the
  // ones we want. "Captain Picard" resolves to "Jean-Luc Picard".
  it('accepts a redirect to the same subject under another name', async () => {
    const fetchJson = async () =>
      summary({
        title: 'Jean-Luc Picard',
        extract: 'Jean-Luc Picard is a character in Star Trek: The Next Generation.',
        thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/en/1/2/Picard.jpg' },
      });
    const found = await findAvatar('Captain Picard', 'Star Trek', deps({ fetchJson }));
    expect(found).not.toBeNull();
    expect(found!.license).toBe('non-free');
  });

  it('refuses a thumbnail served from any other host', async () => {
    const fetchJson = async () =>
      summary({ thumbnail: { source: 'https://evil.example.com/x.jpg' } });
    expect(await findAvatar('X', 'Treasure Island', deps({ fetchJson }))).toBeNull();
  });

  // Nothing in this feature may fail an onboarding, so every one of these is
  // the same outcome as "Wikipedia had nothing".
  it('never throws, whatever goes wrong', async () => {
    const boom = async () => {
      throw new Error('network down');
    };
    expect(await findAvatar('X', 'Treasure Island', deps({ fetchJson: boom }))).toBeNull();
    expect(await findAvatar('X', 'Treasure Island', deps({ fetchImage: boom }))).toBeNull();
    expect(
      await findAvatar('X', 'Treasure Island', deps({ fetchJson: async () => 'not json' })),
    ).toBeNull();
  });

  it('refuses an empty image body', async () => {
    const fetchImage = async () => ({ bytes: new Uint8Array(), contentType: 'image/jpeg' });
    expect(await findAvatar('X', 'Treasure Island', deps({ fetchImage }))).toBeNull();
  });

  it('refuses an image that is too large to be a thumbnail', async () => {
    const fetchImage = async () => ({
      bytes: new Uint8Array(3_000_001),
      contentType: 'image/jpeg',
    });
    expect(await findAvatar('X', 'Treasure Island', deps({ fetchImage }))).toBeNull();
  });

  it('asks the summary endpoint for the name it was given', async () => {
    const seen: string[] = [];
    const fetchJson = async (url: string) => {
      seen.push(url);
      return summary();
    };
    await findAvatar('Long John Silver', 'Treasure Island', deps({ fetchJson }));
    expect(seen[0]).toBe(
      'https://en.wikipedia.org/api/rest_v1/page/summary/Long_John_Silver',
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/avatar.test.ts`
Expected: FAIL — `Failed to load url ../src/main/avatar`.

- [ ] **Step 3: Implement the lookup**

Create `src/main/avatar.ts`:

```typescript
/**
 * The Wikipedia avatar lookup (constraint 6, §10.7). Main process only: the
 * renderer never loads a remote image, so the fetching happens here and the
 * bytes reach the renderer as a local `data:` URL.
 *
 * ## Why this is guarded rather than trusting
 *
 * Measured against the live endpoint on 2026-08-19, nine of thirteen character
 * lookups returned a thumbnail, and the misses fell into three kinds with clean
 * signals: a redirect to a "List of ... characters" article, a disambiguation
 * page, and an article with no free image. A fourth kind did not appear in the
 * sample and is the dangerous one — a name that resolves cleanly to an entirely
 * different subject, like "Trillian" the instant-messaging client. That is the
 * case rule 4 exists for.
 *
 * **A wrong face is worse than no face.** Initials are honest; a stranger's
 * photograph presented as the user's coordinator is not. Every rule is tuned to
 * that asymmetry, and every failure is silent.
 */

const SUMMARY = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
const IMAGE_HOST = 'upload.wikimedia.org';
/** A thumbnail is a thumbnail. Anything larger is not what we asked for. */
const MAX_BYTES = 3_000_000;

export type AvatarLicense = 'commons' | 'non-free';

export interface AvatarFind {
  bytes: Uint8Array;
  contentType: string;
  /** The article the face came from, kept so attribution stays possible. */
  articleUrl: string;
  title: string;
  license: AvatarLicense;
}

export interface AvatarDeps {
  fetchJson(url: string): Promise<unknown>;
  fetchImage(url: string): Promise<{ bytes: Uint8Array; contentType: string }>;
}

/**
 * The significant words of a fandom. Three characters or fewer are dropped,
 * which removes "the", "of", "a" and most noise without a stop-word list that
 * would need maintaining.
 */
export function fandomTokens(fandom: string): string[] {
  return fandom
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 3);
}

/**
 * Rule 4. Fails closed: a fandom that reduces to no significant words cannot be
 * checked, and an unverifiable match is not a match.
 */
export function mentionsFandom(extract: string, fandom: string): boolean {
  const tokens = fandomTokens(fandom);
  if (tokens.length === 0) return false;
  const haystack = extract.toLowerCase();
  return tokens.some((t) => haystack.includes(t));
}

/**
 * Licensing, read from the URL path because the summary response carries no
 * license field at all. `/wikipedia/commons/` is Wikimedia Commons and freely
 * licensed; `/wikipedia/en/` is uploaded under English Wikipedia's non-free
 * content criteria, which permit use *on Wikipedia* and say nothing about
 * redistribution. Recorded rather than acted on: the redistribution policy is
 * an open question for public v1, and this is the data it will be decided with.
 */
export function licenseOf(thumbnailUrl: string): AvatarLicense | null {
  let url: URL;
  try {
    url = new URL(thumbnailUrl);
  } catch {
    return null;
  }
  if (url.hostname !== IMAGE_HOST) return null;
  if (url.pathname.startsWith('/wikipedia/commons/')) return 'commons';
  if (url.pathname.startsWith('/wikipedia/en/')) return 'non-free';
  return null;
}

export async function findAvatar(
  name: string,
  fandom: string,
  deps: AvatarDeps,
): Promise<AvatarFind | null> {
  try {
    const raw = await deps.fetchJson(SUMMARY + encodeURIComponent(name.replace(/ /g, '_')));
    if (typeof raw !== 'object' || raw === null) return null;
    const s = raw as Record<string, unknown>;

    // Rule 1: standard articles only.
    if (s.type !== 'standard') return null;

    // Rule 2: not a character-list redirect.
    const title = typeof s.title === 'string' ? s.title : '';
    if (!title || /^List of /i.test(title)) return null;

    // Rule 3: a thumbnail, from the one host allowed to serve them.
    const source = ((s.thumbnail ?? {}) as Record<string, unknown>).source;
    if (typeof source !== 'string') return null;
    const license = licenseOf(source);
    if (!license) return null;

    // Rule 4: the article is about the world the user named.
    const extract = typeof s.extract === 'string' ? s.extract : '';
    if (!mentionsFandom(extract, fandom)) return null;

    const { bytes, contentType } = await deps.fetchImage(source);
    if (bytes.length === 0 || bytes.length > MAX_BYTES) return null;
    if (!contentType.startsWith('image/')) return null;

    const desktop = ((s.content_urls ?? {}) as Record<string, unknown>).desktop;
    const page = ((desktop ?? {}) as Record<string, unknown>).page;

    return {
      bytes,
      contentType,
      articleUrl: typeof page === 'string' ? page : '',
      title,
      license,
    };
  } catch {
    // Every failure is the same failure: no face. §10.7 requires it be silent
    // and indistinguishable from Wikipedia simply having nothing.
    return null;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/avatar.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: a guarded Wikipedia lookup for a character's face"
```

---

### Task 3: The wizard fires the lookup and writes on accept

**Files:**
- Modify: `src/main/wizard.ts`
- Test: `test/wizard.test.ts` (add a describe block)

**Interfaces:**
- Consumes: `findAvatar`, `AvatarFind`, `AvatarDeps` (Task 2); `saveAvatar`, `ToPng` (Task 1).
- Produces: `Wizard` accepts an optional fourth construction dependency, `avatar?: { deps: AvatarDeps; toPng: ToPng }`. Omitted, the wizard behaves exactly as it does today and never looks anything up. `Wizard.avatarDataUrl(): string | null` gives the renderer the pending face.

- [ ] **Step 1: Write the failing tests**

Add to `test/wizard.test.ts`:

```typescript
describe('the character gets a face', () => {
  // `scenario()` and `INSTALLED_EMPTY` are already imported at the top of this
  // file, and `scenario()` supplies the derivation reply. Without it the wizard
  // never reaches `meet` and every test here fails on the wrong thing.
  // `toMeet()` cannot be reused: it builds a `Wizard` with no avatar options,
  // which is the one case these tests are not about.
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]);
  const found = {
    bytes: PNG,
    contentType: 'image/png',
    articleUrl: 'https://en.wikipedia.org/wiki/Trillian',
    title: 'Trillian',
    license: 'commons' as const,
  };
  const avatar = () => ({
    deps: { fetchJson: async () => ({}), fetchImage: async () => ({ bytes: PNG, contentType: 'image/png' }) },
    toPng: (b: Uint8Array) => b,
  });

  /**
   * Constraint 9, and the reason the lookup and the write are separate moments:
   * the user is still deciding on the meet screen, and "Try someone else" must
   * leave nothing behind. A face on disk for a character nobody accepted is a
   * write to a profile the user never asked Circe to touch.
   */
  it('writes no face before the user accepts', async () => {
    const h = new FakeHermes(scenario(INSTALLED_EMPTY));
    const w = new Wizard(h, { ...avatar(), find: async () => found });
    await w.start();
    await w.submitFandom("Hitchhiker's");
    expect(w.state.kind).toBe('meet');
    expect(h.bytes.size).toBe(0);
  });

  it('offers the pending face to the renderer while the user decides', async () => {
    const h = new FakeHermes(scenario(INSTALLED_EMPTY));
    const w = new Wizard(h, { ...avatar(), find: async () => found });
    await w.start();
    await w.submitFandom("Hitchhiker's");
    expect(w.avatarDataUrl()).toMatch(/^data:image\/png;base64,/);
  });

  it('writes the face into the profile on accept', async () => {
    const h = new FakeHermes(scenario(INSTALLED_EMPTY));
    const w = new Wizard(h, { ...avatar(), find: async () => found });
    await w.start();
    await w.submitFandom("Hitchhiker's");
    await w.accept();
    expect(await h.readHomeFileBytes('avatar.png')).toEqual(PNG);
  });

  it('discards the face when the user asks for a different character', async () => {
    const h = new FakeHermes(scenario(INSTALLED_EMPTY));
    let hits = 0;
    const w = new Wizard(h, {
      ...avatar(),
      find: async () => (hits++ === 0 ? found : null),
    });
    await w.start();
    await w.submitFandom("Hitchhiker's");
    await w.retryDerivation();
    expect(w.avatarDataUrl()).toBeNull();
    expect(h.bytes.size).toBe(0);
  });

  // A lookup is slower than the derivation that triggered it can be replaced.
  // The generation guard the derivation already uses covers this too, or a face
  // from a discarded character attaches to the one on screen.
  it('drops a face whose character was already replaced', async () => {
    const h = new FakeHermes(scenario(INSTALLED_EMPTY));
    let release: (v: typeof found) => void = () => {};
    // Only the FIRST lookup is deferred. An earlier draft gave every call the
    // same deferred promise, so the retry's own lookup reassigned `release` and
    // resolving it fed a face to the *current* generation — the test would have
    // failed for a reason unrelated to staleness.
    let calls = 0;
    const w = new Wizard(h, {
      ...avatar(),
      find: () => (calls++ === 0 ? new Promise((r) => (release = r)) : Promise.resolve(null)),
    });
    await w.start();
    await w.submitFandom("Hitchhiker's");
    await w.retryDerivation();
    release(found);
    await new Promise((r) => setTimeout(r, 0));
    expect(w.avatarDataUrl()).toBeNull();
  });

  // Every failure is silent, and onboarding must complete regardless.
  it('completes onboarding when the lookup finds nothing', async () => {
    const h = new FakeHermes(scenario(INSTALLED_EMPTY));
    const w = new Wizard(h, { ...avatar(), find: async () => null });
    await w.start();
    await w.submitFandom("Hitchhiker's");
    await w.accept();
    expect(w.state.kind).toBe('launching');
    expect(h.bytes.size).toBe(0);
  });

  it('completes onboarding when the lookup throws', async () => {
    const h = new FakeHermes(scenario(INSTALLED_EMPTY));
    const w = new Wizard(h, {
      ...avatar(),
      find: async () => {
        throw new Error('network down');
      },
    });
    await w.start();
    await w.submitFandom("Hitchhiker's");
    await w.accept();
    expect(w.state.kind).toBe('launching');
  });

  it('looks nothing up at all when no avatar dependency is supplied', async () => {
    const h = new FakeHermes(scenario(INSTALLED_EMPTY));
    const w = new Wizard(h);
    await w.start();
    await w.submitFandom("Hitchhiker's");
    await w.accept();
    expect(w.avatarDataUrl()).toBeNull();
    expect(h.bytes.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/wizard.test.ts`
Expected: FAIL — `Wizard` takes one constructor argument, `avatarDataUrl` is not a function.

- [ ] **Step 3: Implement in the wizard**

In `src/main/wizard.ts`, add the imports and the option type:

```typescript
import { findAvatar, type AvatarDeps, type AvatarFind } from './avatar';
import { dataUrl, saveAvatar, type ToPng } from './avatarStore';

/**
 * Injected so the whole feature is absent unless wired. `find` is overridable
 * only so tests can supply an outcome without a fake HTTP layer; production
 * passes `findAvatar` itself.
 */
export interface AvatarOptions {
  deps: AvatarDeps;
  toPng: ToPng;
  find?: (name: string, fandom: string, deps: AvatarDeps) => Promise<AvatarFind | null>;
}
```

Change the constructor and add the pending field:

```typescript
  /**
   * The face for the character on screen, held in memory rather than written.
   * Constraint 9: the user has not accepted this character yet, and "Try
   * someone else" must leave nothing on disk.
   */
  private pendingAvatar: AvatarFind | null = null;

  constructor(
    private hermes: HermesRuntime,
    private avatar?: AvatarOptions,
  ) {}

  /** The pending face for the meet screen, or null when there is none. */
  avatarDataUrl(): string | null {
    return this.pendingAvatar
      ? dataUrl(this.pendingAvatar.bytes, this.pendingAvatar.contentType)
      : null;
  }
```

Find the point where a derivation resolves and sets `{ kind: 'meet', character }`. Immediately before that `set`, clear the old face; immediately after it, start the lookup without awaiting it:

```typescript
    this.pendingAvatar = null;
    this.set({ kind: 'meet', character });
    this.lookUpFace(character, generation);
```

`generation` is the value this derivation captured. Add the method:

```typescript
  /**
   * Fetches the character's face in the background. Never awaited by anything
   * on the path to the meet screen: derivation already costs 20 to 60 seconds
   * and a second network call must not add to it. The screen renders initials
   * and swaps the face in if it arrives, the pattern D1 established for
   * palettes arriving late.
   */
  private lookUpFace(character: Character, generation: number): void {
    const avatar = this.avatar;
    if (!avatar) return;
    const find = avatar.find ?? findAvatar;
    void find(character.name, character.fandom, avatar.deps)
      .then((found) => {
        // The same staleness rule the derivation itself uses. Without it a face
        // for a character the user has already replaced attaches to the one on
        // screen.
        if (generation !== this.generation) return;
        this.pendingAvatar = found;
        if (found) this.set({ ...this.state });
      })
      .catch(() => {
        // Silent, per §10.7. There is nothing a user could do with this.
      });
  }
```

In `commitAccept`, after the persona write succeeds and before the skill install, write the face:

```typescript
      // After the persona, because a face without a persona is the worse of the
      // two half-written states, and swallowed because a profile with no face
      // is a working profile. §10.7: failure is silent.
      if (this.pendingAvatar && this.avatar) {
        try {
          await saveAvatar(
            this.hermes,
            'default',
            this.pendingAvatar.bytes,
            this.pendingAvatar.contentType,
            this.avatar.toPng,
          );
        } catch (err) {
          console.warn('Could not write the avatar for the new profile.', err);
        }
      }
```

Finally, clear `pendingAvatar` wherever `retryDerivation` resets for a new attempt, so a discarded character's face does not linger.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/wizard.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite and typecheck**

Run: `npm test && npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: the wizard finds a face while you decide, and writes it when you accept"
```

---

### Task 4: The meet screen shows the face

**Files:**
- Modify: `src/renderer/wizard/index.html:5`
- Modify: `src/renderer/wizard/main.ts` (`renderCharacter`)
- Modify: `src/renderer/wizard/wizard.css`
- Modify: `src/preload/wizard.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: `Wizard.avatarDataUrl()` (Task 3).
- Produces: `window.circe.onAvatar(cb: (dataUrl: string | null) => void)` on the wizard bridge.

- [ ] **Step 1: Widen the CSP**

In `src/renderer/wizard/index.html`, replace the CSP with:

```html
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:" />
```

Note for the implementer: §10.7 describes `img-src 'self' data:` as a policy to *hold*, but neither renderer declares `img-src` today, so images currently inherit `default-src 'self'` and a `data:` URL is refused outright. This adds it. Remote image loads stay refused, which is the half §10.7 actually protects.

- [ ] **Step 2: Add the channel to the preload bridge**

In `src/preload/wizard.ts`, inside the exposed object:

```typescript
  onAvatar: (cb: (dataUrl: string | null) => void) =>
    ipcRenderer.on('wizard:avatar', (_e, url: string | null) => cb(url)),
```

- [ ] **Step 3: Send it from the main process**

In `src/main/index.ts`, where the wizard's `onChange` already forwards state to the window, also send the face:

```typescript
    win.webContents.send('wizard:avatar', wizard.avatarDataUrl());
```

Wire the real dependencies when constructing the `Wizard`:

```typescript
  const wizard = new Wizard(hermes, {
    deps: {
      fetchJson: async (url) => {
        const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: timeout() });
        if (!res.ok) throw new Error(`summary ${res.status}`);
        return res.json();
      },
      fetchImage: async (url) => {
        const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: timeout() });
        if (!res.ok) throw new Error(`image ${res.status}`);
        return {
          bytes: new Uint8Array(await res.arrayBuffer()),
          contentType: res.headers.get('content-type') ?? '',
        };
      },
    },
    toPng: (bytes, contentType) => {
      const img = nativeImage.createFromBuffer(Buffer.from(bytes));
      return img.isEmpty() ? null : new Uint8Array(img.toPNG());
    },
  });
```

with, near the top of the file:

```typescript
// Wikimedia's API policy asks callers to identify themselves. `contentType` is
// unused by `nativeImage`, which sniffs the bytes; it stays in the signature so
// the store can shortcut a PNG without decoding it.
const USER_AGENT = 'Circe/0.1 (https://github.com/sarachipps/circe-desktop)';
const timeout = () => AbortSignal.timeout(8000);
```

Add `nativeImage` to the existing `electron` import.

- [ ] **Step 4: Render it**

In `renderCharacter` in `src/renderer/wizard/main.ts`, the `.avatar` div currently holds initials. Add an image element inside it and a helper the avatar channel calls:

```typescript
  // The face replaces the initials rather than sitting beside them, so the
  // fallback is the element that was already there and a lookup that finds
  // nothing renders precisely today's screen.
  const avatar = node.querySelector<HTMLElement>('.avatar')!;
  avatar.textContent = initials(c.name);
  applyFace(avatar, pendingFace);
```

and, at module scope:

First create `src/renderer/face.ts`, which Task 5 imports too. Both renderers need the identical
behaviour, and the tile renderer already imports `src/main/palette` and its own `toolLabel.ts`, so a
shared leaf module is this codebase's existing pattern rather than a new one:

```typescript
/**
 * The face on an initials circle, shared by the wizard's meet screen and the
 * tile header because both need exactly this and a second copy would drift.
 * A leaf module with no DOM access at import time, so tests can reach it.
 */

/** Up to two initials, e.g. `Long John Silver` becomes `LJ`. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * Puts a face on an initials circle, or takes it off. One code path for the
 * first render and the arrives-late update, following the rule the tile's
 * re-theme already follows: an update carrying nothing leaves what is showing
 * alone, and the initials stay underneath a face that fails to decode.
 */
export function applyFace(avatar: HTMLElement, url: string | null): void {
  avatar.querySelector('img')?.remove();
  if (!url) return;
  const img = document.createElement('img');
  img.src = url;
  img.alt = '';
  avatar.append(img);
}
```

Then in `src/renderer/wizard/main.ts`, import `{ applyFace, initials }` from `../face`, delete the
local `initials` function it already has, and add:

```typescript
/** The face for the character on screen, or null while there is none. */
let pendingFace: string | null = null;

circe.onAvatar((url) => {
  pendingFace = url;
  const avatar = document.querySelector<HTMLElement>('.screen.character .avatar');
  if (avatar) applyFace(avatar, url);
});
```

- [ ] **Step 5: Style it**

In `src/renderer/wizard/wizard.css`, beside the `.avatar` rule:

```css
/*
 * The face fills the initials circle rather than replacing it, so the ring and
 * the character's border colour survive and a face that fails to decode leaves
 * the initials visible underneath.
 */
.avatar { position: relative; overflow: hidden; }
.avatar img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
```

- [ ] **Step 6: Verify by eye**

Run `npm run build`, then walk the wizard to the meet screen with the `run-circe` skill against a sandbox home. Confirm a face appears for a character Wikipedia knows, and that a character it does not know shows initials with no error.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: the meet screen shows the character's face"
```

---

### Task 5: The tile header shows the face

**Files:**
- Modify: `src/renderer/tile/index.html:5`
- Modify: `src/renderer/tile/main.ts`
- Modify: `src/preload/tile.ts`
- Modify: `src/main/tiles.ts`

**Interfaces:**
- Consumes: `readAvatarDataUrl(hermes, profileId)` (Task 1).
- Produces: `tile:avatar` IPC channel carrying `string | null`.

- [ ] **Step 1: Widen the tile CSP**

Identical change to Task 4 step 1, in `src/renderer/tile/index.html`.

- [ ] **Step 2: Add the channel**

In `src/preload/tile.ts`:

```typescript
  onAvatar: (cb: (dataUrl: string | null) => void) =>
    ipcRenderer.on('tile:avatar', (_e, url: string | null) => cb(url)),
```

- [ ] **Step 3: Send it when the tile opens and when the profile changes**

In `src/main/tiles.ts`, after a tile's window finishes loading in `launch`, and again inside `retheme`, read and send:

```typescript
    // Deliberately not part of the character: the character is agent facts and
    // travels in the window URL, where a base64 PNG would not fit. This is the
    // same file re-read, on its own channel.
    void readAvatarDataUrl(this.deps.hermes, profileId).then((url) => {
      tile.win.send('tile:avatar', url);
    });
```

`TileDeps` already carries `hermes`, so no new plumbing is needed.

- [ ] **Step 4: Give the header an avatar circle**

The tile header is `<header id="bar"><span id="who"></span></header>` — there is no avatar element
today, so this creates one. §6.3 asks for "an avatar circle" in the header showing the profile's face,
"or the character's first initial in a colored circle" when it has none.

In `src/renderer/tile/index.html`:

```html
      <header id="bar"><span id="face" class="avatar"></span><span id="who"></span></header>
```

In `src/renderer/tile/main.ts`, fill the initials wherever `#who` is already set from the character,
so the two always agree:

```typescript
import { applyFace, initials } from '../face';

const face = document.getElementById('face')!;
face.textContent = initials(character.name);
circe.onAvatar((url) => applyFace(face, url));
```

`src/renderer/face.ts` is created by Task 4; import it rather than writing a second copy.

In `src/renderer/tile/tile.css`, size it against the header rather than the wizard's 84px:

```css
#bar .avatar {
  position: relative; overflow: hidden; flex: none;
  width: 22px; height: 22px; border-radius: 50%;
  border: 1px solid var(--tile-border); display: grid; place-items: center;
  font-size: 10px; font-weight: 600;
}
#bar .avatar img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
```

Check `--tile-border` against the token names actually used in `tile.css` and use the border token
the header already draws with.

- [ ] **Step 5: Verify by eye**

Build and launch a tile for a profile with an `avatar.png`, and one without. The first shows the face, the second the initials.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: a tile wears its agent's face"
```

---

### Task 6: The §10.7 provenance invariants

**Files:**
- Create: `test/provenance.test.ts`

**Interfaces:**
- Consumes: nothing. These tests read the repo and the shipped HTML.

- [ ] **Step 1: Write the tests**

Create `test/provenance.test.ts`:

```typescript
import { readdir, readFile } from 'node:fs/promises';
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
  // machine, or drawn locally from initials.
  it('bundles no character images', async () => {
    const offenders: string[] = [];
    async function walk(dir: string): Promise<void> {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        if (['node_modules', '.git', 'out', 'dist'].includes(e.name)) continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) {
          if (/avatar|character|face/i.test(e.name)) offenders.push(full);
          await walk(full);
        } else if (/\.(png|jpe?g|gif|webp)$/i.test(e.name) && e.name !== 'icon.png') {
          offenders.push(full);
        }
      }
    }
    await walk(ROOT);
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
```

- [ ] **Step 2: Run them**

Run: `npm test -- test/provenance.test.ts`
Expected: PASS once Tasks 2, 4 and 5 are in. If the image scan flags something legitimate, add it to the allowlist beside `icon.png` with a comment saying why — do not loosen the pattern.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test: pin the avatar provenance invariants"
```

---

## Self-Review

**Spec coverage.** The lookup and its four guardrails → Task 2. Storage in the profile, and the default-profile-at-home-root rule → Task 1. Timing, the non-blocking lookup, and the constraint 9 separation of lookup from write → Task 3. Display and the CSP → Tasks 4 and 5. The §10.7 invariants → Task 6, except "a failed lookup yields initials and no error text", which is covered behaviourally by Task 3's two silent-failure tests and by Task 4's fallback-element design; there is no renderer test harness to assert the absence of error text on screen, and Task 4 step 6 covers it by eye. Provenance recording (`articleUrl`, `license`) → Task 2, carried but not yet surfaced anywhere, which is correct: the licensing decision is a release blocker, not a build one.

**Deliberately not covered.** Upload, the file picker, circular crop, and force-initials, all of which ship with Adjust. `avatarSource`/`avatarLicense` are returned by `findAvatar` and held by the wizard but are not yet written to `circe.json`; doing so needs a schema decision about that file that this plan does not make, and nothing reads them yet. Whoever builds the attribution surface writes them.

**Type consistency.** `AvatarFind`, `AvatarDeps`, `AvatarLicense` and `ToPng` are defined in Tasks 1 and 2 and used with those names in Task 3. `avatarPath`, `saveAvatar`, `readAvatarDataUrl` and `dataUrl` keep their signatures across Tasks 1, 3 and 5. `applyFace(avatar, url)` is defined in Task 4 and reused by name in Task 5.

**The one piece of genuinely new UI.** The tile header has no avatar element today, only
`<span id="who">`, so Task 5 step 4 creates the circle rather than filling one. §6.3 specifies it
("an avatar circle... or the character's first initial in a colored circle"), but its size and
placement in a 22px-tall header bar are this plan's call, and are the most likely thing to want an
eye on before it is committed.
