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

  it('ends by asking what the user spends their week on', () => {
    expect(openingMessage(TRILLIAN)).toMatch(/what do you spend your week on/i);
  });

  it('never claims the user has a fleet', () => {
    expect(openingMessage(TRILLIAN)).not.toMatch(/your fleet|your agents are ready/i);
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
