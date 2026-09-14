export { avatarPath } from './hermes/runtime';
import { avatarPath, profileFilePath, type HermesRuntime } from './hermes/runtime';
import type { AvatarFind, AvatarLicense, AvatarSource } from './avatar';

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
 * Where a face came from, written beside it.
 *
 * Constraint 10 puts it in the profile: which article a likeness came from and
 * under what licence is a fact about that profile and about nothing else.
 * `avatar.json` rather than a field in `circe.json` because that file is the
 * palette and is rewritten on every re-theme, and because a face and its
 * provenance have to move together.
 */
export function avatarProvenancePath(profileId: string): string {
  return profileFilePath(profileId, 'avatar.json');
}

/**
 * The record itself. `license` is `unknown` for anything from Fandom, which
 * exposes no machine-readable licence: recorded honestly rather than guessed,
 * because the point of the file is to make the licensing position auditable
 * and a confident wrong answer is worse than an admitted gap.
 */
export interface AvatarProvenance {
  source: AvatarSource;
  title: string;
  articleUrl: string;
  imageUrl: string;
  license: AvatarLicense;
  /** The stored file is a local derivative when this field is present. */
  treatment?: AvatarFind['treatment'];
  /** ISO 8601, so a record can be aged without re-fetching anything. */
  retrievedAt: string;
}

/**
 * Writes a face into its profile, and the record of where it came from beside
 * it. Returns whether anything was written, so the caller can carry on either
 * way: a profile with no face is a working profile.
 *
 * One call writes both, deliberately. A record describing a face that is not
 * there is worse than no record, because it is a claim about a file nobody can
 * check.
 */
export async function saveAvatar(
  hermes: HermesRuntime,
  profileId: string,
  find: Pick<
    AvatarFind,
    | 'bytes'
    | 'contentType'
    | 'source'
    | 'title'
    | 'articleUrl'
    | 'imageUrl'
    | 'license'
    | 'treatment'
  >,
  toPng: ToPng,
): Promise<boolean> {
  const { bytes, contentType } = find;
  // Matched with any parameters stripped, the same way `avatar.ts` matches
  // `findAvatar`'s content type, so the two modules agree on what "is a PNG"
  // means: a header like `image/png; charset=binary` must still skip conversion.
  const mime = contentType.split(';', 1)[0]?.trim().toLowerCase();
  const png = mime === 'image/png' ? bytes : toPng(bytes, contentType);
  if (!png || png.length === 0) return false;
  try {
    await hermes.writeHomeFileBytes(avatarPath(profileId), png);
  } catch {
    return false;
  }
  const record: AvatarProvenance = {
    source: find.source,
    title: find.title,
    articleUrl: find.articleUrl,
    imageUrl: find.imageUrl,
    license: find.license,
    ...(find.treatment ? { treatment: find.treatment } : {}),
    retrievedAt: new Date().toISOString(),
  };
  try {
    await hermes.writeHomeFile(avatarProvenancePath(profileId), JSON.stringify(record, null, 2));
  } catch {
    // The face is already on disk and is what the user sees. Failing the whole
    // save here would trade a working avatar for its paperwork; §10.7 keeps
    // every avatar failure silent, and this is the least consequential of them.
  }
  return true;
}

/** A profile's provenance record, or null when it has none or it is unreadable. */
export async function readProvenance(
  hermes: HermesRuntime,
  profileId: string,
): Promise<AvatarProvenance | null> {
  let text: string | null;
  try {
    text = await hermes.readHomeFile(avatarProvenancePath(profileId));
  } catch {
    return null;
  }
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as AvatarProvenance;
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

/** A profile's face for the renderer, or null when it has none. */
export async function readAvatarDataUrl(
  hermes: HermesRuntime,
  profileId: string,
): Promise<string | null> {
  const bytes = await hermes.readHomeFileBytes(avatarPath(profileId));
  return bytes && bytes.length > 0 ? dataUrl(bytes, 'image/png') : null;
}
