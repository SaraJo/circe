import { describe, expect, it } from 'vitest';
import { isTilePrompt, MAX_IMAGE_BYTES, type TilePrompt } from '../src/shared/prompt';
import { TileSession } from '../src/main/restore';

const image = { type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' };

describe('image prompt validation', () => {
  it('accepts text, an image with text, and an image alone', () => {
    expect(isTilePrompt('Hello')).toBe(true);
    expect(isTilePrompt({ text: 'Describe this', images: [image] })).toBe(true);
    expect(isTilePrompt({ text: '', images: [image] })).toBe(true);
  });
  it.each([
    null, '', {}, { text: '', images: [] }, { text: 'hi', images: [image, image] },
    { text: 'hi', images: [{ ...image, mimeType: 'image/svg+xml' }] },
    { text: 'hi', images: [{ ...image, data: 'https://example.com/image.png' }] },
    { text: 'hi', images: [{ ...image, data: 'a===' }] },
    { text: 'hi', images: [{ ...image, data: '' }] },
  ])('rejects invalid payloads: %j', (value) => {
    expect(isTilePrompt(value)).toBe(false);
  });
  it('enforces the decoded byte limit', () => {
    const data = Buffer.alloc(MAX_IMAGE_BYTES).toString('base64');
    expect(isTilePrompt({ text: '', images: [{ ...image, data }] })).toBe(true);
    const oversized = Buffer.alloc(MAX_IMAGE_BYTES + 1).toString('base64');
    expect(isTilePrompt({ text: '', images: [{ ...image, data: oversized }] })).toBe(false);
  });
  it('preserves attachments while a session is launching', () => {
    const session = new TileSession<TilePrompt>();
    const message: TilePrompt = { text: 'Describe this', images: [{ ...image, type: 'image' }] };
    session.beginLaunch();
    expect(session.route(message)).toEqual({ kind: 'held' });
    expect(session.openSession('new-session')).toEqual([message]);
    expect(session.heldMessages).toEqual([]);
  });
});
