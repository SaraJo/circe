import { describe, expect, it } from 'vitest';
import {
  parseProfileTheme,
  readProfilePalette,
  serializeProfileTheme,
  THEME_FILE,
} from '../src/main/profileTheme';
import { DEFAULT_PALETTE } from '../src/main/palette';
import { profileFilePath } from '../src/main/hermes/runtime';
import { FakeHermes, INSTALLED_EMPTY } from './fake/hermes';
import type { Palette } from '../src/shared/types';

const PALETTE: Palette = { bg: '#1e2952', border: '#c7d2fe', accent: '#a5b4fc' };

describe('profileFilePath', () => {
  it('puts the default profile’s files at the home root', () => {
    expect(profileFilePath('default', THEME_FILE)).toBe('circe.json');
  });

  it('puts a named profile’s files under its own directory', () => {
    expect(profileFilePath('ford', THEME_FILE)).toBe('profiles/ford/circe.json');
  });
});

describe('parseProfileTheme', () => {
  it('round-trips a palette', () => {
    expect(parseProfileTheme(serializeProfileTheme(PALETTE))).toEqual(PALETTE);
  });

  it('answers null for an absent file', () => {
    expect(parseProfileTheme(null)).toBeNull();
  });

  it('answers null for unparseable JSON', () => {
    expect(parseProfileTheme('{ not json')).toBeNull();
  });

  it('answers null for a future version', () => {
    expect(parseProfileTheme(JSON.stringify({ version: 2, palette: PALETTE }))).toBeNull();
  });

  it('answers null when the palette is missing', () => {
    expect(parseProfileTheme(JSON.stringify({ version: 1 }))).toBeNull();
  });

  it('answers null for a non-object at the top level', () => {
    expect(parseProfileTheme('"a string"')).toBeNull();
    expect(parseProfileTheme('null')).toBeNull();
  });

  // A NaN channel reaches the stylesheet as `rgba(NaN, ...)`, which the browser
  // drops — an unstyled tile rather than a default-coloured one.
  it('answers null when a channel is not a six-digit hex colour', () => {
    for (const bad of ['red', '#fff', '#12345g', '', '#1234567']) {
      expect(parseProfileTheme(JSON.stringify({ version: 1, palette: { ...PALETTE, bg: bad } })))
        .toBeNull();
    }
  });

  it('answers null when a channel is not a string at all', () => {
    expect(parseProfileTheme(JSON.stringify({ version: 1, palette: { ...PALETTE, accent: 7 } })))
      .toBeNull();
  });
});

describe('readProfilePalette', () => {
  it('reads a profile’s own colours', async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    await hermes.writeHomeFile('profiles/ford/circe.json', serializeProfileTheme(PALETTE));

    expect(await readProfilePalette(hermes, 'ford')).toEqual(PALETTE);
  });

  it('falls back to the default palette when there is no file', async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    expect(await readProfilePalette(hermes, 'ford')).toEqual(DEFAULT_PALETTE);
  });

  it('falls back to the default palette when the file is corrupt', async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    await hermes.writeHomeFile('profiles/ford/circe.json', '{ broken');

    expect(await readProfilePalette(hermes, 'ford')).toEqual(DEFAULT_PALETTE);
  });

  // `readHomeFile` rejects for a file that exists but cannot be read. Colours
  // are not worth failing a tile over — §3.1: "it costs colours, never a tile".
  it('falls back to the default palette when the file cannot be read', async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    hermes.readHomeFile = async () => {
      throw new Error('EACCES');
    };

    expect(await readProfilePalette(hermes, 'ford')).toEqual(DEFAULT_PALETTE);
  });
});
