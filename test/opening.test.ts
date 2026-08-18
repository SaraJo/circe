import { describe, expect, it } from 'vitest';
import { openingMessage } from '../src/main/orchestrator/opening';
import type { Character } from '../src/shared/types';

const TRILLIAN: Character = {
  name: 'Trillian',
  profileId: 'trillian',
  tagline: 'the one who keeps the plot',
  palette: { bg: '#1e2952', border: '#c7d2fe', accent: '#a5b4fc' },
  why: 'She tracks what everyone else is doing.',
  fandom: "Hitchhiker's Guide to the Galaxy",
};

describe('openingMessage', () => {
  it('introduces the agent by name', () => {
    expect(openingMessage(TRILLIAN)).toContain('Trillian');
  });

  it('says plainly that this is the only agent so far', () => {
    expect(openingMessage(TRILLIAN)).toMatch(/only agent/i);
  });

  it('names the fandom future agents will come from', () => {
    expect(openingMessage(TRILLIAN)).toContain("Hitchhiker's Guide to the Galaxy");
  });

  it('ends by asking about one real thing, not about the whole week', () => {
    expect(openingMessage(TRILLIAN)).toMatch(/what are you working on right now/i);
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

  it('says out loud that it will not hand over a roster', () => {
    expect(openingMessage(TRILLIAN)).toMatch(/roster/i);
  });

  // The bar a specialist has to clear, visible from the first message rather
  // than buried in the skill the user never reads.
  it('names what would justify another agent', () => {
    const message = openingMessage(TRILLIAN);
    expect(message).toMatch(/its own tools/i);
    expect(message).toMatch(/its own memory/i);
    expect(message).toMatch(/its own permissions/i);
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
      fandom: 'The <script>Hitchhiker\'s</script> Guide',
    };
    const message = openingMessage(withMarkup);
    expect(message).toContain('Marvin <b>the Paranoid Android</b>');
    expect(message).toContain('The <script>Hitchhiker\'s</script> Guide');
  });
});
