import { describe, expect, it } from 'vitest';
import { FakeHermes, INSTALLED_EMPTY } from './fake/hermes';
import { avatarPath, dataUrl, readAvatarDataUrl, saveAvatar } from '../src/main/avatarStore';

/** A PNG is identified by its 8-byte signature; these tests never need a real image. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9]);

/** Stands in for Electron's nativeImage: marks the bytes so the test can see conversion ran. */
const toPng = (bytes: Uint8Array, contentType: string): Uint8Array | null =>
  contentType === 'image/png' ? bytes : new Uint8Array([...PNG.slice(0, 8), ...bytes]);

describe('avatarPath', () => {
  // The coordinator IS the default profile, and the default profile keeps its
  // files at the home root — the same rule `soulPath` and `circe.json` follow.
  // Getting this wrong writes the face to `profiles/default/`, a directory
  // Hermes does not use, and the tile would show initials forever.
  it('puts the default profile face at the home root', () => {
    expect(avatarPath('default')).toBe('avatar.png');
  });

  it('puts a specialist face inside its own profile directory', () => {
    expect(avatarPath('killick')).toBe('profiles/killick/avatar.png');
  });
});

describe('saveAvatar', () => {
  it('writes the bytes into the profile', async () => {
    const h = new FakeHermes(INSTALLED_EMPTY);
    const ok = await saveAvatar(h, 'default', PNG, 'image/png', toPng);
    expect(ok).toBe(true);
    expect(await h.readHomeFileBytes('avatar.png')).toEqual(PNG);
  });

  // The spec fixes the filename as avatar.png, and Wikipedia thumbnails are
  // mostly JPEG, so something has to convert. A .jpg written under a .png name
  // is the kind of thing that works until something reads the extension.
  it('converts a non-PNG before writing', async () => {
    const h = new FakeHermes(INSTALLED_EMPTY);
    await saveAvatar(h, 'default', JPEG, 'image/jpeg', toPng);
    const written = await h.readHomeFileBytes('avatar.png');
    expect(written!.slice(0, 8)).toEqual(PNG.slice(0, 8));
  });

  // Failure is silent (§10.7): a face that cannot be converted is not an error,
  // it is a profile with no face, which renders initials.
  it('writes nothing and reports failure when conversion fails', async () => {
    const h = new FakeHermes(INSTALLED_EMPTY);
    const ok = await saveAvatar(h, 'default', JPEG, 'image/jpeg', () => null);
    expect(ok).toBe(false);
    expect(await h.readHomeFileBytes('avatar.png')).toBeNull();
  });
});

describe('readAvatarDataUrl', () => {
  it('reads a stored face back as a data URL the renderer can use', async () => {
    const h = new FakeHermes(INSTALLED_EMPTY);
    await saveAvatar(h, 'default', PNG, 'image/png', toPng);
    const url = await readAvatarDataUrl(h, 'default');
    expect(url).toMatch(/^data:image\/png;base64,/);
  });

  // The ordinary case for most profiles, and the reason nothing downstream may
  // treat null as an error.
  it('is null when the profile has no face', async () => {
    expect(await readAvatarDataUrl(new FakeHermes(INSTALLED_EMPTY), 'default')).toBeNull();
  });
});

describe('dataUrl', () => {
  it('encodes bytes with their type', () => {
    expect(dataUrl(new Uint8Array([1, 2, 3]), 'image/png')).toBe('data:image/png;base64,AQID');
  });
});
