import { describe, expect, it } from 'vitest';
import {
  archiveLastLaunch,
  characterFor,
  DEFAULT_PALETTE,
  LAST_LAUNCH_PATH,
  migrateV1Palette,
  parseLastLaunch,
  readStartup,
  resolveStartup,
  serializeLastLaunch,
} from '../src/main/startup';
import { serializeProfileTheme } from '../src/main/profileTheme';
import { installOrchestratorSkill } from '../src/main/orchestrator/skill';
import { FakeHermes, INSTALLED_EMPTY } from './fake/hermes';
import type { HermesProfile, Palette } from '../src/shared/types';

const PALETTE: Palette = { bg: '#1e2952', border: '#c7d2fe', accent: '#a5b4fc' };
const REAL_SOUL = '# Trillian — the one who keeps the plot\n\nYou are **Trillian**.\n';

function profile(over: Partial<HermesProfile> = {}): HermesProfile {
  return { id: 'default', displayName: 'Trillian', model: 'claude-opus-5', isReal: true, ...over };
}

describe('resolveStartup', () => {
  it('opens onboarding or adoption when Circe has no setup record', () => {
    expect(resolveStartup(null)).toEqual({ kind: 'wizard' });
  });

  it('foregrounds the profile the record names', () => {
    const record = serializeLastLaunch('ford', 'ford');
    expect(resolveStartup(record)).toEqual({
      kind: 'fleet',
      mainProfileId: 'ford',
      orchestratorProfileId: 'ford',
      ignoredProfileIds: [],
    });
  });

  it('opens adoption for a corrupt record rather than guessing setup completed', () => {
    expect(resolveStartup('{ broken')).toEqual({ kind: 'wizard' });
  });

  // A v1 record carries a `character` block this build would half-read.
  it('opens adoption for a v1 record after its palette migration', () => {
    const v1 = JSON.stringify({ version: 1, profileId: 'ford', character: { name: 'Ford' } });
    expect(resolveStartup(v1)).toEqual({ kind: 'wizard' });
  });
});

describe('serializeLastLaunch', () => {
  it('records the foreground profile and the chosen orchestrator explicitly', () => {
    const record = JSON.parse(serializeLastLaunch('ford', 'trillian'));
    expect(record).toEqual({
      version: 3,
      mainProfileId: 'ford',
      orchestratorProfileId: 'trillian',
      ignoredProfileIds: [],
    });
  });

  it('records profiles the user excluded from Circe without hiding the main profile', () => {
    expect(JSON.parse(serializeLastLaunch('ford', null, ['writer', 'ford', 'writer']))).toMatchObject({
      ignoredProfileIds: ['writer'],
    });
  });

  it('records an explicit decision to skip orchestration', () => {
    expect(JSON.parse(serializeLastLaunch('ford', null))).toMatchObject({
      version: 3,
      orchestratorProfileId: null,
    });
  });
});

describe('archiveLastLaunch', () => {
  it('moves only the onboarding marker to a timestamped backup', async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    const record = serializeLastLaunch('default', 'default');
    await hermes.writeHomeFile(LAST_LAUNCH_PATH, record);
    await hermes.writeHomeFile('circe/state.json', '{"tabs":"preserved"}');

    const backup = await archiveLastLaunch(hermes, new Date('2026-08-27T13:54:00.000Z'));

    expect(backup).toBe('circe/last-launch.json.bak-20260827T135400Z');
    expect(await hermes.readHomeFile(LAST_LAUNCH_PATH)).toBeNull();
    expect(await hermes.readHomeFile(backup!)).toBe(record);
    expect(await hermes.readHomeFile('SOUL.md')).toBe(INSTALLED_EMPTY.files['SOUL.md']);
    expect(await hermes.readHomeFile('circe/state.json')).toBe('{"tabs":"preserved"}');
  });

  it('does nothing when onboarding has not completed', async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    await expect(archiveLastLaunch(hermes)).resolves.toBeNull();
  });

  it('does not overwrite an existing backup with the same timestamp', async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    await hermes.writeHomeFile(LAST_LAUNCH_PATH, 'current');
    await hermes.writeHomeFile('circe/last-launch.json.bak-20260827T135400Z', 'older');

    const backup = await archiveLastLaunch(hermes, new Date('2026-08-27T13:54:00.000Z'));

    expect(backup).toBe('circe/last-launch.json.bak-20260827T135400Z.1');
    expect(await hermes.readHomeFile('circe/last-launch.json.bak-20260827T135400Z')).toBe('older');
    expect(await hermes.readHomeFile(backup!)).toBe('current');
  });
});

describe('characterFor', () => {
  it('takes identity from SOUL.md and colours from the profile', async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    await hermes.writeHomeFile('SOUL.md', REAL_SOUL);
    await hermes.writeHomeFile('circe.json', serializeProfileTheme(PALETTE));

    expect(await characterFor(hermes, profile())).toEqual({
      name: 'Trillian',
      fullName: 'Trillian',
      wiki: '',
      wikiPage: 'Trillian',
      tagline: 'the one who keeps the plot',
      profileId: 'default',
      palette: PALETTE,
      why: '',
      fandom: '',
      voice: '',
      intro: '',
      greeting: '',
      voiceCheck: '',
    });
  });

  it('falls back to the neutral palette for a profile with no colours', async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    await hermes.writeHomeFile('profiles/ford/SOUL.md', '# Ford — the one who finds the exit\n');

    const c = await characterFor(hermes, profile({ id: 'ford', displayName: 'Ford' }));
    expect(c).toMatchObject({ name: 'Ford', profileId: 'ford', palette: DEFAULT_PALETTE });
  });

  // A profile whose SOUL.md cannot be parsed still has an agent behind it.
  it('falls back to the profile’s display name when the heading cannot be read', async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    hermes.readHomeFile = async () => {
      throw new Error('EACCES');
    };

    const c = await characterFor(hermes, profile({ id: 'ford', displayName: 'ford' }));
    expect(c).toMatchObject({ name: 'ford', tagline: '', palette: DEFAULT_PALETTE });
  });
});

describe('migrateV1Palette', () => {
  const V1 = JSON.stringify({
    version: 1,
    profileId: 'default',
    character: { name: 'Trillian', palette: PALETTE },
  });

  it('moves a v1 record’s colours into the profile', async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);

    await migrateV1Palette(hermes, V1);

    expect(JSON.parse((await hermes.readHomeFile('circe.json'))!)).toEqual({
      version: 1,
      palette: PALETTE,
    });
  });

  it('does not overwrite colours the profile already has', async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    const mine: Palette = { bg: '#000000', border: '#111111', accent: '#222222' };
    await hermes.writeHomeFile('circe.json', serializeProfileTheme(mine));

    await migrateV1Palette(hermes, V1);

    expect(JSON.parse((await hermes.readHomeFile('circe.json'))!).palette).toEqual(mine);
  });

  it('does nothing for a v2 record', async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    await migrateV1Palette(hermes, serializeLastLaunch('default', 'default'));
    expect(await hermes.readHomeFile('circe.json')).toBeNull();
  });

  it('does nothing when there is no record', async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    await migrateV1Palette(hermes, null);
    expect(await hermes.readHomeFile('circe.json')).toBeNull();
  });

  // Best-effort: a migration that throws would take the whole boot with it.
  it('swallows a write failure', async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    hermes.writeHomeFile = async () => {
      throw new Error('EACCES');
    };

    await expect(migrateV1Palette(hermes, V1)).resolves.toBeUndefined();
  });
});

describe('readStartup', () => {
  it('opens adoption and carries the configured profiles when Circe has no record', async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    await hermes.writeHomeFile('SOUL.md', REAL_SOUL);

    expect(await readStartup(hermes)).toEqual({
      kind: 'wizard',
      profiles: [expect.objectContaining({ id: 'default', displayName: 'Trillian', isReal: true })],
    });
  });

  it('finds named specialists even when the default profile is still a scaffold', async () => {
    const hermes = new FakeHermes({
      ...INSTALLED_EMPTY,
      files: {
        ...INSTALLED_EMPTY.files,
        'profiles/writer/SOUL.md': '# Writer — turns findings into prose\n',
      },
      models: { ...INSTALLED_EMPTY.models, writer: 'claude-opus-5' },
    });
    expect(await readStartup(hermes)).toEqual({
      kind: 'wizard',
      profiles: [
        expect.objectContaining({ id: 'default', displayName: 'default', isReal: false }),
        expect.objectContaining({ id: 'writer', displayName: 'Writer', isReal: true }),
      ],
    });
  });

  it('honours completed adoption when the default profile remains a scaffold', async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    await hermes.writeHomeFile(LAST_LAUNCH_PATH, serializeLastLaunch('writer', null));
    expect(await readStartup(hermes)).toEqual({
      kind: 'fleet', mainProfileId: 'writer', orchestratorProfileId: null, ignoredProfileIds: [],
    });
  });

  it("honours the record's main operator", async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    await hermes.writeHomeFile('SOUL.md', REAL_SOUL);
    await hermes.writeHomeFile(LAST_LAUNCH_PATH, serializeLastLaunch('ford', 'default'));

    expect(await readStartup(hermes)).toEqual({
      kind: 'fleet', mainProfileId: 'ford', orchestratorProfileId: 'default', ignoredProfileIds: [],
    });
  });

  // Pins the wiring itself: migrateV1Palette runs, and runs before the result
  // comes back, not just that it exists as a separate function.
  it('runs the migration on the way through', async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    await hermes.writeHomeFile('SOUL.md', REAL_SOUL);
    const v1 = JSON.stringify({
      version: 1,
      profileId: 'default',
      character: { name: 'Trillian', palette: PALETTE },
    });
    await hermes.writeHomeFile(LAST_LAUNCH_PATH, v1);

    await readStartup(hermes);

    expect(JSON.parse((await hermes.readHomeFile('circe.json'))!)).toEqual({
      version: 1,
      palette: PALETTE,
    });
  });

  it('migrates a v2 beta record and infers the installed orchestrator', async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    await hermes.writeHomeFile('SOUL.md', REAL_SOUL);
    await installOrchestratorSkill(hermes, 'default');
    await hermes.writeHomeFile(
      LAST_LAUNCH_PATH,
      JSON.stringify({ version: 2, mainProfileId: 'default' }),
    );

    expect(await readStartup(hermes)).toEqual({
      kind: 'fleet', mainProfileId: 'default', orchestratorProfileId: 'default', ignoredProfileIds: [],
    });
    expect(JSON.parse((await hermes.readHomeFile(LAST_LAUNCH_PATH))!)).toEqual({
      version: 3,
      mainProfileId: 'default',
      orchestratorProfileId: 'default',
      ignoredProfileIds: [],
    });
  });

  // The wizard is the safe landing: its own write path refuses to overwrite a
  // persona it could not read first, so an unreadable SOUL.md still can't be
  // destroyed.
  it('lands on the wizard rather than throwing when the home cannot be read', async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    hermes.readHomeFile = async () => {
      throw new Error('EACCES');
    };

    expect(await readStartup(hermes)).toEqual({ kind: 'wizard' });
  });
});

describe('parseLastLaunch', () => {
  it('reads a v3 record', () => {
    expect(parseLastLaunch(serializeLastLaunch('ford', 'trillian'))).toEqual({
      version: 3,
      mainProfileId: 'ford',
      orchestratorProfileId: 'trillian',
      ignoredProfileIds: [],
    });
  });

  it('keeps a v2 beta record launchable until readStartup can infer its orchestrator', () => {
    expect(parseLastLaunch(JSON.stringify({ version: 2, mainProfileId: 'ford' }))).toEqual({
      version: 3,
      mainProfileId: 'ford',
      orchestratorProfileId: null,
      ignoredProfileIds: [],
    });
  });

  it('rejects anything else', () => {
    expect(parseLastLaunch(null)).toBeNull();
    expect(parseLastLaunch('{ broken')).toBeNull();
    expect(parseLastLaunch(JSON.stringify({ version: 2 }))).toBeNull();
  });
});

describe('LAST_LAUNCH_PATH', () => {
  it('lives inside the Hermes home so HERMES_HOME redirects it', () => {
    expect(LAST_LAUNCH_PATH).toBe('circe/last-launch.json');
  });
});
