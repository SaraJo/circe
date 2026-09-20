export interface ImageAttachment {
  type: 'image';
  mimeType: string;
  data: string;
}
export type TilePrompt = string | { text: string; images: ImageAttachment[] };
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export function isImageAttachment(value: unknown): value is ImageAttachment {
  if (!value || typeof value !== 'object') return false;
  const image = value as Partial<ImageAttachment>;
  if (image.type !== 'image' || !IMAGE_TYPES.includes(image.mimeType ?? '') ||
      typeof image.data !== 'string' || !image.data.length ||
      image.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) return false;
  return image.data.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(image.data) &&
    image.data.length / 4 * 3 - (image.data.endsWith('==') ? 2 : image.data.endsWith('=') ? 1 : 0) <= MAX_IMAGE_BYTES;
}

export function isTilePrompt(value: unknown): value is TilePrompt {
  if (typeof value === 'string') return value.trim().length > 0;
  if (!value || typeof value !== 'object') return false;
  const prompt = value as { text?: unknown; images?: unknown };
  return typeof prompt.text === 'string' && Array.isArray(prompt.images) &&
    prompt.images.length <= 1 && prompt.images.every(isImageAttachment) &&
    (prompt.text.trim().length > 0 || prompt.images.length > 0);
}
