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
