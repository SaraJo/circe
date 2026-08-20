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
/**
 * The search endpoint, on the same host the summary comes from, so the
 * two-host constraint is unchanged: `en.wikipedia.org` and
 * `upload.wikimedia.org`, and nothing else, ever.
 */
const SEARCH = 'https://en.wikipedia.org/w/rest.php/v1/search/page';
/**
 * Search runs on every miss, which measured at 7 of 12 onboardings, and each
 * candidate costs a summary fetch. Five is what the measurement used and is
 * past where the ranking stops being about the character at all.
 */
const MAX_CANDIDATES = 5;
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
 * Rule 6. The article must be about *this character*, established by its title
 * rather than by its prose.
 *
 * Rules 1 to 5 were written for a lookup by exact name, where the only question
 * was whether the article was trustworthy. Search asks a different question: it
 * returns the four best answers to "Willow Buffy the Vampire Slayer", and the
 * best answer is frequently the show, the film, an episode, or the actor. Every
 * one of those is a standard article, most carry a free image, and rule 4 passes
 * them all, because an article about Firefly does mention Firefly.
 *
 * Measured on 12 fandoms, search without this rule takes a wrong face in 8 of
 * them — including Sean Astin and Jewel Staite, photographs of real people that
 * would be written to disk and presented as the user's coordinator.
 *
 * A trailing disambiguator is stripped, because that is Wikipedia's own way of
 * titling a character: `Data (Star Trek)`, `Trillian (character)`. What remains
 * must be one of the names we asked for, or extend it on a word boundary, since
 * the display name is often shorter than the article's ("Tyrion" reaches
 * "Tyrion Lannister", "Data" does not reach "Database").
 *
 * Fails closed, like rule 4: no name to check is not a match.
 */
export function titleNames(candidateTitle: string, names: string[]): boolean {
  const base = candidateTitle
    .replace(/\s*\([^()]*\)\s*$/, '')
    .trim()
    .toLowerCase();
  if (!base) return false;
  const wanted = names.map((n) => n.trim().toLowerCase()).filter(Boolean);
  return wanted.some((n) => base === n || base.startsWith(n + ' '));
}

/**
 * Rule 7. The article must say it is about a character.
 *
 * Rule 6 cannot reach the case this exists for: "Janet(s)" is the tenth episode
 * of The Good Place season 3, and its title really is the character's name plus
 * a parenthetical. It passes rule 6 honestly. Its description, "10th episode of
 * the 3rd season", is the only thing that gives it away.
 *
 * Both fields are read because either can carry the word alone. Data's
 * description says "Fictional character"; Trillian's says "Last remaining
 * woman, in The Hitchhiker's Guide to the Galaxy" and only the extract says
 * "character". Fails closed on an article that says neither.
 */
export function looksLikeCharacter(summary: { description?: unknown; extract?: unknown }): boolean {
  return [summary.description, summary.extract]
    .filter((v): v is string => typeof v === 'string')
    .join(' ')
    .toLowerCase()
    .includes('character');
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

/** Rules 1 to 4, read off a summary payload. Null means "do not trust this". */
function trustSummary(
  raw: unknown,
  fandom: string,
): { source: string; title: string; license: AvatarLicense; articleUrl: string } | null {
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

  const desktop = ((s.content_urls ?? {}) as Record<string, unknown>).desktop;
  const page = ((desktop ?? {}) as Record<string, unknown>).page;

  return { source, title, license, articleUrl: typeof page === 'string' ? page : '' };
}

/** Rule 5 and the size bound, applied to the bytes themselves. */
async function fetchFace(
  trusted: { source: string; title: string; license: AvatarLicense; articleUrl: string },
  deps: AvatarDeps,
): Promise<AvatarFind | null> {
  const { bytes, contentType } = await deps.fetchImage(trusted.source);
  if (bytes.length === 0 || bytes.length > MAX_BYTES) return null;
  // Rule 5: the write path converts with Electron's `nativeImage`, which
  // decodes only PNG and JPEG. Accepting any `image/*` here would let a GIF
  // or WebP pass every check, render fine on the meet screen (Chromium
  // decodes more than `nativeImage` does), and then silently fail to save —
  // the user accepts a face and gets initials. Matched with any parameters
  // stripped, so a header like `image/png; charset=binary` still counts.
  const mime = contentType.split(';', 1)[0]?.trim().toLowerCase();
  if (mime !== 'image/png' && mime !== 'image/jpeg') return null;

  return {
    bytes,
    contentType,
    articleUrl: trusted.articleUrl,
    title: trusted.title,
    license: trusted.license,
  };
}

/**
 * One article, start to finish. `names` is null on the direct path and a list
 * on the search path, which is the only difference between them: rules 6 and 7
 * exist to judge an article nobody asked for by name.
 */
async function tryTitle(
  title: string,
  fandom: string,
  deps: AvatarDeps,
  names: string[] | null,
): Promise<AvatarFind | null> {
  try {
    const raw = await deps.fetchJson(SUMMARY + encodeURIComponent(title.replace(/ /g, '_')));
    const trusted = trustSummary(raw, fandom);
    if (!trusted) return null;
    if (names) {
      if (!titleNames(trusted.title, names)) return null;
      if (!looksLikeCharacter(raw as Record<string, unknown>)) return null;
    }
    return await fetchFace(trusted, deps);
  } catch {
    // Per-article rather than per-lookup: one 404 among five candidates is the
    // ordinary case, and it must not cancel the four that follow.
    return null;
  }
}

/** The titles search offers, in its own order, bounded before anything is fetched. */
async function searchTitles(query: string, deps: AvatarDeps): Promise<string[]> {
  try {
    const raw = await deps.fetchJson(
      `${SEARCH}?q=${encodeURIComponent(query)}&limit=${MAX_CANDIDATES}`,
    );
    const pages = (raw as Record<string, unknown> | null)?.pages;
    if (!Array.isArray(pages)) return [];
    return pages
      .map((p) => (p as Record<string, unknown>)?.title)
      .filter((t): t is string => typeof t === 'string' && t.length > 0)
      .slice(0, MAX_CANDIDATES);
  } catch {
    return [];
  }
}

export interface FindOptions {
  /**
   * The character's full name, e.g. `Tyrion Lannister` for a display name of
   * `Tyrion`. Tried first, because a short display name resolves to the
   * character in roughly 1 lookup in 12.
   */
  fullName?: string;
}

/**
 * Three attempts, cheapest first, each one silent.
 *
 * 1. The full name, which is what an encyclopaedia is likely to title the
 *    article. Recovers 5 of 12 on the measured sample.
 * 2. The display name, which is what shipped before this and still wins on
 *    redirects: "Vimes" reaches "Sam Vimes". Rules 6 and 7 are deliberately
 *    NOT applied to either direct lookup — they would reject that redirect.
 * 3. Search, for the articles no name reaches: Wikipedia disambiguates most
 *    fictional characters, and neither "Data" nor "Trillian" resolves to
 *    `Data (Star Trek)` or `Trillian (character)`. Recovers 2 more, and is
 *    where rules 6 and 7 earn their place, because search answers a question
 *    nobody asked with the show, the episode, or the actor.
 *
 * Measured end to end on 12 fandoms: 1 face before, 7 after, no wrong faces.
 * The remaining 5 are characters with no article or no free image, which
 * nothing recovers.
 */
export async function findAvatar(
  name: string,
  fandom: string,
  deps: AvatarDeps,
  opts: FindOptions = {},
): Promise<AvatarFind | null> {
  const full = (opts.fullName ?? '').trim();
  // Order matters and duplicates do not: a character whose display name is
  // already its full name must not be looked up twice.
  const names = [full, name.trim()].filter((n, i, all) => n && all.indexOf(n) === i);

  for (const candidate of names) {
    const found = await tryTitle(candidate, fandom, deps, null);
    if (found) return found;
  }

  const query = `${names[0] ?? name} ${fandom}`.trim();
  for (const title of await searchTitles(query, deps)) {
    const found = await tryTitle(title, fandom, deps, names);
    if (found) return found;
  }
  return null;
}
