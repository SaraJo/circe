import { basename } from 'node:path';
import { saveAvatar, type ToPng } from './avatarStore';
import type { HermesRuntime } from './hermes/runtime';

/**
 * Replaces one profile's avatar with user-selected image bytes.
 *
 * Conversion happens before the store is touched, so an unreadable selection
 * cannot erase a working avatar. Only the leaf filename is retained: the
 * user's local directory structure is private and irrelevant provenance.
 */
export async function replaceAvatarFromUpload(
  hermes: HermesRuntime,
  profileId: string,
  bytes: Uint8Array,
  selectedPath: string,
  toPng: ToPng,
): Promise<boolean> {
  const png = toPng(bytes, 'application/octet-stream');
  if (!png || png.length === 0) return false;

  return saveAvatar(
    hermes,
    profileId,
    {
      bytes: png,
      contentType: 'image/png',
      source: 'upload',
      title: basename(selectedPath),
      articleUrl: '',
      imageUrl: '',
      license: 'unknown',
      treatment: 'pixel-art-32',
    },
    toPng,
  );
}
