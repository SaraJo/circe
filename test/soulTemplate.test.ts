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

async function render(character: Character = TRILLIAN): Promise<string> {
  return renderOrchestratorSoul(character, await readFile(ORCHESTRATOR_TEMPLATE_PATH, 'utf8'));
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
    expect(await render()).toMatch(/never play the part/i);
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

  it('writes the derived voice into its own section', async () => {
    const soul = await render({ ...TRILLIAN, voice: 'Dry, exact, faintly amused.' });
    expect(soul).toContain('## Voice');
    expect(soul).toContain('Dry, exact, faintly amused.');
  });

  // Empty is not a hole in the file: it is the plain-spoken setting, and it is
  // what a user who asked for plain speech gets.
  it('falls back to plain speech when no voice was derived', async () => {
    const soul = await render({ ...TRILLIAN, voice: '' });
    expect(soul).toContain('## Voice');
    expect(soul).not.toContain('{{VOICE}}');
    expect(soul).toMatch(/speak plainly/i);
  });

  // Voice, not roleplay — the line the whole feature stands on. Render with a
  // non-empty voice so the plain-speech fallback text can't satisfy either
  // assertion by accident.
  it('keeps judgement out of the costume', async () => {
    const soul = await render({ ...TRILLIAN, voice: 'Dry, exact, faintly amused.' });
    expect(soul).toMatch(/never invent facts/i);
    expect(soul).toMatch(/would obscure the answer, drop it/i);
  });

  // The user's answer to the voice question is itself the authorisation, so
  // this is the one persona edit that needs no second approval.
  it('tells it how to drop the voice when asked', async () => {
    const soul = await render();
    expect(soul).toContain('## Voice');
    expect(soul).toMatch(/rewrite/i);
  });

  /**
   * I6. `## Voice` holds the voice description, the three voice-not-roleplay
   * rules, and the dial-down instruction itself. "Rewrite this section" scoped
   * the edit over all of it — an agent following it literally deletes "you
   * never invent facts", "drop it for that sentence", "never soften bad news",
   * and the instruction it is in the middle of obeying, to satisfy a request
   * about diction. The rewrite has to name the paragraph, not the section.
   */
  it('scopes the dial-down rewrite to the voice paragraph alone', async () => {
    const soul = await render({ ...TRILLIAN, voice: 'Dry, exact, faintly amused.' });
    expect(soul).toMatch(/only the voice paragraph at the top of this\s+section/i);
    expect(soul).toMatch(/Leave the rest of this section exactly as it is/i);
    expect(soul).toMatch(/still apply to a plain voice/i);
  });

  /**
   * The correct end state of that rewrite is the file a plain-spoken profile
   * ships with in the first place — so the instruction quotes the same sentence
   * `voiceOrPlain('')` writes, and this test pins the two together.
   */
  it('tells it to rewrite the paragraph into exactly what a plain profile ships with', async () => {
    const PLAIN = 'Speak plainly. No accent, no mannerisms, no performance.';
    expect(await render({ ...TRILLIAN, voice: '' })).toContain(PLAIN);
    expect(await render({ ...TRILLIAN, voice: 'Dry, exact, faintly amused.' })).toContain(PLAIN);
  });

  /**
   * I5. This file *is* the agent's governance and its prompt, so "never
   * silently modify your own governance, prompts, memory structure, tools, or
   * skills — the sequence is fixed" read literally beats the Voice section's
   * "their answer authorises it, do not ask again". Under pressure the model
   * reads whichever it reaches first, so the exception has to be named in the
   * governance section too, or the user says "speak plainly" and gets asked for
   * approval to apply a patch — which is what the spec forbids.
   */
  it('names the voice as the one exception to its own approval sequence', async () => {
    const soul = await render({ ...TRILLIAN, voice: 'Dry, exact, faintly amused.' });
    const start = soul.indexOf('## Proposal is free');
    expect(start).toBeGreaterThan(-1);
    const rest = soul.slice(start + 3);
    const section = rest.slice(0, rest.indexOf('\n## '));

    expect(section).toMatch(/one exception/i);
    expect(section).toContain('## Voice');
    expect(section).toMatch(/is the authorisation/i);
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
