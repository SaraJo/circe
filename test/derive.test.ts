import { describe, expect, it } from 'vitest';
import { deriveCharacter, relativeLuminance, toProfileId } from '../src/main/derive';
import { FakeHermes, INSTALLED_EMPTY, type Scenario } from './fake/hermes';

const GOOD_REPLY = JSON.stringify({
  name: 'Trillian',
  tagline: 'the one who keeps the plot',
  palette: { bg: '#1e2952', border: '#c7d2fe', accent: '#a5b4fc' },
  why: 'She is the only one on the ship tracking what everyone else is doing.',
});

function withReply(reply: string): Scenario {
  return { ...INSTALLED_EMPTY, replies: [{ match: 'coordinator', reply }] };
}

describe('toProfileId', () => {
  it('lowercases and hyphenates', () => {
    expect(toProfileId('Deep Thought')).toBe('deep-thought');
  });

  it('strips characters Hermes will not accept', () => {
    expect(toProfileId("Zaphod Beeblebrox'!")).toBe('zaphod-beeblebrox');
  });

  it('truncates to 32 characters without a trailing hyphen', () => {
    expect(toProfileId('Slartibartfast Of Magrathea The Fjord Maker')).toBe(
      'slartibartfast-of-magrathea-the',
    );
  });
});

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
  });
});

describe('deriveCharacter', () => {
  it('turns a fandom into a themed character', async () => {
    const h = new FakeHermes(withReply(GOOD_REPLY));
    const c = await deriveCharacter(h, "Hitchhiker's Guide to the Galaxy");
    expect(c.name).toBe('Trillian');
    expect(c.profileId).toBe('trillian');
    expect(c.palette.accent).toBe('#a5b4fc');
    expect(c.fandom).toBe("Hitchhiker's Guide to the Galaxy");
  });

  it('sends the fandom to the default profile', async () => {
    const h = new FakeHermes(withReply(GOOD_REPLY));
    await deriveCharacter(h, "Hitchhiker's Guide to the Galaxy");
    expect(h.queries[0]!.profileId).toBe('default');
    expect(h.queries[0]!.prompt).toContain("Hitchhiker's Guide to the Galaxy");
  });

  it('tolerates a model that wraps its JSON in a code fence', async () => {
    const h = new FakeHermes(withReply('Sure!\n```json\n' + GOOD_REPLY + '\n```\n'));
    expect((await deriveCharacter(h, 'anything')).name).toBe('Trillian');
  });

  it('rejects a palette whose background is too light for white text', async () => {
    const bad = JSON.parse(GOOD_REPLY);
    bad.palette.bg = '#f5f5f5';
    const h = new FakeHermes(withReply(JSON.stringify(bad)));
    await expect(deriveCharacter(h, 'anything')).rejects.toThrow(/background/i);
  });

  it('rejects a reply that is not JSON at all', async () => {
    const h = new FakeHermes(withReply('I think Trillian would be great!'));
    await expect(deriveCharacter(h, 'anything')).rejects.toThrow(/could not read/i);
  });

  it('rejects a malformed hex colour', async () => {
    const bad = JSON.parse(GOOD_REPLY);
    bad.palette.accent = 'indigo';
    const h = new FakeHermes(withReply(JSON.stringify(bad)));
    await expect(deriveCharacter(h, 'anything')).rejects.toThrow(/colour/i);
  });

  it('retries once with the same prompt before giving up', async () => {
    let calls = 0;
    const h = new FakeHermes(withReply(GOOD_REPLY));
    const original = h.query.bind(h);
    h.query = async (p, prompt) => {
      calls += 1;
      if (calls === 1) return 'nope';
      return original(p, prompt);
    };
    expect((await deriveCharacter(h, 'anything')).name).toBe('Trillian');
    expect(calls).toBe(2);
  });
});
