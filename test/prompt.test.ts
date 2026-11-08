import { describe, expect, it } from 'vitest';
import { isTilePrompt, promptText, MAX_IMAGE_BYTES, type TilePrompt } from '../src/shared/prompt';
import { TileSession } from '../src/main/restore';

const image = { type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' };
const file = { type: 'file' as const, name: 'report.pdf', path: '/Users/test/My Documents/report.pdf' };

describe('file attachments', () => {
  it('accepts any local file with or without message text', () => {
    expect(isTilePrompt({ text: 'Summarize', images: [], files: [file] })).toBe(true);
    expect(isTilePrompt({ text: '', images: [], files: [file] })).toBe(true);
    expect(isTilePrompt({ text: '', images: [], files: [{ ...file, path: 'C:\\Users\\test\\report.pdf' }] })).toBe(true);
  });

  it.each([
    null, {}, { ...file, path: 'https://example.com/report.pdf' },
    { ...file, path: '../report.pdf' }, { ...file, path: '/tmp/a\0b' },
    { ...file, name: '' }, { ...file, type: 'image' },
  ])('rejects invalid file attachments: %j', (value) => {
    expect(isTilePrompt({ text: 'Read this', images: [], files: [value] })).toBe(false);
  });

  it('enforces one attachment across images and files', () => {
    expect(isTilePrompt({ text: '', images: [], files: [file, file] })).toBe(false);
    expect(isTilePrompt({ text: '', images: [image], files: [file] })).toBe(false);
    expect(isTilePrompt({ text: 'hello', images: [], files: {} })).toBe(false);
  });

  it('passes paths as quoted data without embedding binary contents', () => {
    expect(promptText({ text: 'Summarize', images: [], files: [file] })).toBe(
      'Summarize\n\nAttached local file (read it with your file tools):\n\n' + JSON.stringify({ name: file.name, path: file.path }),
    );
    const unusual = { ...file, name: 'a\n"b.txt', path: '/tmp/a\n"b.txt' };
    expect(promptText({ text: '', images: [], files: [unusual] })).toContain(JSON.stringify({ name: unusual.name, path: unusual.path }));
  });

  it('preserves files while the agent starts', () => {
    const session = new TileSession<TilePrompt>();
    const message: TilePrompt = { text: '', images: [], files: [file] };
    session.beginLaunch();
    expect(session.route(message)).toEqual({ kind: 'held' });
    expect(session.openSession('new-session')).toEqual([message]);
  });
});

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
