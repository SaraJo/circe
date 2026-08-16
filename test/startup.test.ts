import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PALETTE,
  LAST_LAUNCH_PATH,
  readStartup,
  resolveStartup,
  serializeLastLaunch,
} from '../src/main/startup';
import { FakeHermes, INSTALLED_EMPTY } from './fake/hermes';
import type { Character } from '../src/shared/types';

const VETINARI: Character = {
  name: 'Lord Havelock Vetinari',
  profileId: 'lord-havelock-vetinari',
  tagline: 'Patrician who orchestrates the city',
  palette: { bg: '#1a1a1a', border: '#8b7355', accent: '#c9a961' },
  why: 'He runs Ankh-Morpork by delegating to exactly the right person.',
  fandom: "Terry Pratchett's Discworld",
};

const CIRCE_SOUL = `# Lord Havelock Vetinari — Patrician who orchestrates the city\n\nYou are **Lord Havelock Vetinari**, the coordinator of this person's agent network.\n`;

/** What Hermes itself writes into a fresh home. No heading, so not a persona. */
const STOCK_SOUL =
  'You are Hermes Agent, an intelligent AI assistant created by Nous Research. ' +
  'You are helpful, knowledgeable, and direct.';

const record = (c: Character, profileId = 'default') =>
  serializeLastLaunch(c, profileId);

describe('resolveStartup', () => {
  it('opens the wizard when there is no persona at all', () => {
    expect(resolveStartup(null, null)).toEqual({ kind: 'wizard' });
  });

  it('opens the wizard when the persona is only the stock Hermes scaffold', () => {
    // A fresh HERMES_HOME already contains this — hermes writes it on first
    // use — so "file exists" is not the same as "an orchestrator exists".
    expect(resolveStartup(null, STOCK_SOUL)).toEqual({ kind: 'wizard' });
  });

  it('opens the wizard when a record survives but the persona is gone', () => {
    // The persona is the truth; the record is only presentation.
    expect(resolveStartup(record(VETINARI), null)).toEqual({ kind: 'wizard' });
  });

  it('opens the tile on the recorded character when persona and record agree', () => {
    expect(resolveStartup(record(VETINARI), CIRCE_SOUL)).toEqual({
      kind: 'tile',
      profileId: 'default',
      character: VETINARI,
    });
  });

  it('follows a hand-edited persona rather than the record', () => {
    // The user renamed their own coordinator. That is a legitimate edit to
    // their identity file, and the tile must show who the agent actually is —
    // not send them back through onboarding, which would overwrite it.
    const edited = '# Granny Weatherwax — headology, mostly\n\nYou are Granny.\n';

    const startup = resolveStartup(record(VETINARI), edited);

    expect(startup).toMatchObject({
      kind: 'tile',
      character: { name: 'Granny Weatherwax', tagline: 'headology, mostly' },
    });
  });

  it('keeps the recorded palette when following an edited persona', () => {
    // Colours live nowhere but the record — the persona file has none.
    const edited = '# Granny Weatherwax — headology, mostly\n';

    const startup = resolveStartup(record(VETINARI), edited);

    expect(startup).toMatchObject({ character: { palette: VETINARI.palette } });
  });

  it('opens the tile on a persona Circe never wrote, with a default palette', () => {
    // Someone else's coordinator — a hand-written SOUL.md, or one from before
    // Circe recorded anything. It is still a real coordinator, and offering to
    // replace it is the wrong opening move.
    const trillian = '# Trillian — Central Coordinator\n\nYou are **Trillian**.\n';

    expect(resolveStartup(null, trillian)).toEqual({
      kind: 'tile',
      profileId: 'default',
      character: {
        name: 'Trillian',
        profileId: 'default',
        tagline: 'Central Coordinator',
        palette: DEFAULT_PALETTE,
        why: '',
        fandom: '',
      },
    });
  });

  it('treats a corrupt record as no record rather than failing to start', () => {
    expect(resolveStartup('{not json', CIRCE_SOUL)).toMatchObject({
      kind: 'tile',
      character: { palette: DEFAULT_PALETTE },
    });
  });

  it('treats a record of the wrong shape as no record', () => {
    expect(resolveStartup('{"version":1}', CIRCE_SOUL)).toMatchObject({
      kind: 'tile',
      character: { palette: DEFAULT_PALETTE },
    });
  });

  it('ignores a record written by a future version', () => {
    const future = JSON.stringify({ version: 2, profileId: 'default', character: VETINARI });

    expect(resolveStartup(future, CIRCE_SOUL)).toMatchObject({
      kind: 'tile',
      character: { palette: DEFAULT_PALETTE },
    });
  });

  it('carries a persona with a name but no tagline', () => {
    expect(resolveStartup(null, '# Marvin\n\nYou are Marvin.\n')).toMatchObject({
      character: { name: 'Marvin', tagline: '' },
    });
  });
});

describe('readStartup', () => {
  it('reads the persona and record out of the Hermes home', async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    await hermes.writeHomeFile('SOUL.md', CIRCE_SOUL);
    await hermes.writeHomeFile(LAST_LAUNCH_PATH, serializeLastLaunch(VETINARI, 'default'));

    expect(await readStartup(hermes)).toEqual({
      kind: 'tile',
      profileId: 'default',
      character: VETINARI,
    });
  });

  it('falls back to the wizard when the persona exists but cannot be read', async () => {
    // `readHomeFile` rejects rather than returning null for an unreadable
    // file. Starting the wizard is safe: its own write path refuses to
    // overwrite a persona it could not read first.
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    hermes.readHomeFile = async () => {
      throw new Error('EACCES');
    };

    expect(await readStartup(hermes)).toEqual({ kind: 'wizard' });
  });

  it('opens the wizard on a home with nothing in it', async () => {
    expect(await readStartup(new FakeHermes(INSTALLED_EMPTY))).toEqual({ kind: 'wizard' });
  });
});

describe('serializeLastLaunch', () => {
  it('round-trips through resolveStartup', () => {
    const written = serializeLastLaunch(VETINARI, 'default');

    expect(resolveStartup(written, CIRCE_SOUL)).toEqual({
      kind: 'tile',
      profileId: 'default',
      character: VETINARI,
    });
  });
});
