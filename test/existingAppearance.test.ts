import { describe, expect, it } from 'vitest';
import {
  ensureRetainedTheme,
  retainedPalette,
} from '../src/main/existingAppearance';
import { parseProfileTheme } from '../src/main/profileTheme';
import { FakeHermes, INSTALLED_WITH_AGENTS } from './fake/hermes';

describe('retained fleet appearances', () => {
  it('treats a familiar retained identity like any other profile', async () => {
    const hermes = new FakeHermes(INSTALLED_WITH_AGENTS);
    const zaphod = (await hermes.listProfiles()).find((profile) => profile.id === 'zaphod')!;

    const palette = await ensureRetainedTheme(hermes, zaphod);

    expect(palette).toEqual(retainedPalette(zaphod.id, zaphod.displayName));
    expect(palette).not.toEqual({ bg: '#691969', border: '#e879f9', accent: '#e879f9' });
    expect(
      parseProfileTheme(await hermes.readHomeFile('profiles/zaphod/circe.json')),
    ).toEqual(palette);
  });

  it('gives an unknown retained identity a stable coloured palette', async () => {
    const hermes = new FakeHermes({
      version: '0.14.0',
      hasProvider: true,
      files: { 'profiles/writer/SOUL.md': '# Writer — writes clearly\n' },
      models: { writer: 'model' },
    });
    const writer = (await hermes.listProfiles()).find((profile) => profile.id === 'writer')!;

    const first = await ensureRetainedTheme(hermes, writer);
    const second = retainedPalette('writer', 'Writer');

    expect(first).toEqual(second);
    expect(first.bg).not.toBe('#1c1c1e');
  });

  it('never replaces an existing theme while retaining an identity', async () => {
    const original = '{"version":1,"palette":{"bg":"#123456","border":"#abcdef","accent":"#fedcba"}}';
    const hermes = new FakeHermes({
      version: '0.14.0',
      hasProvider: true,
      files: {
        'profiles/zaphod/SOUL.md': '# Zaphod — a specialist\n',
        'profiles/zaphod/circe.json': original,
      },
      models: { zaphod: 'model' },
    });
    const zaphod = (await hermes.listProfiles())[0]!;

    await ensureRetainedTheme(hermes, zaphod);

    expect(await hermes.readHomeFile('profiles/zaphod/circe.json')).toBe(original);
  });
});
