import { describe, expect, it } from 'vitest';
import {
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
import { FakeHermes, INSTALLED_EMPTY, SCAFFOLD_SOUL } from './fake/hermes';
import type { HermesProfile, Palette } from '../src/shared/types';

const PALETTE: Palette = { bg: '#1e2952', border: '#c7d2fe', accent: '#a5b4fc' };
const REAL_SOUL = '# Trillian — the one who keeps the plot\n\nYou are **Trillian**.\n';

function profile(over: Partial<HermesProfile> = {}): HermesProfile {
  return { id: 'default', displayName: 'Trillian', model: 'claude-opus-5', isReal: true, ...over };
}

describe('resolveStartup', () => {
  it('opens onboarding when SOUL.md is the stock scaffold', () => {
    expect(resolveStartup(null, SCAFFOLD_SOUL)).toEqual({ kind: 'wizard' });
  });

  it('opens onboarding when there is no SOUL.md at all', () => {
    expect(resolveStartup(null, null)).toEqual({ kind: 'wizard' });
  });

  // SOUL.md is the authority: a hand-edited persona keeps its agent rather than
  // being sent back through a wizard whose next move is to overwrite it.
  it('opens the fleet when a persona exists, with no record at all', () => {
    expect(resolveStartup(null, REAL_SOUL)).toEqual({ kind: 'fleet', mainProfileId: 'default' });
  });

  it('foregrounds the profile the record names', () => {
    const record = serializeLastLaunch('ford');
    expect(resolveStartup(record, REAL_SOUL)).toEqual({ kind: 'fleet', mainProfileId: 'ford' });
  });

  it('falls back to default for a corrupt record', () => {
    expect(resolveStartup('{ broken', REAL_SOUL)).toEqual({
      kind: 'fleet',
      mainProfileId: 'default',
    });
  });

  // A v1 record carries a `character` block this build would half-read.
  it('falls back to default for a v1 record', () => {
    const v1 = JSON.stringify({ version: 1, profileId: 'ford', character: { name: 'Ford' } });
    expect(resolveStartup(v1, REAL_SOUL)).toEqual({ kind: 'fleet', mainProfileId: 'default' });
  });
});

describe('serializeLastLaunch', () => {
  it('records the main operator and nothing about who they are', () => {
    const record = JSON.parse(serializeLastLaunch('ford'));
    expect(record).toEqual({ version: 2, mainProfileId: 'ford' });
  });
});

describe('characterFor', () => {
  it('takes identity from SOUL.md and colours from the profile', async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    await hermes.writeHomeFile('SOUL.md', REAL_SOUL);
    await hermes.writeHomeFile('circe.json', serializeProfileTheme(PALETTE));

    expect(await characterFor(hermes, profile())).toEqual({
      name: 'Trillian',
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
    await migrateV1Palette(hermes, serializeLastLaunch('default'));
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
  it('opens the fleet for a configured install', async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    await hermes.writeHomeFile('SOUL.md', REAL_SOUL);

    expect(await readStartup(hermes)).toEqual({ kind: 'fleet', mainProfileId: 'default' });
  });

  it("honours the record's main operator", async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    await hermes.writeHomeFile('SOUL.md', REAL_SOUL);
    await hermes.writeHomeFile(LAST_LAUNCH_PATH, serializeLastLaunch('ford'));

    expect(await readStartup(hermes)).toEqual({ kind: 'fleet', mainProfileId: 'ford' });
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
  it('reads a v2 record', () => {
    expect(parseLastLaunch(serializeLastLaunch('ford'))).toEqual({
      version: 2,
      mainProfileId: 'ford',
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
