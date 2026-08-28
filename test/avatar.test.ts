import { describe, expect, it } from 'vitest';
import {
  fandomTokens,
  findAvatar,
  httpDeps,
  HttpError,
  licenseOf,
  looksLikeCharacter,
  mentionsFandom,
  titleNames,
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
    // No test may spend real time on the retry backoff.
    sleep: async () => {},
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

  it('matches an omitted possessive or plural spelling without fuzzy prose matching', () => {
    expect(
      mentionsFandom(
        "a character in Douglas Adams's The Hitchhiker's Guide to the Galaxy",
        'Hitchhikers Guide',
      ),
    ).toBe(true);
    expect(
      mentionsFandom('a character in the Hitchhikers Guide radio series', "Hitchhiker's Guide"),
    ).toBe(true);
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

  // The invariant is "two hosts, over the network" — the right host over
  // cleartext is still a leak, not a pass.
  it('is null for the right host over http', () => {
    expect(licenseOf('http://upload.wikimedia.org/wikipedia/commons/a/b/X.jpg')).toBeNull();
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

  // The write path converts with `nativeImage`, which decodes only PNG and
  // JPEG. Accepting a GIF here would let it pass every other check, render
  // fine on the meet screen, and then silently fail to save.
  it('refuses a thumbnail whose content type is neither PNG nor JPEG', async () => {
    const fetchImage = async () => ({ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/gif' });
    expect(await findAvatar('X', 'Treasure Island', deps({ fetchImage }))).toBeNull();
  });

  it('accepts a content type with parameters, matched on the base type', async () => {
    const fetchImage = async () => ({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: 'image/png; charset=binary',
    });
    expect(await findAvatar('X', 'Treasure Island', deps({ fetchImage }))).not.toBeNull();
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

describe('titleNames', () => {
  // Rule 6, and the whole reason search is safe to use at all. Search answers
  // "Willow Buffy" with Oz's article and "Kaylee Frye Firefly" with a photo of
  // Jewel Staite, the actor. Both are real, both mention the fandom, and rule 4
  // waves both through. Only the title says they are not this character.
  it('accepts a title that is the name, with or without a disambiguator', () => {
    expect(titleNames('Data (Star Trek)', ['Data'])).toBe(true);
    expect(titleNames('Trillian (character)', ['Trillian Astra', 'Trillian'])).toBe(true);
    expect(titleNames('Hermione Granger', ['Hermione Granger'])).toBe(true);
  });

  // The full name is usually longer than the display name, so the article
  // title legitimately extends it. "Tyrion" must reach "Tyrion Lannister".
  it('accepts a title that extends the name on a word boundary', () => {
    expect(titleNames('Tyrion Lannister', ['Tyrion'])).toBe(true);
  });

  // ...but only on a boundary. Otherwise "Data" reaches "Database".
  it('refuses a title that merely starts with the same letters', () => {
    expect(titleNames('Database', ['Data'])).toBe(false);
  });

  it('refuses the show, the film and the wrong character', () => {
    expect(titleNames('Clueless', ['Cher Horowitz'])).toBe(false);
    expect(titleNames('Firefly (TV series)', ['Kaylee Frye', 'Kaylee'])).toBe(false);
    expect(titleNames('Oz (Buffy the Vampire Slayer)', ['Willow Rosenberg', 'Willow'])).toBe(false);
    expect(titleNames('Sherlock Holmes Museum', ['Mrs. Hudson'])).toBe(false);
  });

  // The actor, not the character. Search offers these unprompted: "Samwise
  // Gamgee Lord of the Rings" returns Sean Astin with a free photograph, which
  // would put a real person's face on the user's agent.
  it('refuses the actor who plays the character', () => {
    expect(titleNames('Sean Astin', ['Samwise Gamgee', 'Samwise'])).toBe(false);
    expect(titleNames('Jewel Staite', ['Kaylee Frye', 'Kaylee'])).toBe(false);
  });

  it('fails closed when there is no name to check', () => {
    expect(titleNames('Data (Star Trek)', [])).toBe(false);
    expect(titleNames('Data (Star Trek)', [''])).toBe(false);
  });
});

describe('looksLikeCharacter', () => {
  // Rule 7. Rule 6 cannot catch this one: "Janet(s)" is the tenth episode of
  // The Good Place season 3, and its title genuinely is the character's name
  // plus a parenthetical. Only the article's own description gives it away.
  it('refuses an episode named after the character', () => {
    expect(
      looksLikeCharacter({
        description: '10th episode of the 3rd season of The Good Place',
        extract: '"Janet(s)" is the tenth episode of the third season of the American series.',
      }),
    ).toBe(false);
  });

  it('accepts an article that calls itself a character', () => {
    expect(
      looksLikeCharacter({
        description: 'Fictional character in the fictional Star Trek universe',
        extract: 'Data is a fictional character in the Star Trek franchise.',
      }),
    ).toBe(true);
  });

  // The live description for Trillian is "Last remaining woman, in The
  // Hitchhiker's Guide to the Galaxy" — no "character" in it at all. The
  // extract carries the word, so both fields are read, not just the shorter.
  it('reads the extract when the description does not say it', () => {
    expect(
      looksLikeCharacter({
        description: "Last remaining woman, in The Hitchhiker's Guide to the Galaxy",
        extract: 'Tricia Marie McMillan is a fictional character in the series.',
      }),
    ).toBe(true);
  });

  it('fails closed on an article with neither field', () => {
    expect(looksLikeCharacter({})).toBe(false);
  });
});

/** A search response shaped like the live `/w/rest.php/v1/search/page` reply. */
function searchReply(...titles: string[]): Record<string, unknown> {
  return { pages: titles.map((title) => ({ title })) };
}

/**
 * Routes the two endpoints apart, the way the real deps do. `summaries` is
 * keyed by the article title the lookup asks for.
 */
function wiki(summaries: Record<string, Record<string, unknown> | undefined>, search?: unknown) {
  const urls: string[] = [];
  const fetchJson = async (url: string) => {
    urls.push(url);
    if (url.includes('/search/page')) {
      if (search === undefined) throw new Error('no search configured');
      return search;
    }
    const title = decodeURIComponent(url.split('/summary/')[1] ?? '').replace(/_/g, ' ');
    const hit = summaries[title];
    if (!hit) throw new Error(`404 ${title}`);
    return hit;
  };
  return { deps: deps({ fetchJson }), urls };
}

describe('findAvatar: the full name', () => {
  // Option 1, and the cheapest half of the fix: the model already knows the
  // full name, so the lookup asks Wikipedia about "Tyrion Lannister" rather
  // than "Tyrion", which is a disambiguation page.
  it('looks up the full name before the display name', async () => {
    const { deps: d, urls } = wiki({
      'Tyrion Lannister': summary({ title: 'Tyrion Lannister', extract: 'a Game of Thrones lord' }),
    });
    const found = await findAvatar('Tyrion', 'Game of Thrones', d, { fullName: 'Tyrion Lannister' });
    expect(found?.title).toBe('Tyrion Lannister');
    expect(urls[0]).toContain('Tyrion_Lannister');
  });

  // The display-name lookup is what ships today and it does win sometimes:
  // "Vimes" redirects to "Sam Vimes". Losing that to the new path would be a
  // regression dressed as an improvement.
  it('still falls back to the display name when the full name has no article', async () => {
    const { deps: d } = wiki({
      Vimes: summary({ title: 'Sam Vimes', extract: 'a Discworld watchman' }),
    });
    const found = await findAvatar('Vimes', 'Discworld', d, { fullName: 'Samuel Vimes' });
    expect(found?.title).toBe('Sam Vimes');
  });

  // Rules 6 and 7 belong to the search path only. Applied here they would
  // reject "Sam Vimes" for a display name of "Vimes" and undo the line above.
  it('does not apply the title rule to a direct lookup', async () => {
    const { deps: d } = wiki({
      Trillian: summary({ title: 'Trillian Astra', extract: "a Hitchhiker's Guide character" }),
    });
    expect(await findAvatar('Trillian', "Hitchhiker's Guide", d)).not.toBeNull();
  });
});

describe('findAvatar: the search fallback', () => {
  // Option 2, and the half that reaches what no name can: Wikipedia titles most
  // fictional characters with a disambiguator, and no full name the model gives
  // resolves `Data (Star Trek)` or `Trillian (character)` directly.
  it('finds the disambiguated article a direct lookup cannot reach', async () => {
    const { deps: d, urls } = wiki(
      {
        'Data (Star Trek)': summary({
          title: 'Data (Star Trek)',
          description: 'Fictional character in the Star Trek universe',
          extract: 'Data is a fictional character in the Star Trek franchise.',
        }),
      },
      searchReply('Data (Star Trek)'),
    );
    const found = await findAvatar('Data', 'Star Trek', d, { fullName: 'Data' });
    expect(found?.title).toBe('Data (Star Trek)');
    expect(urls.some((u) => u.includes('/search/page'))).toBe(true);
  });

  it('searches en.wikipedia.org and nowhere else', async () => {
    const { deps: d, urls } = wiki({}, searchReply());
    await findAvatar('Data', 'Star Trek', d);
    const search = urls.find((u) => u.includes('/search/page'))!;
    expect(new URL(search).hostname).toBe('en.wikipedia.org');
  });

  // The whole reason search is usable. Every one of these is a real article
  // that mentions the fandom and carries a free image, so rules 1 to 5 pass.
  it('refuses the show, the episode and the actor that search offers', async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['Firefly (TV series)', { description: 'American space Western television series' }],
      ['Janet(s)', { description: '10th episode of the 3rd season of The Good Place' }],
      ['Sean Astin', { description: 'American actor', extract: 'Sean Astin is an actor.' }],
    ];
    for (const [title, over] of cases) {
      const { deps: d } = wiki(
        { [title]: summary({ title, extract: 'Mentions Firefly and The Good Place.', ...over }) },
        searchReply(title),
      );
      expect(await findAvatar('Kaylee', 'Firefly', d, { fullName: 'Kaylee Frye' })).toBeNull();
    }
  });

  // Search runs on every miss, which measured at 7 of 12 onboardings. Each
  // candidate costs a summary fetch and possibly an image fetch, so the list
  // is bounded rather than however many the endpoint felt like returning.
  it('summarises at most five candidates', async () => {
    const titles = Array.from({ length: 9 }, (_, i) => `Wrong ${i}`);
    const { deps: d, urls } = wiki({}, searchReply(...titles));
    await findAvatar('Kaylee', 'Firefly', d, { fullName: 'Kaylee Frye' });
    expect(urls.filter((u) => u.includes('/summary/')).length).toBeLessThanOrEqual(5 + 2);
  });

  // Onboarding already costs 20 to 60 seconds. A face that was found on the
  // first call must not buy three more round trips.
  it('does not search when the direct lookup found a face', async () => {
    const { deps: d, urls } = wiki({
      'Hermione Granger': summary({ title: 'Hermione Granger', extract: 'a Harry Potter witch' }),
    });
    await findAvatar('Hermione', 'Harry Potter', d, { fullName: 'Hermione Granger' });
    expect(urls.some((u) => u.includes('/search/page'))).toBe(false);
  });

  // §10.7: every failure is the same failure, and a search endpoint that is
  // down or has changed shape is not allowed to be different.
  it('is null when the search itself fails or returns nothing usable', async () => {
    const { deps: a } = wiki({}, { pages: 'not an array' });
    expect(await findAvatar('Kaylee', 'Firefly', a)).toBeNull();
    const { deps: b } = wiki({});
    expect(await findAvatar('Kaylee', 'Firefly', b)).toBeNull();
  });
});

describe('HttpError', () => {
  // Which failures are worth a second attempt, stated once so the retry and
  // the fetch layer cannot disagree about it.
  it('treats rate limiting and server faults as retryable', () => {
    expect(new HttpError(429, 'x').retryable).toBe(true);
    expect(new HttpError(500, 'x').retryable).toBe(true);
    expect(new HttpError(503, 'x').retryable).toBe(true);
  });

  // A 404 is the ordinary answer for a character with no article. Retrying it
  // doubles every miss, and search now makes misses the common case.
  it('treats a missing article and a bad request as final', () => {
    expect(new HttpError(404, 'x').retryable).toBe(false);
    expect(new HttpError(400, 'x').retryable).toBe(false);
  });
});

describe('findAvatar: retrying', () => {
  // Wikipedia rate-limits anonymous callers, and this was not hypothetical:
  // the probe that measured this feature was itself 429ed, and read the
  // throttling as twelve characters having no face. A user hitting the same
  // limit gets initials and no way to tell why.
  it('retries a rate-limited summary once and succeeds', async () => {
    let calls = 0;
    const fetchJson = async () => {
      calls += 1;
      if (calls === 1) throw new HttpError(429, 'summary 429');
      return summary();
    };
    expect(await findAvatar('X', 'Treasure Island', deps({ fetchJson }))).not.toBeNull();
    expect(calls).toBe(2);
  });

  it('retries a server fault on the image too', async () => {
    let calls = 0;
    const fetchImage = async () => {
      calls += 1;
      if (calls === 1) throw new HttpError(503, 'image 503');
      return IMG;
    };
    expect(await findAvatar('X', 'Treasure Island', deps({ fetchImage }))).not.toBeNull();
    expect(calls).toBe(2);
  });

  // Once, not until it works. Onboarding is already 20 to 60 seconds and a
  // face is worth none of it.
  it('gives up after a single retry', async () => {
    let calls = 0;
    const fetchJson = async () => {
      calls += 1;
      throw new HttpError(429, 'summary 429');
    };
    expect(await findAvatar('X', 'Treasure Island', deps({ fetchJson }))).toBeNull();
    // Two attempts on the full name, two on the search. The display name and
    // the full name are the same string here, so it is looked up once.
    expect(calls).toBe(4);
  });

  it('does not retry an article that simply is not there', async () => {
    let calls = 0;
    const fetchJson = async () => {
      calls += 1;
      throw new HttpError(404, 'summary 404');
    };
    await findAvatar('X', 'Treasure Island', deps({ fetchJson }));
    expect(calls).toBe(2);
  });

  it('waits before trying again rather than hammering the limit', async () => {
    const waits: number[] = [];
    let calls = 0;
    const fetchJson = async () => {
      calls += 1;
      if (calls === 1) throw new HttpError(429, 'summary 429');
      return summary();
    };
    await findAvatar('X', 'Treasure Island', deps({ fetchJson, sleep: async (ms) => void waits.push(ms) }));
    expect(waits).toEqual([expect.any(Number)]);
    expect(waits[0]).toBeGreaterThan(0);
  });
});

describe('httpDeps', () => {
  /** Stands in for the platform `fetch`, with only the fields the deps read. */
  function response(over: Partial<Response> & { body?: unknown } = {}): Response {
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/png' }),
      json: async () => over.body ?? summary(),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      ...over,
    } as unknown as Response;
  }

  // The seam this whole feature dies at silently. `retrying` only ever sees an
  // `HttpError`, so a fetch layer that throws a plain Error leaves every test
  // above green and the retry doing nothing in production. This is the module
  // boundary the last branch's worst defect lived in.
  it('throws a typed, retryable error for a rate-limited summary', async () => {
    const d = httpDeps(async () => response({ ok: false, status: 429 }), 'ua');
    await expect(d.fetchJson('https://en.wikipedia.org/x')).rejects.toMatchObject({
      status: 429,
      retryable: true,
    });
  });

  it('throws a typed, final error for a missing article', async () => {
    const d = httpDeps(async () => response({ ok: false, status: 404 }), 'ua');
    await expect(d.fetchJson('https://en.wikipedia.org/x')).rejects.toMatchObject({
      status: 404,
      retryable: false,
    });
  });

  it('throws a typed error for a failed image too', async () => {
    const d = httpDeps(async () => response({ ok: false, status: 503 }), 'ua');
    await expect(d.fetchImage('https://upload.wikimedia.org/x.png')).rejects.toMatchObject({
      status: 503,
      retryable: true,
    });
  });

  // Wikimedia's API policy asks callers to identify themselves, and an
  // unidentified caller is the one that gets rate-limited first.
  it('identifies the caller and bounds the request', async () => {
    let seen: RequestInit | undefined;
    const d = httpDeps(async (_url, init) => {
      seen = init;
      return response();
    }, 'Circe/0.1 (test)');
    await d.fetchJson('https://en.wikipedia.org/x');
    expect((seen?.headers as Record<string, string>)['User-Agent']).toBe('Circe/0.1 (test)');
    expect(seen?.signal).toBeDefined();
  });

  it('returns the bytes and the content type of an image', async () => {
    const d = httpDeps(async () => response(), 'ua');
    expect(await d.fetchImage('https://upload.wikimedia.org/x.png')).toEqual({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: 'image/png',
    });
  });
});
