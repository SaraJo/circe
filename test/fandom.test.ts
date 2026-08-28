import { describe, expect, it } from 'vitest';
import {
  findFandomAvatar,
  isPlaceholderImage,
  renditionUrl,
  wikiImageUrl,
} from '../src/main/fandom';
import type { AvatarDeps } from '../src/main/avatar';

const IMG = { bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' };
const SOURCE =
  'https://static.wikia.nocookie.net/firefly/images/5/55/Kaylee.jpg/revision/latest?cb=20120101';

/** A MediaWiki `prop=pageimages` reply, shaped like the live one. */
function page(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    query: {
      pages: {
        '4212': { pageid: 4212, title: 'Kaywinnet Lee Frye', original: { source: SOURCE }, ...over },
      },
    },
  };
}

function deps(over: Partial<AvatarDeps> = {}): AvatarDeps {
  return {
    fetchJson: async () => page(),
    fetchImage: async () => IMG,
    sleep: async () => {},
    ...over,
  };
}

describe('wikiImageUrl', () => {
  it('reads the original image out of a pageimages reply', () => {
    expect(wikiImageUrl(page())).toBe(SOURCE);
  });

  // The ordinary answer for a character the model guessed a page for.
  it('is null for a missing page', () => {
    expect(wikiImageUrl(page({ missing: '', original: undefined }))).toBeNull();
  });

  it('is null for a page with no image and for a reply of the wrong shape', () => {
    expect(wikiImageUrl(page({ original: undefined }))).toBeNull();
    expect(wikiImageUrl({ query: {} })).toBeNull();
    expect(wikiImageUrl('nonsense')).toBeNull();
  });
});

describe('isPlaceholderImage', () => {
  // Found in the wild on the first probe: bakerstreet.fandom.com answers
  // "Mrs. Hudson" with `Silhouette-female.png`, the wiki's stand-in for a
  // character it has no picture of. Every other rule passes it, and it would
  // have shipped as a face. Not the wrong person: a non-person.
  it('refuses a wiki stand-in image', () => {
    const base = 'https://static.wikia.nocookie.net/bakerstreet/images/8/86/';
    for (const file of [
      'Silhouette-female.png',
      'silhouette.png',
      'No_Image_Available.jpg',
      'NoImage.png',
      'Placeholder.png',
      'Question_mark.png',
      'Unknown-person.jpg',
    ]) {
      expect(isPlaceholderImage(base + file), file).toBe(true);
    }
  });

  it('accepts an ordinary character image', () => {
    expect(isPlaceholderImage(SOURCE)).toBe(false);
    expect(
      isPlaceholderImage('https://static.wikia.nocookie.net/lotr/images/2/20/Sam.jpg'),
    ).toBe(false);
  });
});

describe('findFandomAvatar', () => {
  it('fetches the original rendition, not the WebP the wiki prefers', async () => {
    const asked: string[] = [];
    await findFandomAvatar(
      'firefly.fandom.com',
      'Kaylee Frye',
      deps({
        fetchImage: async (url) => {
          asked.push(url);
          return IMG;
        },
      }),
    );
    expect(asked[0]).toContain('scale-to-width-down/256');
    expect(asked[0]).toContain('format=original');
  });

  it('finds a face on the wiki the model named', async () => {
    const found = await findFandomAvatar('firefly.fandom.com', 'Kaylee Frye', deps());
    expect(found?.title).toBe('Kaywinnet Lee Frye');
    expect(found?.license).toBe('unknown');
    expect(found?.articleUrl).toBe('https://firefly.fandom.com/wiki/Kaywinnet_Lee_Frye');
  });

  it('asks the wiki the model named, by page title', async () => {
    const seen: string[] = [];
    await findFandomAvatar(
      'lotr.fandom.com',
      'Samwise Gamgee',
      deps({
        fetchJson: async (url) => {
          seen.push(url);
          return page();
        },
      }),
    );
    const asked = new URL(seen[0]!);
    expect(asked.hostname).toBe('lotr.fandom.com');
    expect(asked.pathname).toBe('/api.php');
    // Read back through the parser rather than matched as a substring: a space
    // is legitimately `+` or `%20` here, and the assertion is about which page
    // was asked for, not about which of the two encodings came out.
    expect(asked.searchParams.get('titles')).toBe('Samwise Gamgee');
    expect(asked.searchParams.get('redirects')).toBe('1');
  });

  it('tries distinct safe aliases until one page has a face', async () => {
    const titles: string[] = [];
    const found = await findFandomAvatar(
      'firefly.fandom.com',
      ['Kaylee Frye', 'Kaywinnet Lee Frye', 'Kaylee Frye'],
      deps({
        fetchJson: async (url) => {
          const title = new URL(url).searchParams.get('titles')!;
          titles.push(title);
          return title === 'Kaywinnet Lee Frye'
            ? page()
            : page({ missing: '', original: undefined });
        },
      }),
    );

    expect(found).not.toBeNull();
    expect(titles).toEqual(['Kaylee Frye', 'Kaywinnet Lee Frye']);
  });

  // Defence in depth. `derive.ts` already refuses anything that is not a plain
  // Fandom subdomain, but this module is what actually opens the connection,
  // and a host check that lives only in the validator is a host check one
  // refactor away from being gone.
  it('refuses to contact a host that is not a fandom wiki', async () => {
    let called = false;
    const d = deps({
      fetchJson: async () => {
        called = true;
        return page();
      },
    });
    for (const wiki of ['evil.example.com', 'fandom.com.evil.net', '', 'lotr.fandom.com:8080']) {
      expect(await findFandomAvatar(wiki, 'X', d), wiki).toBeNull();
    }
    expect(called).toBe(false);
  });

  // Fandom serves every image off one host. An image URL pointing anywhere
  // else is a wiki that has been configured to hotlink somewhere we have not
  // agreed to contact.
  it('refuses an image served off any other host', async () => {
    for (const src of [
      'https://evil.example.com/x.jpg',
      'http://static.wikia.nocookie.net/x.jpg',
      'https://static.wikia.nocookie.net.evil.net/x.jpg',
    ]) {
      const d = deps({ fetchJson: async () => page({ original: { source: src } }) });
      expect(await findFandomAvatar('firefly.fandom.com', 'X', d), src).toBeNull();
    }
  });

  it('refuses a placeholder even though every other rule passes', async () => {
    const src = 'https://static.wikia.nocookie.net/bakerstreet/images/8/86/Silhouette-female.png';
    const d = deps({ fetchJson: async () => page({ original: { source: src } }) });
    expect(await findFandomAvatar('bakerstreet.fandom.com', 'Mrs. Hudson', d)).toBeNull();
  });

  // Rule 5 still applies: the store converts with `nativeImage`, which decodes
  // only PNG and JPEG, and wikis carry plenty of GIFs.
  it('refuses an image the store could not convert', async () => {
    const d = deps({ fetchImage: async () => ({ bytes: new Uint8Array([1]), contentType: 'image/gif' }) });
    expect(await findFandomAvatar('firefly.fandom.com', 'X', d)).toBeNull();
  });

  it('is null and silent when the wiki cannot be reached', async () => {
    const boom = async () => {
      throw new Error('offline');
    };
    expect(await findFandomAvatar('firefly.fandom.com', 'X', deps({ fetchJson: boom }))).toBeNull();
    expect(await findFandomAvatar('firefly.fandom.com', 'X', deps({ fetchImage: boom }))).toBeNull();
  });
});

describe('renditionUrl', () => {
  const BASE = 'https://static.wikia.nocookie.net/thegoodplace/images/e/e2/4janet.jpg';

  // Two problems in one parameter, both found against the live source.
  //
  // Fandom serves WebP for every image whatever the URL extension says, and
  // whatever `Accept` asks for. `nativeImage` does not decode WebP, so without
  // `format=original` every Fandom face passes each rule here and is dropped at
  // the final conversion, and the second source finds nothing at all.
  //
  // And the original is the full upload: Janet's is 1.6MB, for a face drawn at
  // 22 pixels in a tile header. Asking the wiki's own thumbnailer for 256px
  // wide returns the same image as a 16KB JPEG.
  it('asks for a scaled original rather than the full-size WebP', () => {
    expect(renditionUrl(`${BASE}/revision/latest?cb=2010`)).toBe(
      `${BASE}/revision/latest/scale-to-width-down/256?format=original`,
    );
  });

  it('builds the same rendition from a bare image path', () => {
    expect(renditionUrl(BASE)).toBe(
      `${BASE}/revision/latest/scale-to-width-down/256?format=original`,
    );
  });

  // Applying it twice must not nest one rendition path inside another.
  it('is stable when applied to its own output', () => {
    const once = renditionUrl(BASE);
    expect(renditionUrl(once)).toBe(once);
  });
});
