import { describe, expect, it } from 'vitest';
import { FakeHermes, INSTALLED_EMPTY } from './fake/hermes';
import {
  avatarPath,
  avatarProvenancePath,
  dataUrl,
  readAvatarDataUrl,
  readProvenance,
  saveAvatar,
} from '../src/main/avatarStore';
import type { AvatarFind } from '../src/main/avatar';

/**
 * The store now takes what the lookup found, not loose bytes, so that the face
 * and the record of where it came from cannot be written from two different
 * places. This wraps bytes in the smallest such value a test needs.
 */
function find(bytes: Uint8Array, contentType: string) {
  return {
    bytes,
    contentType,
    source: 'wikipedia' as const,
    title: 'Long John Silver',
    articleUrl: 'https://en.wikipedia.org/wiki/Long_John_Silver',
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/b/Silver.jpg',
    license: 'commons' as const,
  };
}

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
    const ok = await saveAvatar(h, 'default', find(PNG, 'image/png'), toPng);
    expect(ok).toBe(true);
    expect(await h.readHomeFileBytes('avatar.png')).toEqual(PNG);
  });

  // The spec fixes the filename as avatar.png, and Wikipedia thumbnails are
  // mostly JPEG, so something has to convert. A .jpg written under a .png name
  // is the kind of thing that works until something reads the extension.
  it('converts a non-PNG before writing', async () => {
    const h = new FakeHermes(INSTALLED_EMPTY);
    await saveAvatar(h, 'default', find(JPEG, 'image/jpeg'), toPng);
    const written = await h.readHomeFileBytes('avatar.png');
    expect(written!.slice(0, 8)).toEqual(PNG.slice(0, 8));
  });

  // Failure is silent (§10.7): a face that cannot be converted is not an error,
  // it is a profile with no face, which renders initials.
  it('writes nothing and reports failure when conversion fails', async () => {
    const h = new FakeHermes(INSTALLED_EMPTY);
    const ok = await saveAvatar(h, 'default', find(JPEG, 'image/jpeg'), () => null);
    expect(ok).toBe(false);
    expect(await h.readHomeFileBytes('avatar.png')).toBeNull();
  });

  // The two modules have to agree on what "is a PNG" means, or a header like
  // `image/png; charset=binary` passes `findAvatar`'s guard and then gets
  // needlessly (and possibly wrongly) reconverted here.
  it('skips conversion for a PNG content type carrying parameters', async () => {
    const h = new FakeHermes(INSTALLED_EMPTY);
    let converted = false;
    const trackingToPng = (bytes: Uint8Array): Uint8Array | null => {
      converted = true;
      return bytes;
    };
    const ok = await saveAvatar(h, 'default', find(PNG, 'image/png; charset=binary'), trackingToPng);
    expect(ok).toBe(true);
    expect(converted).toBe(false);
    expect(await h.readHomeFileBytes('avatar.png')).toEqual(PNG);
  });

  it('reports failure and does not throw when the write rejects', async () => {
    const h = new FakeHermes(INSTALLED_EMPTY);
    // Mock writeHomeFileBytes to reject
    h.writeHomeFileBytes = async () => {
      throw new Error('disk full');
    };
    const ok = await saveAvatar(h, 'default', find(PNG, 'image/png'), toPng);
    expect(ok).toBe(false);
  });
});

describe('readAvatarDataUrl', () => {
  it('reads a stored face back as a data URL the renderer can use', async () => {
    const h = new FakeHermes(INSTALLED_EMPTY);
    await saveAvatar(h, 'default', find(PNG, 'image/png'), toPng);
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

/** What the lookup hands the store, with only the fields provenance reads. */
const FIND: AvatarFind = {
  bytes: PNG,
  contentType: 'image/png',
  source: 'wikipedia',
  title: 'Data (Star Trek)',
  articleUrl: 'https://en.wikipedia.org/wiki/Data_(Star_Trek)',
  imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/3/32/Data_ST.jpg',
  license: 'commons',
};

describe('avatarProvenancePath', () => {
  // Beside the image, in the profile, for the same reason the image is there:
  // constraint 10 says a profile describes itself, and where a face came from
  // is a fact about that profile and about nothing else.
  it('sits beside the face it describes', () => {
    expect(avatarProvenancePath('default')).toBe('avatar.json');
    expect(avatarProvenancePath('killick')).toBe('profiles/killick/avatar.json');
  });
});

describe('saveAvatar provenance', () => {
  it('records where the face came from, beside the face', async () => {
    const h = new FakeHermes(INSTALLED_EMPTY);
    await saveAvatar(h, 'default', FIND, toPng);
    const written = JSON.parse((await h.readHomeFile('avatar.json'))!);
    expect(written).toMatchObject({
      source: 'wikipedia',
      title: 'Data (Star Trek)',
      articleUrl: 'https://en.wikipedia.org/wiki/Data_(Star_Trek)',
      imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/3/32/Data_ST.jpg',
      license: 'commons',
    });
    expect(typeof written.retrievedAt).toBe('string');
  });

  // `unknown` is the honest record for a Fandom image, which carries no
  // machine-readable licence at all. Writing nothing, or guessing, is what
  // makes the licensing position unauditable.
  it('records an unknown licence rather than omitting it', async () => {
    const h = new FakeHermes(INSTALLED_EMPTY);
    await saveAvatar(
      h,
      'default',
      { ...FIND, source: 'fandom', license: 'unknown', articleUrl: 'https://lotr.fandom.com/wiki/Samwise_Gamgee' },
      toPng,
    );
    const written = JSON.parse((await h.readHomeFile('avatar.json'))!);
    expect(written.source).toBe('fandom');
    expect(written.license).toBe('unknown');
  });

  // The two files are written by one call so they cannot disagree. A record
  // describing a face that is not there is worse than no record: it is a claim
  // about a file nobody can check.
  it('writes no record when the image could not be written', async () => {
    const h = new FakeHermes(INSTALLED_EMPTY);
    const ok = await saveAvatar(h, 'default', { ...FIND, contentType: 'image/jpeg' }, () => null);
    expect(ok).toBe(false);
    expect(await h.readHomeFile('avatar.json')).toBeNull();
  });

  // Accepting a second character overwrites the face, so the record beside it
  // has to move too, or it describes the previous agent.
  it('replaces the record when the face is replaced', async () => {
    const h = new FakeHermes(INSTALLED_EMPTY);
    await saveAvatar(h, 'default', FIND, toPng);
    await saveAvatar(h, 'default', { ...FIND, source: 'fandom', title: 'Kaywinnet Lee Frye', license: 'unknown' }, toPng);
    const written = JSON.parse((await h.readHomeFile('avatar.json'))!);
    expect(written.title).toBe('Kaywinnet Lee Frye');
    expect(written.source).toBe('fandom');
  });
});

describe('readProvenance', () => {
  it('reads a record back', async () => {
    const h = new FakeHermes(INSTALLED_EMPTY);
    await saveAvatar(h, 'default', FIND, toPng);
    expect((await readProvenance(h, 'default'))?.title).toBe('Data (Star Trek)');
  });

  it('is null for a profile with no face, and for an unreadable record', async () => {
    const h = new FakeHermes(INSTALLED_EMPTY);
    expect(await readProvenance(h, 'default')).toBeNull();
    await h.writeHomeFile('avatar.json', 'not json');
    expect(await readProvenance(h, 'default')).toBeNull();
  });
});
