import { describe, expect, it } from 'vitest';
import { openingMessage } from '../src/main/orchestrator/opening';
import type { Character } from '../src/shared/types';

const TRILLIAN: Character = {
  name: 'Trillian',
  fullName: 'Trillian',
  profileId: 'trillian',
  tagline: 'the one who keeps the plot',
  palette: { bg: '#1e2952', border: '#c7d2fe', accent: '#a5b4fc' },
  why: 'She tracks what everyone else is doing.',
  fandom: "Hitchhiker's Guide to the Galaxy",
  voice: '',
  intro: '',
  greeting: '',
  voiceCheck: '',
};

describe('openingMessage', () => {
  it('introduces the agent by name', () => {
    expect(openingMessage(TRILLIAN)).toContain('Trillian');
  });

  // Deliberately *not* asserting "you only have one agent". That was true and
  // useless: it frames a capable partner as a shortfall to be corrected, which
  // is the anxiety that sends someone off to plan a fleet. The first screen's
  // job is to show the thing is useful today.
  it('offers to do something rather than describing what it lacks', () => {
    const message = openingMessage(TRILLIAN);
    expect(message).toMatch(/tell me what you need/i);
    expect(message).not.toMatch(/only agent|the rest|build the rest/i);
  });

  it('suggests concrete work the user could hand over', () => {
    const message = openingMessage(TRILLIAN);
    expect(message).toMatch(/draft|research|model|plan/i);
  });

  it('names the fandom future agents will come from', () => {
    expect(openingMessage(TRILLIAN)).toContain("Hitchhiker's Guide to the Galaxy");
  });

  it('ends by asking about one real thing, not about the whole week', () => {
    expect(openingMessage(TRILLIAN)).toMatch(/what's on your plate/i);
  });

  it('never claims the user has a fleet', () => {
    expect(openingMessage(TRILLIAN)).not.toMatch(/your fleet|your agents are ready/i);
  });

  /**
   * The defect this message used to have, and the reason these three tests
   * exist. It asked "what do you spend your week on?" and offered "one for
   * your job, one for the code, one for the household admin you keep
   * forgetting" — which is a request for a day-one roster, and pre-names three
   * agents for work it has never seen. That is the first thing the operating
   * discipline rejects: specialists earn their place out of real work, they
   * are not planned in advance.
   *
   * The behaviour looked like the model drifting. It was not: it was this
   * string telling it to.
   */
  it('does not ask the user to inventory their work', () => {
    expect(openingMessage(TRILLIAN)).not.toMatch(/spend your (week|time)/i);
  });

  it('does not pre-name specialists for work it has not seen', () => {
    expect(openingMessage(TRILLIAN)).not.toMatch(/one for your|one for the/i);
  });

  it('never solicits a list of agents', () => {
    expect(openingMessage(TRILLIAN)).not.toMatch(
      /what agents|which agents|specialists worth having|suggest specialists|agents you (need|want|should)/i,
    );
  });

  /**
   * The examples are tasks, never agents, and that distinction is the whole
   * point. Naming specialists invites a roster; naming jobs invites work, and
   * work is what a specialist has to come out of. A regression here would read
   * perfectly well and quietly undo the fix.
   */
  it('gives examples of work, not examples of agents', () => {
    const message = openingMessage(TRILLIAN);
    expect(message).not.toMatch(/one for (your|the)|an agent for|a specialist for/i);
  });

  it('still says a specialist has to be worth having', () => {
    expect(openingMessage(TRILLIAN)).toMatch(/earn their place/i);
  });

  it('leaves the decision with the user', () => {
    expect(openingMessage(TRILLIAN)).toMatch(/you decide/i);
  });

  it('wraps no paragraph itself — the tile renders this with pre-wrap', () => {
    // The tile shows this message in a ~340px column with `white-space:
    // pre-wrap` (tile.css `.msg.plain`), which honours every newline in the
    // string. Any newline *inside* a paragraph is therefore a hard break at
    // whatever column the source was wrapped to, and lands mid-sentence.
    // Paragraphs must be single lines and let the renderer do the wrapping;
    // only the blank lines *between* them are real.
    const paragraphs = openingMessage(TRILLIAN).split('\n\n');
    for (const paragraph of paragraphs) {
      expect(paragraph).not.toContain('\n');
    }
  });

  it('still separates its paragraphs', () => {
    expect(openingMessage(TRILLIAN).split('\n\n').length).toBeGreaterThan(1);
  });

  it('does not escape HTML-significant characters in the interpolated name or fandom', () => {
    // openingMessage is plain string interpolation with no HTML escaping —
    // by design, since the tile renders this message with `textContent`,
    // never `innerHTML`/`marked` (Amendment 3). If a name or fandom ever
    // contained markup, it must survive here unchanged; escaping it here
    // would be the wrong layer, and *not* escaping it here is only safe
    // because the renderer never treats this string as HTML.
    const withMarkup: Character = {
      ...TRILLIAN,
      name: 'Marvin <b>the Paranoid Android</b>',
      fullName: 'Marvin <b>the Paranoid Android</b>',
      fandom: 'The <script>Hitchhiker\'s</script> Guide',
    };
    const message = openingMessage(withMarkup);
    expect(message).toContain('Marvin <b>the Paranoid Android</b>');
    expect(message).toContain('The <script>Hitchhiker\'s</script> Guide');
  });

  const SILVER: Character = {
    name: 'Long John Silver',
    fullName: 'Long John Silver',
    profileId: 'long-john-silver',
    tagline: 'the quartermaster who runs the crew',
    palette: { bg: '#1b2a1f', border: '#d8c9a3', accent: '#e0a458' },
    why: 'He keeps the crew pointed at one plan.',
    fandom: 'pirates',
    voice: 'Rolling, salt-worn sailor talk.',
    intro: 'Long John Silver, quartermaster.',
    greeting: "Aye, friend — Long John Silver. Point me at the work and it's done.",
    voiceCheck: 'Do ye like bein’ spoke to this way, or shall I drop the salt?',
  };

  it('uses the character’s own greeting when it has one', () => {
    const message = openingMessage(SILVER);
    expect(message).toContain('Aye, friend');
    expect(message).not.toContain('your partner for whatever');
  });

  it('asks whether the user likes the voice, in the character’s words', () => {
    expect(openingMessage(SILVER)).toContain('drop the salt');
  });

  // The demonstration has to come first: a question about an accent nobody has
  // heard yet is a question about a hypothetical, and everyone says yes to those.
  it('asks only after it has spoken', () => {
    const message = openingMessage(SILVER);
    expect(message.indexOf('Aye, friend')).toBeLessThan(message.indexOf('drop the salt'));
  });

  // Degradation: a model that skipped the fields leaves today's product exactly
  // as it is.
  it('falls back to the scripted opening when there is no greeting', () => {
    const message = openingMessage({ ...SILVER, greeting: '' });
    expect(message).toContain('your partner for whatever');
    expect(message).toContain('Long John Silver');
  });

  // Nothing to ask about, so it doesn't ask.
  it('asks nothing when the character has no voice', () => {
    const message = openingMessage({ ...SILVER, voice: '', voiceCheck: '' });
    expect(message).not.toMatch(/plainly|drop the salt/i);
  });

  // A voice with no question supplied still gets asked about — the question is
  // the point, and Circe can always write it.
  it('asks plainly when the character supplied no question of its own', () => {
    const message = openingMessage({ ...SILVER, voiceCheck: '' });
    expect(message).toMatch(/plainly/i);
  });

  /**
   * `derive.ts` bounds `voice` and `greeting` independently, so this
   * combination is reachable from one ordinary model reply: a good voice, and
   * a greeting long enough to be dropped. The message the user then reads is
   * Circe's plain scripted prose — so there is no accent in it to ask about,
   * and `plainCheck`'s "I talk like this because pirates is where I'm from"
   * would be a claim about a message that never talked like anything.
   */
  it('asks nothing about a voice the message never used', () => {
    const message = openingMessage({ ...SILVER, greeting: '' });
    expect(message).toContain('your partner for whatever');
    expect(message).not.toMatch(/plainly|drop the salt|where I'm from/i);
  });

  /**
   * Sara, 2026-08-19: nothing Circe writes uses an em dash. It is the house
   * tell of machine-written prose, and the first message the user ever reads
   * has to sound like a person wrote it.
   *
   * The rule covers Circe's own strings only. `greeting` and `voiceCheck` are
   * the character's writing, and `derive.ts` asks the model to avoid them
   * rather than stripping them, so a fixture like SILVER above may carry one
   * and is not evidence of a defect here.
   */
  it('writes its scripted opening without em dashes', () => {
    expect(openingMessage(TRILLIAN)).not.toContain('\u2014');
  });

  it('writes its plain voice check without em dashes', () => {
    const message = openingMessage({
      ...SILVER,
      greeting: 'Aye, friend. Point me at the work and it is done.',
      voiceCheck: '',
    });
    expect(message).toMatch(/plainly/i);
    expect(message).not.toContain('\u2014');
  });
});
