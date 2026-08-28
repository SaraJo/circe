/**
 * The second face source (spec constraint 4, §10.7).
 *
 * ## Why a second source exists
 *
 * Wikipedia is the better-behaved source and the only one that says anything
 * about an image's licence, but it does not have the material. Measured over
 * twelve fandoms with realistic derived names, the Wikipedia path finds seven
 * faces; the five it misses are characters with no article of their own (they
 * redirect to a character list, or the name is a disambiguation page) or with
 * an article carrying no free image, which is Wikipedia's non-free content
 * policy working as intended. Nothing about the lookup recovers those.
 *
 * Fandom has them. The same twelve measured against it return eleven.
 *
 * ## Why the model names the wiki
 *
 * Nothing derives `lotr.fandom.com` from "The Lord of the Rings", or
 * `bakerstreet.fandom.com` from "Sherlock Holmes". Fandom's own wiki-search
 * endpoint answers 403. The model knows both, and it is already being asked
 * for the character, so it is asked for the wiki in the same call - the same
 * move that fixed the full name.
 *
 * That makes this the one model-supplied value that chooses an outbound
 * destination, so it is validated twice: once in `derive.ts`, where a reply
 * that is not a plain Fandom subdomain becomes `''`, and again here, because a
 * host check that lives only in the validator is one refactor from being gone.
 *
 * ## What this source cannot tell us
 *
 * Fandom images carry no machine-readable licence. Wikipedia's URL path
 * distinguishes Commons from non-free; Fandom's does not, so every face from
 * here is recorded as `unknown` rather than guessed at. Circe still hosts and
 * ships nothing: the fetch happens on the user's machine and the file lands in
 * their own profile directory.
 */

import { fetchFace, retrying, type AvatarDeps, type AvatarFind } from './avatar';

/** A bare Fandom wiki host. Anchored at both ends; no scheme, port or path. */
const FANDOM_HOST = /^[a-z0-9-]+\.fandom\.com$/;
/** Every Fandom wiki serves its images from this one host. */
const IMAGE_HOST = 'static.wikia.nocookie.net';

/**
 * A wiki's stand-in for a character it has no picture of.
 *
 * Found on the first probe against the live source: `bakerstreet.fandom.com`
 * answers "Mrs. Hudson" with `Silhouette-female.png`. It is a real image, on
 * the right host, on the right page, of the right character's article - and it
 * is a grey outline. Every other rule passes it, and it would have been written
 * to disk and presented as the user's coordinator.
 *
 * This is a different failure from the ones the Wikipedia rules catch. Those
 * refuse the wrong subject: the show, the episode, the actor. This one refuses
 * a non-subject, and it is the more dangerous of the two, because it looks like
 * a hit in any measurement of how often a face was found.
 */
const PLACEHOLDER = /(silhouette|placeholder|no[_-]?image|question[_-]?mark|unknown)/i;

/** The filename a wiki image URL ends in, ignoring the `/revision/...` suffix. */
function imageFileName(url: string): string {
  const path = url.split('?')[0] ?? '';
  const named = path.split('/').filter((seg) => /\.(png|jpe?g|gif|webp)$/i.test(seg));
  return named[named.length - 1] ?? '';
}

/** Wide enough for the meet screen, small enough to keep a profile tidy. */
const RENDITION_WIDTH = 256;

/**
 * The URL to actually fetch, which is not the one the API hands back.
 *
 * Two problems, one parameter, both found by verifying against the live source
 * and neither visible from the API's documentation.
 *
 * **Format.** Fandom serves WebP for every image, whatever the URL extension
 * says. `Kaylee.jpg` comes back as `image/webp`, and so does the same URL asked
 * for with `Accept: image/png,image/jpeg`, with `image/*`, or with
 * `format=jpg`. `avatarStore` converts with Electron's `nativeImage`, which
 * decodes PNG and JPEG only, so without `format=original` every Fandom face
 * passes every rule in this module and is then dropped at the final step: the
 * second source finds nothing at all, silently, and looks like a source that
 * simply has no pictures.
 *
 * **Size.** The original is the full upload. Janet's is 1.6MB, for a face drawn
 * at 22 pixels in a tile header, and it would be converted to PNG and written
 * into the user's profile at that size. The wiki's own thumbnailer returns the
 * same image at 256px wide as a 16KB JPEG.
 */
export function renditionUrl(source: string): string {
  const path = (source.split('?')[0] ?? '').replace(/\/revision\/.*$/, '');
  return `${path}/revision/latest/scale-to-width-down/${RENDITION_WIDTH}?format=original`;
}

export function isPlaceholderImage(url: string): boolean {
  return PLACEHOLDER.test(imageFileName(url));
}

/** The `original` image out of a MediaWiki `prop=pageimages` reply. */
export function wikiImageUrl(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const pages = ((raw as Record<string, unknown>).query as Record<string, unknown> | undefined)
    ?.pages;
  if (typeof pages !== 'object' || pages === null) return null;
  for (const value of Object.values(pages as Record<string, unknown>)) {
    const page = value as Record<string, unknown>;
    if ('missing' in page) continue;
    const source = (page.original as Record<string, unknown> | undefined)?.source;
    if (typeof source === 'string' && source) return source;
  }
  return null;
}

/** The page title a reply came back under, which redirects may have changed. */
function wikiPageTitle(raw: unknown, fallback: string): string {
  const pages = ((raw as Record<string, unknown>)?.query as Record<string, unknown> | undefined)
    ?.pages;
  if (typeof pages !== 'object' || pages === null) return fallback;
  for (const value of Object.values(pages as Record<string, unknown>)) {
    const title = (value as Record<string, unknown>).title;
    if (typeof title === 'string' && title) return title;
  }
  return fallback;
}

/**
 * A character's face from the wiki the model named. Silent on every failure,
 * like the Wikipedia path: §10.7 requires that a face Circe could not find is
 * indistinguishable from a face that does not exist.
 *
 * The title rule the Wikipedia search path applies is deliberately absent. It
 * exists to judge an article nobody asked for by name, and this is a page
 * asked for by name on a wiki scoped to one fandom, where a redirect to
 * "Kaywinnet Lee Frye" for a request for "Kaylee Frye" is the source being
 * right rather than wrong.
 */
export async function findFandomAvatar(
  wiki: string,
  page: string | string[],
  deps: AvatarDeps,
): Promise<AvatarFind | null> {
  if (!FANDOM_HOST.test(wiki)) return null;
  const pages = (Array.isArray(page) ? page : [page])
    .map((candidate) => candidate.trim())
    .filter((candidate, index, all) => candidate && all.indexOf(candidate) === index);
  for (const candidate of pages) {
    const found = await findFandomPage(wiki, candidate, deps);
    if (found) return found;
  }
  return null;
}

/** One exact MediaWiki page attempt; the public function supplies safe aliases. */
async function findFandomPage(
  wiki: string,
  page: string,
  deps: AvatarDeps,
): Promise<AvatarFind | null> {
  try {
    const query = new URLSearchParams({
      action: 'query',
      titles: page,
      prop: 'pageimages',
      piprop: 'original',
      format: 'json',
      redirects: '1',
    });
    const url = `https://${wiki}/api.php?${query.toString()}`;
    const raw = await retrying(deps, () => deps.fetchJson(url));

    const source = wikiImageUrl(raw);
    if (!source) return null;

    // One host, over TLS, matched on the parsed hostname rather than on a
    // prefix, so a hostname that merely begins with the image host and
    // continues into somebody else's domain cannot pass.
    let parsed: URL;
    try {
      parsed = new URL(source);
    } catch {
      return null;
    }
    if (parsed.protocol !== 'https:' || parsed.hostname !== IMAGE_HOST) return null;
    if (isPlaceholderImage(source)) return null;

    const title = wikiPageTitle(raw, page);
    return await fetchFace(
      {
        imageUrl: renditionUrl(source),
        title,
        license: 'unknown',
        articleUrl: `https://${wiki}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
        source: 'fandom',
      },
      deps,
    );
  } catch {
    return null;
  }
}
