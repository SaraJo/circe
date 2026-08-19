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
  // The invariant this module enforces is "two hosts, over the network" —
  // a hostname check alone would still let `http://upload.wikimedia.org/...`
  // through and fetch it in cleartext.
  if (url.protocol !== 'https:') return null;
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
    // Rule 5: the write path converts with Electron's `nativeImage`, which
    // decodes only PNG and JPEG. Accepting any `image/*` here would let a GIF
    // or WebP pass every check, render fine on the meet screen (Chromium
    // decodes more than `nativeImage` does), and then silently fail to save —
    // the user accepts a face and gets initials. Matched with any parameters
    // stripped, so a header like `image/png; charset=binary` still counts.
    const mime = contentType.split(';', 1)[0]?.trim().toLowerCase();
    if (mime !== 'image/png' && mime !== 'image/jpeg') return null;

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
