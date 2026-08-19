export { avatarPath } from './hermes/runtime';
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
  try {
    await hermes.writeHomeFileBytes(avatarPath(profileId), png);
    return true;
  } catch {
    return false;
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
