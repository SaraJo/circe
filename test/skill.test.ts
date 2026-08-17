import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { SKILL_NAME, SKILL_SOURCE_PATH, installOrchestratorSkill } from '../src/main/orchestrator/skill';
import { FakeHermes, INSTALLED_EMPTY } from './fake/hermes';

describe('the circe-orchestrator skill file', () => {
  it('has frontmatter Hermes can index', async () => {
    const text = await readFile(SKILL_SOURCE_PATH, 'utf8');
    expect(text.startsWith('---\n')).toBe(true);
    expect(text).toContain(`name: ${SKILL_NAME}`);
    expect(text).toMatch(/^description: .{40,}$/m);
  });

  it('forbids creating in the turn that proposed', async () => {
    const text = await readFile(SKILL_SOURCE_PATH, 'utf8');
    expect(text).toContain('Wait for a reply');
    expect(text).toContain('Do not create an agent in the same turn you proposed it');
  });

  it('requires pruning a new profile', async () => {
    const text = await readFile(SKILL_SOURCE_PATH, 'utf8');
    expect(text.indexOf('hermes skills config')).toBeLessThan(text.indexOf('hermes tools'));
  });
});

describe('the orchestrator skill', () => {
  it('tells the orchestrator how to theme an agent it creates', async () => {
    const text = await readFile(SKILL_SOURCE_PATH, 'utf8');

    // The convention itself: without this the fleet grows in grey.
    expect(text).toContain('circe.json');
    expect(text).toMatch(/"version":\s*1/);
    expect(text).toContain('"palette"');
    for (const channel of ['bg', 'border', 'accent']) expect(text).toContain(`"${channel}"`);
  });

  it('tells the orchestrator not to ask the user for colours', async () => {
    const text = await readFile(SKILL_SOURCE_PATH, 'utf8');
    expect(text).toMatch(/Do not ask the user to pick colours/i);
  });

  it('still tells it to write a heading, which is what makes a profile real', async () => {
    const text = await readFile(SKILL_SOURCE_PATH, 'utf8');
    expect(text).toContain('# <Name> — <domain>');
  });

  // C1: `hermes profile create` (the preceding step) honours `HERMES_HOME`
  // because the ACP child inherits the environment it runs in. A literal
  // `~/.hermes` in the two file-write steps that follow would write SOUL.md
  // and circe.json into the operator's real home even under a sandboxed
  // `HERMES_HOME`, while the CLI step lands in the sandbox — so `profile
  // list` shows the new profile with no SOUL.md, isReal is false, and no
  // tile ever appears even though the orchestrator reports success.
  it('honours HERMES_HOME instead of a literal ~/.hermes path', async () => {
    const text = await readFile(SKILL_SOURCE_PATH, 'utf8');
    expect(text).not.toContain('~/.hermes');
    expect(text).toContain('HERMES_HOME');
  });

  // R1: `${HERMES_HOME:-$HOME/.hermes}` is shell parameter expansion. Naming
  // it in a "Write <path>" instruction is not enough — an agent that
  // satisfies "write a file" with a file-write tool passes that path through
  // unexpanded and creates a literal `${HERMES_HOME:-$HOME/.hermes}`
  // directory, reproducing C1's exact symptom (no SOUL.md where Hermes looks,
  // so isReal stays false and no tile appears) even though the skill now
  // "mentions" HERMES_HOME. The skill must tell the agent to resolve it to a
  // concrete path first.
  it('tells the agent to resolve HERMES_HOME to a concrete path before writing, not just name the variable', async () => {
    const text = await readFile(SKILL_SOURCE_PATH, 'utf8');
    expect(text).toMatch(/echo\s+"\$\{HERMES_HOME/);
    expect(text).toMatch(/absolute path/i);
  });

  // The load-bearing half of R1: no "Write `<path>`" instruction may itself
  // contain the raw expansion syntax, however clearly the surrounding prose
  // explains it — a model asked to write that literal string will write it
  // literally.
  it('never asks the agent to write a path containing shell expansion syntax', async () => {
    const text = await readFile(SKILL_SOURCE_PATH, 'utf8');
    const writeTargets = [...text.matchAll(/Write `([^`]+)`/g)].map((m) => m[1]);
    expect(writeTargets.length).toBeGreaterThan(0);
    for (const target of writeTargets) expect(target).not.toContain('${');
  });
});

describe('installOrchestratorSkill', () => {
  it('writes the skill into the default profile', async () => {
    const h = new FakeHermes(INSTALLED_EMPTY);
    const written = await installOrchestratorSkill(h, 'default');
    expect(written).toBe('skills/circe-orchestrator/SKILL.md');
    expect(await h.readHomeFile(written)).toContain('# Growing the network');
  });

  it('writes into a named profile when given one', async () => {
    const h = new FakeHermes(INSTALLED_EMPTY);
    const written = await installOrchestratorSkill(h, 'trillian');
    expect(written).toBe('profiles/trillian/skills/circe-orchestrator/SKILL.md');
  });
});
