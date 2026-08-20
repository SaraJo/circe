import { describe, expect, it } from 'vitest';
import {
  DERIVATION_PROMPT,
  deriveCharacter,
  extractJson,
  relativeLuminance,
  toProfileId,
} from '../src/main/derive';
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

  const FULL_REPLY = JSON.stringify({
    name: 'Silver',
    fullName: 'Long John Silver',
    tagline: 'the quartermaster who runs the crew',
    palette: { bg: '#1b2a1f', border: '#d8c9a3', accent: '#e0a458' },
    why: 'He keeps the crew pointed at one plan.',
    voice: 'Rolling, salt-worn sailor talk. Calls the user "friend". Measures things in leagues.',
    intro: 'Long John Silver, quartermaster. Ye could do worse for a navigator.',
    greeting: 'Aye, friend — Long John Silver, at your service.',
    voiceCheck: "Do ye like bein' spoke to this way, or shall I drop the salt?",
  });

  // The lookup name, separate from the display name. Measured against the live
  // endpoint, a short display name resolves to the character in 1 of 12 cases:
  // "Tyrion" is a disambiguation page and "Willow" is a tree. The model already
  // knows the full name, so asking for it costs nothing at runtime and is what
  // the avatar lookup actually searches on.
  it('carries the full name through, separate from the display name', async () => {
    const h = new FakeHermes(withReply(FULL_REPLY));
    const c = await deriveCharacter(h, 'pirates');
    expect(c.name).toBe('Silver');
    expect(c.fullName).toBe('Long John Silver');
  });

  // The display name is what every screen shows, so a model that omits the
  // field must not leave the lookup searching for an empty string.
  it('falls back to the display name when no full name comes back', async () => {
    const h = new FakeHermes(withReply(GOOD_REPLY));
    expect((await deriveCharacter(h, 'anything')).fullName).toBe('Trillian');
  });

  // The profile id follows the display name, not the full name: it is the
  // directory the user sees in `hermes profile list`.
  it('builds the profile id from the display name', async () => {
    const h = new FakeHermes(withReply(FULL_REPLY));
    expect((await deriveCharacter(h, 'pirates')).profileId).toBe('silver');
  });

  it('carries the voice, greeting and check through', async () => {
    const h = new FakeHermes(withReply(FULL_REPLY));
    const c = await deriveCharacter(h, 'pirates');
    expect(c.voice).toContain('sailor talk');
    expect(c.greeting).toContain('Long John Silver');
    expect(c.voiceCheck).toContain('drop the salt');
  });

  // The meet screen's one line in the character's own voice. It exists so that
  // "Try someone else" is a choice with a difference: without it the user picks
  // between two candidates described in Circe's identical third-person
  // register, and only hears either of them after committing to one.
  it('carries the intro through', async () => {
    const h = new FakeHermes(withReply(FULL_REPLY));
    const c = await deriveCharacter(h, 'pirates');
    expect(c.intro).toContain('quartermaster');
  });

  // The other half of the bound: a real one-sentence intro is nowhere near it,
  // so the cap costs nothing a character would actually say.
  it('keeps an intro that is one ordinary sentence', async () => {
    const ok = JSON.parse(GOOD_REPLY);
    ok.voice = 'Plain and direct, no flourishes.';
    ok.intro = 'Someone has to know where everyone is. That has always been me.';
    const h = new FakeHermes(withReply(JSON.stringify(ok)));
    expect((await deriveCharacter(h, 'x')).intro).toBe(ok.intro);
  });

  // The degradation rule: an older or lazier model reply still produces a
  // working agent, just a plain-spoken one.
  it('leaves the voice fields empty when the model omits them', async () => {
    const h = new FakeHermes(withReply(GOOD_REPLY));
    const c = await deriveCharacter(h, "Hitchhiker's");
    expect(c.voice).toBe('');
    expect(c.intro).toBe('');
    expect(c.greeting).toBe('');
    expect(c.voiceCheck).toBe('');
    expect(c.name).toBe('Trillian');
  });

  it('drops a voice field that is not a string', async () => {
    const bad = JSON.parse(GOOD_REPLY);
    bad.voice = 42;
    const h = new FakeHermes(withReply(JSON.stringify(bad)));
    expect((await deriveCharacter(h, 'x')).voice).toBe('');
  });

  // A model that answers the voice question with an essay would push a wall of
  // text into SOUL.md and into the tile. Bounded, and dropped rather than cut:
  // half a sentence in a persona file is worse than none.
  it('drops a voice field that is far too long', async () => {
    const bad = JSON.parse(GOOD_REPLY);
    bad.voice = 'x'.repeat(401);
    bad.greeting = 'y'.repeat(1201);
    bad.voiceCheck = 'z'.repeat(201);
    const h = new FakeHermes(withReply(JSON.stringify(bad)));
    const c = await deriveCharacter(h, 'x');
    expect(c.voice).toBe('');
    expect(c.greeting).toBe('');
    expect(c.voiceCheck).toBe('');
  });

  // The previous test sets voice, greeting and voiceCheck over-length together,
  // so an over-long voiceCheck never independently exercises its own 200-char
  // bound: dropping the over-long voice already forces voiceCheck to '' by the
  // no-voice rule. Isolate it here with a valid, short voice. The sibling test
  // above ('carries the voice, greeting and check through') is the other half
  // of the contrast: a voiceCheck within bound, alongside a valid voice, comes
  // through unchanged.
  it('drops an over-long voiceCheck even when the voice itself is valid', async () => {
    const bad = JSON.parse(GOOD_REPLY);
    bad.voice = 'Plain and direct, no flourishes.';
    bad.voiceCheck = 'z'.repeat(201);
    const h = new FakeHermes(withReply(JSON.stringify(bad)));
    const c = await deriveCharacter(h, 'x');
    expect(c.voice).toBe('Plain and direct, no flourishes.');
    expect(c.voiceCheck).toBe('');
  });

  /**
   * Bounded harder than `voiceCheck`'s 200, because this one has a window to
   * fit in and `voiceCheck` does not: `voiceCheck` goes into a scrolling tile
   * conversation, while the intro renders inside the wizard's fixed 640x560
   * (`windows.ts`), on the screen that already carries the lead, the avatar
   * block, `why` and both buttons.
   *
   * At 17px in a 38ch column the intro wraps near 38 characters a line, and
   * the rest of that screen leaves it about three lines. 200 characters is six
   * lines, which overflows the window by roughly 75px and takes the primary
   * action off the bottom of it — the defect class this project has shipped
   * once already. 120 keeps a one-sentence line inside three; `wizard.css`
   * caps the element as well, so a wide character set that wraps to four
   * scrolls instead of pushing.
   */
  it('drops an over-long intro even when the voice itself is valid', async () => {
    const bad = JSON.parse(GOOD_REPLY);
    bad.voice = 'Plain and direct, no flourishes.';
    bad.intro = 'z'.repeat(121);
    const h = new FakeHermes(withReply(JSON.stringify(bad)));
    const c = await deriveCharacter(h, 'x');
    expect(c.voice).toBe('Plain and direct, no flourishes.');
    expect(c.intro).toBe('');
  });

  // `voiceCheck`'s rule, for the same reason: a line presented as the
  // character speaking in its own voice, from a character that has no voice,
  // is Circe putting words in its mouth on the one screen whose whole job is
  // showing the user what they are choosing between.
  it('blanks the intro when the character has no voice', async () => {
    const bad = JSON.parse(GOOD_REPLY);
    bad.voice = '';
    bad.intro = 'Trillian. I keep track of things.';
    const h = new FakeHermes(withReply(JSON.stringify(bad)));
    expect((await deriveCharacter(h, 'x')).intro).toBe('');
  });

  it('asks the model for a voice', () => {
    expect(DERIVATION_PROMPT('pirates')).toMatch(/voice/i);
  });
});

/**
 * The prompt is the only thing that decides whether this feature exists at all,
 * and until these tests it was covered by a single `/voice/i`. The reviewer
 * deleted the `"greeting"` and `"voiceCheck"` lines from the reply skeleton and
 * the whole suite still passed — in that state every user gets `greeting: ''`
 * and `voiceCheck: ''` forever, the tile silently falls back to Circe's
 * scripted opening, and the voice check never happens.
 */
describe('DERIVATION_PROMPT', () => {
  /** The exact reply skeleton the prompt tells the model to copy. */
  function skeleton(): Record<string, unknown> {
    // `extractJson` is production code — the same function the real reply goes
    // through. If the skeleton is not something Circe can parse, this throws,
    // which is precisely the failure a model that mirrors it would cause.
    return extractJson(DERIVATION_PROMPT('x')) as Record<string, unknown>;
  }

  // C1. The skeleton used to wrap `greeting` and `voiceCheck` across several
  // source lines, so the "JSON" the model was shown contained raw newlines
  // inside string values — a hard parse error — while asking for three
  // paragraphs inside one of those strings. The failure was total: no
  // character, no agent, at the emotional peak of onboarding.
  it('shows the model a reply skeleton that is itself valid JSON', () => {
    expect(() => skeleton()).not.toThrow();
  });

  it('tells the model not to put raw line breaks inside a string', () => {
    const prompt = DERIVATION_PROMPT('x');
    expect(prompt).toMatch(/no raw line breaks/i);
    expect(prompt).toContain('\\n\\n');
  });

  // C2. One assertion per field, by name, in the shape the model is asked to
  // return — so deleting a field's request from the skeleton cannot pass.
  it.each(['name', 'tagline', 'palette', 'why', 'voice', 'intro', 'greeting', 'voiceCheck'])(
    'asks for %s by name',
    (field) => {
      expect(skeleton()).toHaveProperty(field);
    },
  );

  it('describes the greeting as the character speaking first, in voice', () => {
    expect(String(skeleton().greeting)).toMatch(/first message to the user, in that voice/i);
  });

  it('describes the voiceCheck as offering to speak plainly', () => {
    expect(String(skeleton().voiceCheck)).toMatch(/speak plainly/i);
  });

  // The intro is not a greeting. The greeting is written to someone who has
  // already accepted this agent; the intro is spoken to someone still deciding,
  // and the prompt has to say so or the model returns the greeting twice.
  it('describes the intro as the character speaking before it has been chosen', () => {
    expect(String(skeleton().intro)).toMatch(/before the user has chosen/i);
    expect(String(skeleton().intro)).toMatch(/not a greeting/i);
  });

  // Circe's own copy is em-dash-free by rule (`wizard.test.ts`), enforced by a
  // test over strings we control. The character's words cannot be enforced that
  // way without rewriting what the model wrote, so they are asked for here.
  // Asking is best effort: an em dash can still reach the tile, and that is the
  // accepted cost of not editing the character's voice on its behalf.
  it('asks the model to write without em dashes', () => {
    expect(DERIVATION_PROMPT('x')).toMatch(/no em dashes/i);
  });

  // I3. Fourteen §6.5 guard tests in `opening.test.ts` run against a fixture
  // whose greeting is `''`. When a model supplies a greeting — the normal case
  // — the scripted opening is discarded and none of those guards apply to what
  // the user actually reads. Model text cannot be asserted, so the prohibition
  // has to be pinned in the one place that shapes it: the prompt.
  it('forbids a greeting that asks the user to plan a team or list agents', () => {
    expect(String(skeleton().greeting)).toMatch(/not ask the user to plan a team/i);
    expect(String(skeleton().greeting)).toMatch(/list agents/i);
  });
});
