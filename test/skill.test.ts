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

  it('chooses the smallest home for an automation', async () => {
    const text = await readFile(SKILL_SOURCE_PATH, 'utf8');
    expect(text).toMatch(/Skill or specialist/i);
    expect(text).toMatch(/narrow reusable skill to yourself/i);
    expect(text).toMatch(/one specialist carrying that skill/i);
    expect(text).toMatch(/wait for approval before writing anything/i);
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

  // The voice question is answered once, at onboarding, for the whole fleet —
  // the same way the fandom is. A specialist created without its own voice
  // would be the one agent in the network the user never got to hear.
  it('tells the orchestrator to give a new agent its own voice, and not to ask for it', async () => {
    const text = await readFile(SKILL_SOURCE_PATH, 'utf8');
    expect(text).toMatch(/give it a voice/i);
    expect(text).toMatch(/do not ask the user for/i);
  });

  /**
   * I7. Spec §6.2: "A user who dialled the orchestrator down gets a plain-spoken
   * crew." This step used to instruct a world-drawn voice unconditionally, so
   * the one user who had explicitly asked for plain speech met their next agent
   * in the dialect they had already declined — and the dial-down reached
   * exactly one agent in a network the whole point of which is that it grows.
   */
  it('mirrors the orchestrator’s own voice rather than imposing one', async () => {
    const text = await readFile(SKILL_SOURCE_PATH, 'utf8');
    expect(text).toMatch(/read your `## Voice` section/i);
    expect(text).toMatch(/if yours says to speak plainly, theirs says the\s+same/i);
    expect(text).toContain('Speak plainly. No accent, no mannerisms, no performance.');
  });

  /**
   * And the specialist's voice arrives with the rules attached. A voice
   * description handed over on its own is the roleplay this feature is
   * deliberately not: it is the guard rules, not the diction, that keep an
   * agent able to say "I can't do that" plainly.
   */
  it('gives the specialist the same voice-not-roleplay rules the orchestrator has', async () => {
    const text = await readFile(SKILL_SOURCE_PATH, 'utf8');
    expect(text).toMatch(/never invents facts/i);
    expect(text).toMatch(/obscure the answer it drops it/i);
    expect(text).toMatch(/soften bad news/i);
  });

  it('gives the specialist the dial-down instruction too', async () => {
    const text = await readFile(SKILL_SOURCE_PATH, 'utf8');
    expect(text).toMatch(/asks\s+it to speak plainly it rewrites/i);
    expect(text).toMatch(/without asking again/i);
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

// D2 (2026-08-18 walkthrough): a profile created bare inherits neither the
// home's provider config nor its keys — it auto-detects a provider and lands
// on one the account cannot use, so the specialist errors on its first
// message while the orchestrator reports success. Reproduced through the
// plain CLI with Circe not running, and fixed by Hermes' own `--clone`.
describe('the new profile can actually reach a model', () => {
  it('creates the profile as a clone, so it inherits config.yaml and .env', async () => {
    const text = await readFile(SKILL_SOURCE_PATH, 'utf8');
    expect(text).toMatch(/hermes profile create <id> --clone/);
  });

  // Cloning copies the source profile's skills wholesale, and the source is
  // the orchestrator — so without this the specialist inherits the skill for
  // creating peers. One coordinator, not a franchise.
  it('removes its own skill from the clone', async () => {
    const text = await readFile(SKILL_SOURCE_PATH, 'utf8');
    expect(text).toMatch(/skills\/circe-orchestrator/);
    expect(text.indexOf('--clone')).toBeLessThan(text.indexOf('skills/circe-orchestrator'));
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
