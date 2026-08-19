import { describe, expect, it } from 'vitest';
import {
  fandomTokens,
  findAvatar,
  licenseOf,
  mentionsFandom,
  type AvatarDeps,
} from '../src/main/avatar';

const IMG = { bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' };

/** A summary shaped exactly like the live endpoint's, with the fields the rules read. */
function summary(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'standard',
    title: 'Long John Silver',
    extract: 'Long John Silver is a fictional character in the novel Treasure Island.',
    thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/commons/a/b/Silver.jpg' },
    content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Long_John_Silver' } },
    ...over,
  };
}

function deps(over: Partial<AvatarDeps> = {}): AvatarDeps {
  return {
    fetchJson: async () => summary(),
    fetchImage: async () => IMG,
    ...over,
  };
}

describe('fandomTokens', () => {
  // "Mentions the fandom" has to mean one thing, or it becomes three
  // implementations. Words of three characters or fewer go, which removes
  // "the", "of", "a" and most noise without a stop-word list to maintain.
  it('keeps the significant words and drops the short ones', () => {
    expect(fandomTokens("Hitchhiker's Guide to the Galaxy")).toEqual([
      'hitchhiker',
      'guide',
      'galaxy',
    ]);
    expect(fandomTokens('the Wire')).toEqual(['wire']);
  });

  it('is empty when nothing significant survives', () => {
    expect(fandomTokens('up')).toEqual([]);
  });
});

describe('mentionsFandom', () => {
  it('matches on any significant word, case-insensitively', () => {
    expect(mentionsFandom('a novel by Douglas Adams, The Galaxy series', 'the Galaxy')).toBe(true);
  });

  // Fails closed. A fandom we cannot check is not a fandom we may assume.
  it('is false when the fandom reduces to nothing checkable', () => {
    expect(mentionsFandom('anything at all', 'up')).toBe(false);
  });

  it('is false when no significant word appears', () => {
    expect(mentionsFandom('an instant messaging client for Windows', "Hitchhiker's Guide")).toBe(
      false,
    );
  });
});

describe('licenseOf', () => {
  // The summary response carries no license field. The path segment does:
  // /wikipedia/commons/ is freely licensed, /wikipedia/en/ is uploaded under
  // English Wikipedia's non-free content criteria. Measured 2026-08-19, seven
  // of nine usable thumbnails were non-free, so this is the common case.
  it('reads Commons and non-free apart by their URL path', () => {
    expect(licenseOf('https://upload.wikimedia.org/wikipedia/commons/a/b/X.jpg')).toBe('commons');
    expect(licenseOf('https://upload.wikimedia.org/wikipedia/en/d/d3/X.jpg')).toBe('non-free');
  });

  it('is null for a host or path we do not recognise', () => {
    expect(licenseOf('https://example.com/x.jpg')).toBeNull();
    expect(licenseOf('https://upload.wikimedia.org/other/x.jpg')).toBeNull();
  });
});

describe('findAvatar', () => {
  it('returns the image, the article and the licence for a clean match', async () => {
    const found = await findAvatar('Long John Silver', 'pirates and Treasure Island', deps());
    expect(found).not.toBeNull();
    expect(found!.bytes).toEqual(IMG.bytes);
    expect(found!.license).toBe('commons');
    expect(found!.articleUrl).toBe('https://en.wikipedia.org/wiki/Long_John_Silver');
  });

  // "Cher Horowitz" resolves to "List of Clueless characters". If such a list
  // article had a thumbnail it would be a group shot or a logo, presented as
  // the user's agent.
  it('refuses a redirect to a list article', async () => {
    const fetchJson = async () => summary({ title: 'List of Clueless characters' });
    expect(await findAvatar('Cher Horowitz', 'Clueless', deps({ fetchJson }))).toBeNull();
  });

  it('refuses a disambiguation page', async () => {
    const fetchJson = async () => summary({ type: 'disambiguation' });
    expect(await findAvatar('Trillian', "Hitchhiker's Guide", deps({ fetchJson }))).toBeNull();
  });

  it('refuses an article with no thumbnail', async () => {
    const fetchJson = async () => summary({ thumbnail: undefined });
    expect(await findAvatar('Samwise Gamgee', 'Lord of the Rings', deps({ fetchJson }))).toBeNull();
  });

  /**
   * The failure that matters most, and the one the sample got lucky on.
   * "Trillian" landed on a disambiguation page, but had Wikipedia sent it to
   * the instant-messaging client, this is the shape that would have arrived: a
   * standard article, a real thumbnail, and an extract about entirely the wrong
   * subject. A wrong face is worse than no face.
   */
  it('refuses a standard article about the wrong subject', async () => {
    const fetchJson = async () =>
      summary({
        title: 'Trillian (software)',
        extract: 'Trillian is a proprietary multiprotocol instant messaging application.',
      });
    expect(await findAvatar('Trillian', "Hitchhiker's Guide", deps({ fetchJson }))).toBeNull();
  });

  // Redirects are not suspect in themselves, so rule 4 must not reject the
  // ones we want. "Captain Picard" resolves to "Jean-Luc Picard".
  it('accepts a redirect to the same subject under another name', async () => {
    const fetchJson = async () =>
      summary({
        title: 'Jean-Luc Picard',
        extract: 'Jean-Luc Picard is a character in Star Trek: The Next Generation.',
        thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/en/1/2/Picard.jpg' },
      });
    const found = await findAvatar('Captain Picard', 'Star Trek', deps({ fetchJson }));
    expect(found).not.toBeNull();
    expect(found!.license).toBe('non-free');
  });

  it('refuses a thumbnail served from any other host', async () => {
    const fetchJson = async () =>
      summary({ thumbnail: { source: 'https://evil.example.com/x.jpg' } });
    expect(await findAvatar('X', 'Treasure Island', deps({ fetchJson }))).toBeNull();
  });

  // Nothing in this feature may fail an onboarding, so every one of these is
  // the same outcome as "Wikipedia had nothing".
  it('never throws, whatever goes wrong', async () => {
    const boom = async () => {
      throw new Error('network down');
    };
    expect(await findAvatar('X', 'Treasure Island', deps({ fetchJson: boom }))).toBeNull();
    expect(await findAvatar('X', 'Treasure Island', deps({ fetchImage: boom }))).toBeNull();
    expect(
      await findAvatar('X', 'Treasure Island', deps({ fetchJson: async () => 'not json' })),
    ).toBeNull();
  });

  it('refuses an empty image body', async () => {
    const fetchImage = async () => ({ bytes: new Uint8Array(), contentType: 'image/jpeg' });
    expect(await findAvatar('X', 'Treasure Island', deps({ fetchImage }))).toBeNull();
  });

  it('refuses an image that is too large to be a thumbnail', async () => {
    const fetchImage = async () => ({
      bytes: new Uint8Array(3_000_001),
      contentType: 'image/jpeg',
    });
    expect(await findAvatar('X', 'Treasure Island', deps({ fetchImage }))).toBeNull();
  });

  it('asks the summary endpoint for the name it was given', async () => {
    const seen: string[] = [];
    const fetchJson = async (url: string) => {
      seen.push(url);
      return summary();
    };
    await findAvatar('Long John Silver', 'Treasure Island', deps({ fetchJson }));
    expect(seen[0]).toBe(
      'https://en.wikipedia.org/api/rest_v1/page/summary/Long_John_Silver',
    );
  });
});
