import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ORCHESTRATOR_TEMPLATE_PATH, renderOrchestratorSoul } from '../src/main/orchestrator/soulTemplate';
import { parseSoulHeading } from '../src/main/soul';
import { isRealSoul } from '../src/main/profiles';
import type { Character } from '../src/shared/types';

const TRILLIAN: Character = {
  name: 'Trillian',
  profileId: 'trillian',
  tagline: 'the one who keeps the plot',
  palette: { bg: '#1e2952', border: '#c7d2fe', accent: '#a5b4fc' },
  why: 'She tracks what everyone else is doing.',
  fandom: "Hitchhiker's Guide to the Galaxy",
};

async function render(): Promise<string> {
  return renderOrchestratorSoul(TRILLIAN, await readFile(ORCHESTRATOR_TEMPLATE_PATH, 'utf8'));
}

describe('renderOrchestratorSoul', () => {
  it('opens with a heading the realness rule recognises', async () => {
    const soul = await render();
    expect(isRealSoul(soul)).toBe(true);
    expect(parseSoulHeading(soul)).toEqual({
      name: 'Trillian',
      tagline: 'the one who keeps the plot',
    });
  });

  it('names the fandom so the crew stays coherent', async () => {
    expect(await render()).toContain("Hitchhiker's Guide to the Galaxy");
  });

  it('leaves no unsubstituted placeholders', async () => {
    expect(await render()).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });

  it('orders skills config before tools', async () => {
    const soul = await render();
    expect(soul.indexOf('hermes skills config')).toBeLessThan(soul.indexOf('hermes tools'));
  });

  it('carries every governance principle', async () => {
    const soul = await render();
    for (const phrase of [
      'Boring reliability before expanded authority',
      'Proposal is free',
      'Keep the layers separate',
      'checklist',
      'Checkpoints, not unlimited runs',
      'Know what time it is',
    ]) {
      expect(soul).toContain(phrase);
    }
  });

  it('requires a reply between proposing an agent and creating it', async () => {
    expect(await render()).toContain('Wait for an actual reply');
  });

  it('tells the agent not to roleplay the character', async () => {
    expect(await render()).toMatch(/do not roleplay/i);
  });
});
