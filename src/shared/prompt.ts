export interface ImageAttachment {
  type: 'image';
  mimeType: string;
  data: string;
}
export interface FileAttachment {
  type: 'file';
  name: string;
  path: string;
}
export type TilePrompt = string | { text: string; images: ImageAttachment[]; files?: FileAttachment[] };
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export function isFileAttachment(value: unknown): value is FileAttachment {
  if (!value || typeof value !== 'object') return false;
  const file = value as Partial<FileAttachment>;
  return file.type === 'file' && typeof file.name === 'string' && file.name.trim().length > 0 &&
    typeof file.path === 'string' && !file.path.includes('\0') &&
    /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(file.path);
}

/** Files stay on disk; Hermes reads them with its ordinary file tools. */
export function promptText(message: TilePrompt): string {
  if (typeof message === 'string') return message;
  if (!message.files?.length) return message.text;
  return [message.text, 'Attached local file (read it with your file tools):',
    ...message.files.map(({ name, path }) => JSON.stringify({ name, path })),
  ].filter(Boolean).join('\n\n');
}

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
  const prompt = value as { text?: unknown; images?: unknown; files?: unknown };
  if (prompt.files !== undefined && (!Array.isArray(prompt.files) || !prompt.files.every(isFileAttachment))) return false;
  const files = (prompt.files ?? []) as FileAttachment[];
  return typeof prompt.text === 'string' && Array.isArray(prompt.images) &&
    prompt.images.length + files.length <= 1 && prompt.images.every(isImageAttachment) &&
    (prompt.text.trim().length > 0 || prompt.images.length + files.length > 0);
}
