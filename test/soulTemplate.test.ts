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
  voice: '',
  greeting: '',
  voiceCheck: '',
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

  it('has a network section recording that no specialists exist yet', async () => {
    const soul = await render();
    expect(soul).toContain('## The network');
    expect(soul).toMatch(/you are the only agent/i);
  });

  // 2026-08-18: the persona carried its own copy of the create procedure — a
  // bare `hermes profile create` and a literal `~/.hermes` path — and the
  // persona is always in context while a skill has to be loaded. So the
  // orchestrator followed this, not the skill: in two observed runs it created
  // a profile with no `--clone` (which cannot reach a model) and no
  // `circe.json` (which leaves the tile grey forever). One procedure, in the
  // skill; the persona says when to reach for it.
  it('sends the agent to its skill instead of carrying its own create command', async () => {
    const soul = await render();
    expect(soul).toContain('circe-orchestrator');
    expect(soul).not.toMatch(/hermes profile create/);
  });

  // The same C1 defect the skill was fixed for, still living here: under a
  // sandboxed HERMES_HOME this path is the operator's real home.
  it('never names a literal ~/.hermes path', async () => {
    expect(await render()).not.toContain('~/.hermes');
  });

  it('substitutes special replacement-pattern characters literally', () => {
    const dollarCharacter: Character = {
      ...TRILLIAN,
      name: 'Trillian $&',
      tagline: "the one who keeps $` the plot $'",
    };
    const rendered = renderOrchestratorSoul(dollarCharacter, '{{NAME}} — {{TAGLINE}}');
    expect(rendered).toBe("Trillian $& — the one who keeps $` the plot $'");
  });
});
