import { describe, expect, it } from 'vitest';
import { Wizard } from '../src/main/wizard';
import {
  FakeHermes,
  FRESH_MACHINE,
  INSTALLED_EMPTY,
  INSTALLED_WITH_AGENTS,
  type Scenario,
} from './fake/hermes';

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
