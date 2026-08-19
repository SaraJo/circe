import { describe, expect, it } from 'vitest';
import { Wizard } from '../src/main/wizard';
import {
  FakeHermes,
  FRESH_MACHINE,
  INSTALLED_EMPTY,
  INSTALLED_WITH_AGENTS,
  type Scenario,
} from './fake/hermes';
import { LAST_LAUNCH_PATH } from '../src/main/startup';
// Pulled from a leaf module (not `../src/renderer/wizard/main`) on purpose:
// `main.ts` touches `document`/`window.circe` at module load, which does not
// exist under this suite's `node` test environment. `copy.ts` is pure data,
// so it can be asserted against directly without a DOM.
import {
  COPY,
  FANDOM_IDEAS,
  fill,
  isReplaceableExample,
  nextFandomIdea,
} from '../src/renderer/wizard/copy';

const REPLY = JSON.stringify({
  name: 'Trillian',
  tagline: 'the one who keeps the plot',
  palette: { bg: '#1e2952', border: '#c7d2fe', accent: '#a5b4fc' },
  why: 'She tracks what everyone else is doing.',
});

function scenario(base: Scenario): Scenario {
  return { ...base, replies: [{ match: 'coordinator', reply: REPLY }] };
}

async function toMeet(base: Scenario) {
  const hermes = new FakeHermes(scenario(base));
  const w = new Wizard(hermes);
  await w.start();
  await w.submitFandom("Hitchhiker's Guide to the Galaxy");
  return { hermes, w };
}

describe('a machine with no Hermes', () => {
  it('stops at the install screen', async () => {
    const w = new Wizard(new FakeHermes(FRESH_MACHINE));
    await w.start();
    expect(w.state.kind).toBe('runtime-missing');
  });
});

describe('a fresh Hermes install', () => {
  it('goes straight to the fandom question', async () => {
    const w = new Wizard(new FakeHermes(scenario(INSTALLED_EMPTY)));
    await w.start();
    expect(w.state.kind).toBe('fandom');
  });

  it('derives a character and lands on the meet screen', async () => {
    const { w } = await toMeet(INSTALLED_EMPTY);
    expect(w.state).toMatchObject({ kind: 'meet', character: { name: 'Trillian' } });
  });

  it('claims the default profile on accept', async () => {
    const { hermes, w } = await toMeet(INSTALLED_EMPTY);
    await w.accept();
    expect(w.state).toMatchObject({ kind: 'launching', profileId: 'default' });
    const soul = await hermes.readHomeFile('SOUL.md');
    expect(soul).toContain('# Trillian — the one who keeps the plot');
  });

  it('installs the orchestrator skill on accept', async () => {
    const { hermes, w } = await toMeet(INSTALLED_EMPTY);
    await w.accept();
    expect(await hermes.readHomeFile('skills/circe-orchestrator/SKILL.md')).toContain(
      'Growing the network',
    );
  });

  it('does not back up an untouched scaffold', async () => {
    const { hermes, w } = await toMeet(INSTALLED_EMPTY);
    await w.accept();
    const backups = [...hermes.files.keys()].filter((k) => k.includes('.bak-'));
    expect(backups).toEqual([]);
  });

  it('records the launch so the next cold start can reopen the tile', async () => {
    const { hermes, w } = await toMeet(INSTALLED_EMPTY);

    await w.accept();

    const record = JSON.parse((await hermes.readHomeFile(LAST_LAUNCH_PATH))!);
    expect(record).toEqual({ version: 2, mainProfileId: 'default' });
  });

  it('still launches when the record cannot be written', async () => {
    // The record is a convenience: losing it costs the tile's colours on the
    // next launch, nothing more. Failing the launch over it would trade the
    // user's working agent for a cache write.
    const hermes = new FakeHermes(scenario(INSTALLED_EMPTY));
    const realWrite = hermes.writeHomeFile.bind(hermes);
    hermes.writeHomeFile = async (rel: string, contents: string) => {
      if (rel === LAST_LAUNCH_PATH) throw new Error('EACCES');
      return realWrite(rel, contents);
    };
    const w = new Wizard(hermes);
    await w.start();
    await w.submitFandom("Hitchhiker's Guide to the Galaxy");

    await w.accept();

    expect(w.state).toMatchObject({ kind: 'launching', profileId: 'default' });
  });

  it("writes the character's colours into the profile", async () => {
    const { hermes, w } = await toMeet(INSTALLED_EMPTY);

    await w.accept();

    const theme = JSON.parse((await hermes.readHomeFile('circe.json'))!);
    expect(theme).toEqual({
      version: 1,
      palette: { bg: '#1e2952', border: '#c7d2fe', accent: '#a5b4fc' },
    });
  });

  it('still launches when the colours cannot be written', async () => {
    // Colours are not worth trading a working agent for. The persona is already
    // on disk by this point and must not be rolled back (ruling F-1).
    const hermes = new FakeHermes(scenario(INSTALLED_EMPTY));
    const realWrite = hermes.writeHomeFile.bind(hermes);
    hermes.writeHomeFile = async (rel: string, contents: string) => {
      if (rel === 'circe.json') throw new Error('EACCES');
      return realWrite(rel, contents);
    };
    const w = new Wizard(hermes);
    await w.start();
    await w.submitFandom("Hitchhiker's Guide to the Galaxy");

    await w.accept();

    expect(w.state).toMatchObject({ kind: 'launching', profileId: 'default' });
    expect(await hermes.readHomeFile('SOUL.md')).toContain('# Trillian');
  });
});

describe('a machine that already has agents', () => {
  it('warns before claiming a default the user configured', async () => {
    const { w } = await toMeet(INSTALLED_WITH_AGENTS);
    expect(w.state).toMatchObject({ kind: 'claim-default', existingName: 'Trillian' });
  });

  it('backs the old persona up when the user confirms', async () => {
    const { hermes, w } = await toMeet(INSTALLED_WITH_AGENTS);
    await w.confirmClaimDefault();
    const backups = [...hermes.files.keys()].filter((k) => k.startsWith('SOUL.md.bak-'));
    expect(backups).toHaveLength(1);
    expect(hermes.files.get(backups[0]!)).toContain('Central Coordinator');
  });

  it('leaves every existing profile untouched either way', async () => {
    const { hermes, w } = await toMeet(INSTALLED_WITH_AGENTS);
    const before = await hermes.readHomeFile('profiles/ford/SOUL.md');
    await w.confirmClaimDefault();
    expect(await hermes.readHomeFile('profiles/ford/SOUL.md')).toBe(before);
  });

  it('writes nothing at all when the user declines', async () => {
    const { hermes, w } = await toMeet(INSTALLED_WITH_AGENTS);
    const snapshot = new Map(hermes.files);
    w.declineClaimDefault();
    expect(w.state.kind).toBe('fandom');
    expect(hermes.files).toEqual(snapshot);
  });
});

describe('derivation failure', () => {
  it('offers a retry rather than dead-ending', async () => {
    const hermes = new FakeHermes({ ...INSTALLED_EMPTY, replies: [{ match: 'zzz', reply: '{}' }] });
    const w = new Wizard(hermes);
    await w.start();
    await w.submitFandom('anything');
    expect(w.state.kind).toBe('derive-failed');
  });
});

describe('no provider', () => {
  it('asks for one before the fandom question, since derivation needs it', async () => {
    const w = new Wizard(new FakeHermes({ ...INSTALLED_EMPTY, hasProvider: false }));
    await w.start();
    expect(w.state.kind).toBe('provider-missing');
  });
});

describe('overlapping derivations', () => {
  it('drops a stale derivation once a newer submission has already resolved', async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    const w = new Wizard(hermes);
    await w.start();

    // Replace `query` with one we resolve by hand, so the test controls
    // exactly which of two in-flight derivations settles first — no
    // reliance on real timing.
    const pending: Array<{ prompt: string; resolve: (reply: string) => void }> = [];
    hermes.query = (_profileId: string, prompt: string) =>
      new Promise<string>((resolve) => {
        pending.push({ prompt, resolve });
      });

    const first = w.submitFandom('Star Trek');
    const second = w.submitFandom("Hitchhiker's Guide to the Galaxy");
    expect(pending).toHaveLength(2);

    const picardReply = JSON.stringify({
      name: 'Picard',
      tagline: 'the one who keeps the peace',
      palette: { bg: '#1a1a2e', border: '#cccccc', accent: '#e5c07b' },
      why: 'He commands the ship.',
    });

    // The *second* submission (Hitchhiker's) resolves first...
    pending[1]!.resolve(REPLY);
    await second;
    // ...and the *first* (Star Trek) resolves last, and stale.
    pending[0]!.resolve(picardReply);
    await first;

    // The state must reflect the last-issued submission, not the
    // last-resolved one.
    expect(w.state).toMatchObject({ kind: 'meet', character: { name: 'Trillian' } });
  });

  it('refuses to run from a state where a fandom submission makes no sense', async () => {
    const hermes = new FakeHermes({ ...INSTALLED_EMPTY, hasProvider: false });
    const w = new Wizard(hermes);
    await w.start();
    expect(w.state.kind).toBe('provider-missing');

    await w.submitFandom('anything');

    expect(w.state.kind).toBe('provider-missing');
    expect(hermes.queries).toEqual([]);
  });
});

describe('double-clicked accept', () => {
  it('does not double-run accept when called twice before the first settles', async () => {
    const { hermes, w } = await toMeet(INSTALLED_EMPTY);
    // Simulate a real persona already sitting at SOUL.md — the exact
    // condition under which a second, unguarded accept() would back up
    // Circe's own freshly-written persona instead of the user's.
    hermes.files.set('SOUL.md', '# Someone Else — an existing persona\n\nHand-written.\n');

    const p1 = w.accept();
    const p2 = w.accept();
    await Promise.all([p1, p2]);

    expect(w.state.kind).toBe('launching');
    const backups = [...hermes.files.keys()].filter((k) => k.startsWith('SOUL.md.bak-'));
    expect(backups).toHaveLength(1);
    expect(hermes.files.get(backups[0]!)).toContain('Someone Else');
    expect(hermes.files.get(backups[0]!)).not.toContain('Trillian');
    const soul = await hermes.readHomeFile('SOUL.md');
    expect(soul).toContain('# Trillian — the one who keeps the plot');
  });

  it('refuses to run directly from claim-default, but confirmClaimDefault still works', async () => {
    const { hermes, w } = await toMeet(INSTALLED_WITH_AGENTS);
    expect(w.state.kind).toBe('claim-default');
    const snapshot = new Map(hermes.files);

    await w.accept();

    expect(w.state.kind).toBe('claim-default');
    expect(hermes.files).toEqual(snapshot);

    await w.confirmClaimDefault();

    expect(w.state.kind).toBe('launching');
    const soul = await hermes.readHomeFile('SOUL.md');
    expect(soul).toContain('# Trillian — the one who keeps the plot');
  });
});

describe('retryDerivation entry guard', () => {
  it('does nothing from launching, after an awaited accept', async () => {
    const { hermes, w } = await toMeet(INSTALLED_EMPTY);
    await w.accept();
    expect(w.state.kind).toBe('launching');
    const queriesBefore = hermes.queries.length;

    await w.retryDerivation();

    expect(w.state.kind).toBe('launching');
    expect(hermes.queries).toHaveLength(queriesBefore);
  });

  it('does nothing from provider-missing, even with a stale character still held', async () => {
    // Derive once for real, so a character is sitting in the private field,
    // then simulate the provider disconnecting and the caller re-running
    // start() — a path the class doesn't forbid. accept() was never called,
    // so nothing has cleared the character; the entry guard is the only
    // thing standing between this and a real query.
    const testScenario = scenario(INSTALLED_EMPTY);
    const hermes = new FakeHermes(testScenario);
    const w = new Wizard(hermes);
    await w.start();
    await w.submitFandom("Hitchhiker's Guide to the Galaxy");
    expect(w.state).toMatchObject({ kind: 'meet', character: { name: 'Trillian' } });

    testScenario.hasProvider = false;
    await w.start();
    expect(w.state.kind).toBe('provider-missing');
    const queriesBefore = hermes.queries.length;

    await w.retryDerivation();

    expect(w.state.kind).toBe('provider-missing');
    expect(hermes.queries).toHaveLength(queriesBefore);
  });

  it('still re-derives from meet — the escape hatch stays open', async () => {
    const { hermes, w } = await toMeet(INSTALLED_EMPTY);
    expect(w.state.kind).toBe('meet');
    const queriesBefore = hermes.queries.length;

    await w.retryDerivation();

    expect(hermes.queries.length).toBeGreaterThan(queriesBefore);
    expect(w.state).toMatchObject({ kind: 'meet', character: { name: 'Trillian' } });
  });

  it('still re-derives from claim-default — the escape hatch stays open', async () => {
    const { hermes, w } = await toMeet(INSTALLED_WITH_AGENTS);
    expect(w.state.kind).toBe('claim-default');
    const queriesBefore = hermes.queries.length;

    await w.retryDerivation();

    expect(hermes.queries.length).toBeGreaterThan(queriesBefore);
    expect(w.state).toMatchObject({ kind: 'claim-default', existingName: 'Trillian' });
  });
});

describe('write ordering', () => {
  // The defect this covers: `commitAccept` used to announce `launching`
  // *before* the writes. `set()` notifies synchronously and `index.ts` reacts
  // to `launching` by spawning `hermes -p default acp`, which reads SOUL.md at
  // startup — so the agent raced the write that gives it its persona, and the
  // user could meet the scaffold Hermes instead of their character.
  it('has both files on disk before it announces launching', async () => {
    const { hermes, w } = await toMeet(INSTALLED_EMPTY);

    const soulsAtEachStep: Array<{ kind: string; soul: string | null; skill: string | null }> = [];
    w.onChange((s) => {
      soulsAtEachStep.push({
        kind: s.kind,
        soul: hermes.files.get('SOUL.md') ?? null,
        skill: hermes.files.get('skills/circe-orchestrator/SKILL.md') ?? null,
      });
    });

    await w.accept();

    const launching = soulsAtEachStep.find((s) => s.kind === 'launching')!;
    expect(launching).toBeDefined();
    expect(launching.soul).toContain('# Trillian — the one who keeps the plot');
    expect(launching.skill).toContain('Growing the network');
  });

  it('shows a distinct saving state while the writes are in flight', async () => {
    const { w } = await toMeet(INSTALLED_EMPTY);
    const kinds: string[] = [];
    w.onChange((s) => kinds.push(s.kind));

    await w.accept();

    expect(kinds).toEqual(['saving', 'launching']);
  });

  it('still refuses a second accept issued before the first settles', async () => {
    const { hermes, w } = await toMeet(INSTALLED_EMPTY);
    hermes.files.set('SOUL.md', '# Someone Else — an existing persona\n\nHand-written.\n');

    const p1 = w.accept();
    const p2 = w.accept();
    await Promise.all([p1, p2]);

    expect(w.state.kind).toBe('launching');
    const backups = [...hermes.files.keys()].filter((k) => k.startsWith('SOUL.md.bak-'));
    expect(backups).toHaveLength(1);
    expect(hermes.files.get(backups[0]!)).toContain('Someone Else');
  });
});

describe('a write that fails', () => {
  function failingOnWrite(base: Scenario, message: string) {
    const hermes = new FakeHermes(scenario(base));
    hermes.writeHomeFile = async () => {
      throw new Error(message);
    };
    return hermes;
  }

  it('lands on write-failed with the underlying error, and launches nothing', async () => {
    const hermes = failingOnWrite(INSTALLED_EMPTY, 'EACCES: permission denied');
    const w = new Wizard(hermes);
    await w.start();
    await w.submitFandom("Hitchhiker's Guide to the Galaxy");

    await w.accept();

    expect(w.state).toMatchObject({
      kind: 'write-failed',
      character: { name: 'Trillian' },
      message: expect.stringContaining('EACCES'),
    });
  });

  it('does not reject: an unhandled rejection is what left the wizard stuck', async () => {
    const hermes = failingOnWrite(INSTALLED_EMPTY, 'disk full');
    const w = new Wizard(hermes);
    await w.start();
    await w.submitFandom("Hitchhiker's Guide to the Galaxy");

    await expect(w.accept()).resolves.toBeUndefined();
  });

  it('refuses to write at all when the existing persona cannot be read', async () => {
    // Finding 4's path: a SOUL.md that exists but can't be read must never be
    // silently overwritten. There is nothing to back up with — the bytes were
    // refused — so the only non-destructive outcome is to refuse the write.
    const hermes = new FakeHermes(scenario(INSTALLED_WITH_AGENTS));
    const written: string[] = [];
    const realWrite = hermes.writeHomeFile.bind(hermes);
    hermes.writeHomeFile = async (rel: string, contents: string) => {
      written.push(rel);
      return realWrite(rel, contents);
    };
    hermes.readHomeFile = async (rel: string) => {
      if (rel === 'SOUL.md') throw new Error('Cannot read /fake/home/SOUL.md (EACCES)');
      return hermes.files.get(rel) ?? null;
    };
    const w = new Wizard(hermes);
    await w.start();
    await w.submitFandom("Hitchhiker's Guide to the Galaxy");
    expect(w.state.kind).toBe('claim-default');

    await w.confirmClaimDefault();

    expect(w.state).toMatchObject({
      kind: 'write-failed',
      message: expect.stringContaining('Refusing to overwrite SOUL.md'),
    });
    expect(written).toEqual([]);
    expect(hermes.files.get('SOUL.md')).toContain('Central Coordinator');
  });

  it('reports the persona as replaced when only the skill install failed', async () => {
    // Ruling F-1. `commitAccept` writes SOUL.md and *then* installs the skill,
    // under one `catch`. If the skill install is what failed, the persona has
    // already been replaced and a backup taken — so the write-failed screen
    // must not go on claiming the user's setup is untouched, and must be able
    // to name the backup, or nobody will go looking for it.
    const hermes = new FakeHermes(scenario(INSTALLED_WITH_AGENTS));
    const realWrite = hermes.writeHomeFile.bind(hermes);
    hermes.writeHomeFile = async (rel: string, contents: string) => {
      if (rel.startsWith('skills/')) throw new Error('EACCES: skills dir is read-only');
      return realWrite(rel, contents);
    };
    const w = new Wizard(hermes);
    await w.start();
    await w.submitFandom("Hitchhiker's Guide to the Galaxy");

    await w.confirmClaimDefault();

    expect(w.state).toMatchObject({
      kind: 'write-failed',
      message: expect.stringContaining('EACCES'),
      personaReplaced: { path: 'SOUL.md', backedUpTo: expect.stringContaining('SOUL.md.') },
    });
  });

  it('reports no persona replacement when the soul write itself failed', async () => {
    const hermes = failingOnWrite(INSTALLED_EMPTY, 'EACCES: permission denied');
    const w = new Wizard(hermes);
    await w.start();
    await w.submitFandom("Hitchhiker's Guide to the Galaxy");

    await w.accept();

    expect(w.state).toMatchObject({ kind: 'write-failed', personaReplaced: null });
  });

  it('can be retried, and succeeds once the write works', async () => {
    const hermes = new FakeHermes(scenario(INSTALLED_EMPTY));
    const realWrite = hermes.writeHomeFile.bind(hermes);
    let failing = true;
    hermes.writeHomeFile = async (rel: string, contents: string) => {
      if (failing) throw new Error('transient');
      return realWrite(rel, contents);
    };
    const w = new Wizard(hermes);
    await w.start();
    await w.submitFandom("Hitchhiker's Guide to the Galaxy");
    await w.accept();
    expect(w.state.kind).toBe('write-failed');

    failing = false;
    await w.accept();

    expect(w.state).toMatchObject({ kind: 'launching', profileId: 'default' });
    expect(hermes.files.get('SOUL.md')).toContain('# Trillian — the one who keeps the plot');
  });
});

describe('a derivation superseded during the profile listing', () => {
  // The window this closes: `runDerivation` re-checked its generation token
  // before `listProfiles()` but not after, so a run superseded during that
  // round trip still pushed its own meet/claim-default — and could overwrite
  // `launching`, re-opening accept()'s guard for a second write.
  it('drops its result rather than pushing a screen over a newer run', async () => {
    const hermes = new FakeHermes(scenario(INSTALLED_EMPTY));
    const w = new Wizard(hermes);
    await w.start();

    // Hold listProfiles open so the test controls when the first derivation
    // resumes — that is the exact await the stale check was missing.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let announceEntry!: () => void;
    const entered = new Promise<void>((resolve) => {
      announceEntry = resolve;
    });
    let held = true;
    const realList = hermes.listProfiles.bind(hermes);
    hermes.listProfiles = async () => {
      if (held) {
        held = false;
        announceEntry();
        await gate;
      }
      return realList();
    };

    const first = w.submitFandom('Star Trek');
    // Wait until the first run is genuinely parked inside listProfiles — the
    // generation bump has to land *during* that await, or the pre-await check
    // catches it and this proves nothing.
    await entered;

    const second = w.submitFandom("Hitchhiker's Guide to the Galaxy");
    await second;
    expect(w.state.kind).toBe('meet');

    // The user accepts, and the write completes: state is `launching`.
    await w.accept();
    expect(w.state.kind).toBe('launching');

    // Only now does the stale run resume.
    release();
    await first;

    expect(w.state).toMatchObject({ kind: 'launching', character: { name: 'Trillian' } });
  });
});

describe('onboarding copy (spec §1.4, amended 2026-08-18)', () => {
  // Onboarding explains itself to someone who has used a chatbot and never
  // configured an agent.
  it('says what a step is for before asking for it', () => {
    expect(COPY.fandom.lead).toMatch(/because|so that|so we can/i);
  });

  it('never cheerleads', () => {
    const all = Object.values(COPY).flatMap((s) => Object.values(s)).join(' ');
    expect(all).not.toMatch(/we're so excited|welcome aboard|let's do this!/i);
    expect(all.match(/!/g) ?? []).toHaveLength(0);
  });

  // I9: this rule, `glosses Hermes` and `never cheerleads` all walk `COPY`, so
  // they only see a screen once that screen's strings live in `COPY`. Five of
  // the eleven rendered screens kept their strings inline in `main.ts`'s
  // switch — including `claim-default`, which named Hermes with no gloss, and
  // `derive-failed`, the screen most likely to be seen. Pin the set, so a
  // future screen added straight into the switch fails here rather than
  // quietly opting itself out of every copy rule.
  it('holds the strings for every screen the wizard renders', () => {
    expect(Object.keys(COPY).sort()).toEqual(
      [
        'claimDefault',
        'deriveFailed',
        'deriving',
        'fandom',
        'launching',
        'meet',
        'provider',
        'runtime',
        'saving',
        'welcome',
        'writeFailed',
      ].sort(),
    );
  });

  // I3: the original version of this test only checked `COPY.runtime.lead`
  // in isolation, so it stayed green even after `welcome.status` — which
  // renders on the very first screen, before `runtime.lead` can ever be
  // shown — started naming Hermes with no gloss at all. This version walks
  // the flow in the order `Wizard.start()` actually shows it (welcome ->
  // runtime -> provider -> fandom -> deriving -> meet, field by field
  // within each) and checks whichever string turns out to be the *first*
  // one that names Hermes, whatever screen that happens to be on.
  it('glosses Hermes the first time it names it, wherever in the flow that first happens', () => {
    const order = [
      'welcome',
      'runtime',
      'provider',
      'fandom',
      'deriving',
      'deriveFailed',
      'claimDefault',
      'meet',
      'saving',
      'writeFailed',
      'launching',
    ] as const;
    const fields = order.flatMap((screen) => Object.values(COPY[screen]));
    const firstMention = fields.find((text) => /\bHermes\b/.test(text));
    expect(firstMention).toBeDefined();
    expect(firstMention).toMatch(/Hermes[^.]*(open-source|tool|software)/i);
  });

  it('speaks to the reader, not about the product', () => {
    expect(COPY.welcome.lead).toMatch(/\byou\b|\byour\b/i);
  });

  /**
   * I8. §6.2 Step 1 makes the welcome screen answer three questions, and the
   * third is "what happens next": you will meet a coordinator whose job is
   * helping you build the others. The warm rewrite traded that for "at the end
   * you'll meet the first one", which pushed the idea three screens later — so
   * the one place the spec says Circe gets to explain itself explained less
   * than the version it replaced.
   */
  it('says on the welcome screen that the agent it makes helps build the others', () => {
    const welcome = Object.values(COPY.welcome).join(' ');
    expect(welcome).toMatch(/coordinator|orchestrator/i);
    expect(welcome).toMatch(/build the (others|rest)/i);
  });

  // It is still one agent, never a fleet — §6.2's framing note governs every
  // screen, and "helps you build the others" is exactly the line that must not
  // drift into promising them.
  it('does not promise the others already exist', () => {
    const all = Object.values(COPY).flatMap((s) => Object.values(s)).join(' ');
    expect(all).not.toMatch(/your fleet|your agents are ready|set up your agents/i);
  });

  /**
   * M2. `main.ts` splits `deriving.lead` on `{{FANDOM}}` and destructures
   * `[before, after]`. Drop the placeholder in a copy edit and `after` is
   * `undefined`, so the screen renders the literal word "undefined" at the end
   * of the sentence. Same for the provider command, which `main.ts` splits to
   * wrap in a real `<code>`. `fill` is safe against a missing placeholder, but
   * silently drops the value, which is its own defect.
   */
  it('keeps the placeholders the renderer depends on', () => {
    expect(COPY.deriving.lead).toContain('{{FANDOM}}');
    expect(COPY.provider.lead).toContain('{{COMMAND}}');
    expect(COPY.meet.action).toContain('{{NAME}}');
    expect(COPY.saving.title).toContain('{{NAME}}');
    expect(COPY.launching.title).toContain('{{NAME}}');
    expect(COPY.claimDefault.lead).toContain('{{EXISTING}}');
    expect(COPY.claimDefault.lead).toContain('{{NAME}}');
    expect(COPY.writeFailed.untouched).toContain('{{NAME}}');
    expect(COPY.writeFailed.replaced).toContain('{{NAME}}');
    expect(COPY.writeFailed.replaced).toContain('{{PATH}}');
    expect(COPY.writeFailed.backedUp).toContain('{{BACKUP}}');
  });

  // M3: nothing in the wizard renders markdown, so a backticked command in the
  // copy reached the screen as literal backticks. The command is its own field
  // and `main.ts` puts it in a real `<code>`.
  it('ships no markdown the renderer will not render', () => {
    const all = Object.values(COPY).flatMap((s) => Object.values(s)).join(' ');
    expect(all).not.toContain('`');
    expect(all).not.toMatch(/\*\*/);
  });

  // M6: the label promised "some ideas" and one click delivered exactly one,
  // over the top of anything the user had typed. Same defect class as the "I
  // installed it" label already fixed.
  it('promises only the one example the button actually gives', () => {
    expect(COPY.fandom.stuck).not.toMatch(/ideas|some|several/i);
    expect(COPY.fandom.stuck).toMatch(/an example/i);
  });

  /**
   * Sara, 2026-08-19: no em dashes in anything Circe writes. Every screen here
   * is Circe's own prose, so the rule walks the whole of `COPY` the way the
   * other §1.4 rules do, and a new screen inherits it by being added to the
   * object rather than by anyone remembering.
   *
   * Scoped to Circe's writing on purpose: the character's `greeting`,
   * `voiceCheck` and `intro` are the model's words, and `derive.ts` asks for
   * them without em dashes rather than stripping them.
   */
  it('writes without em dashes', () => {
    const all = Object.values(COPY).flatMap((s) => Object.values(s)).join(' ');
    expect(all).not.toContain('\u2014');
  });
});

describe('the wizard copy helpers', () => {
  /**
   * M1. `COPY.meet.action.replace('{{NAME}}', c.name)` reintroduced the
   * `$`-pattern hazard `soulTemplate.ts` documents at length: a plain
   * replacement string still honours `$&`, `$$`, `` $` `` and `$'`, so a
   * character named `Trillian $&` rendered "Start with Trillian {{NAME}}" on
   * the primary button of the meet screen. Derived names come from a model and
   * are not sanitised anywhere — the defence has to be here.
   */
  it('substitutes a value containing $-patterns literally', () => {
    expect(fill('Start with {{NAME}}', { NAME: 'Trillian $&' })).toBe('Start with Trillian $&');
    expect(fill('{{NAME}} up…', { NAME: "Zaphod $` $' $$" })).toBe("Zaphod $` $' $$ up…");
  });

  it('fills every occurrence, and every placeholder it is given', () => {
    expect(fill('{{A}} {{B}} {{A}}', { A: 'one', B: 'two' })).toBe('one two one');
  });

  // M6: the only text the "give me an example" button may overwrite is an
  // example it put there itself. Anything the user typed is theirs.
  it('treats only an untouched field or its own last example as replaceable', () => {
    expect(isReplaceableExample('', null)).toBe(true);
    expect(isReplaceableExample('   ', null)).toBe(true);
    expect(isReplaceableExample(FANDOM_IDEAS[0]!, FANDOM_IDEAS[0]!)).toBe(true);
    expect(isReplaceableExample('the Wire', FANDOM_IDEAS[0]!)).toBe(false);
    // Typed by the user, not offered by the button — a membership test against
    // FANDOM_IDEAS could not tell these apart, and would clobber it.
    expect(isReplaceableExample(FANDOM_IDEAS[0]!, null)).toBe(false);
  });

  it('offers a different example each click, so the button keeps working', () => {
    for (const idea of FANDOM_IDEAS) expect(nextFandomIdea(idea)).not.toBe(idea);
  });
});
