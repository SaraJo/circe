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
});
