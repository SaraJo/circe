import { describe, expect, it } from 'vitest';
import { FakeHermes, FRESH_MACHINE, INSTALLED_EMPTY, INSTALLED_WITH_AGENTS } from './fake/hermes';

describe('FakeHermes scenarios', () => {
  it('reports no version on a machine without Hermes', async () => {
    const h = new FakeHermes(FRESH_MACHINE);
    expect(await h.version()).toBeNull();
  });

  it('reports a version once Hermes is installed', async () => {
    const h = new FakeHermes(INSTALLED_EMPTY);
    expect(await h.version()).toBe('0.14.0');
  });

  it('finds only the scaffold default on a fresh Hermes install', async () => {
    const h = new FakeHermes(INSTALLED_EMPTY);
    const profiles = await h.listProfiles();
    expect(profiles.map((p) => p.id)).toEqual(['default']);
  });

  it('finds the whole crew on a machine that already has agents', async () => {
    const h = new FakeHermes(INSTALLED_WITH_AGENTS);
    const ids = (await h.listProfiles()).map((p) => p.id);
    expect(ids).toContain('default');
    expect(ids).toContain('ford');
    expect(ids).toHaveLength(8);
  });

  it('reads named-profile fixtures as configured agents on every platform', async () => {
    const h = new FakeHermes({
      version: '0.14.0', hasProvider: true,
      files: { 'profiles/writer/SOUL.md': '# Writer — writes clearly\n' },
      models: { writer: 'test-model' },
    });
    expect(await h.listProfiles()).toEqual([{
      id: 'writer', displayName: 'Writer', model: 'test-model', isReal: true,
    }]);
  });

  it('round-trips a file written under the Hermes home', async () => {
    const h = new FakeHermes(INSTALLED_EMPTY);
    await h.writeHomeFile('SOUL.md', '# Zaphod — two heads');
    expect(await h.readHomeFile('SOUL.md')).toBe('# Zaphod — two heads');
  });

  it('returns null reading a file that is not there', async () => {
    const h = new FakeHermes(INSTALLED_EMPTY);
    expect(await h.readHomeFile('profiles/nobody/SOUL.md')).toBeNull();
  });
});
