import { describe, expect, it, vi } from 'vitest';
import { FleetWatch, tileableProfiles } from '../src/main/fleet';
import { FakeHermes, INSTALLED_EMPTY, INSTALLED_WITH_AGENTS, SCAFFOLD_SOUL } from './fake/hermes';

describe('tileableProfiles', () => {
  it('lists a configured fleet', async () => {
    const ids = (await tileableProfiles(new FakeHermes(INSTALLED_WITH_AGENTS))).map((p) => p.id);
    expect(ids).toContain('default');
    expect(ids).toContain('ford');
  });

  // The readiness rule: a profile is tileable once it describes itself.
  it('omits a profile that is still the stock scaffold', async () => {
    const hermes = new FakeHermes({
      ...INSTALLED_WITH_AGENTS,
      files: { ...INSTALLED_WITH_AGENTS.files, 'profiles/ford/SOUL.md': SCAFFOLD_SOUL },
    });

    const ids = (await tileableProfiles(hermes)).map((p) => p.id);
    expect(ids).not.toContain('ford');
    expect(ids).toContain('default');
  });

  it('omits a profile with no SOUL.md at all', async () => {
    const hermes = new FakeHermes({
      ...INSTALLED_EMPTY,
      models: { default: 'claude-opus-5', ford: 'claude-opus-5' },
      files: { 'SOUL.md': '# Trillian — the one who keeps the plot\n' },
    });

    expect((await tileableProfiles(hermes)).map((p) => p.id)).toEqual(['default']);
  });
});

describe('FleetWatch', () => {
  /**
   * A function, not a shared const: these tests add a profile mid-run by
   * mutating `scenarioModels`, and a spread copies `models` by reference — so a
   * shared fixture would leak `ford` into `INSTALLED_EMPTY` itself and into
   * every other test file that imports it.
   */
  function configured() {
    return {
      ...INSTALLED_EMPTY,
      models: { ...INSTALLED_EMPTY.models },
      files: { 'SOUL.md': '# Trillian — the one who keeps the plot\n' },
    };
  }

  function watcher(hermes: FakeHermes, isOpen: (id: string) => boolean = () => false) {
    const opened: string[] = [];
    const watch = new FleetWatch({
      hermes,
      isOpen,
      onProfile: (profile) => {
        opened.push(profile.id);
      },
      debounceMs: 10,
    });
    return { watch, opened };
  }

  it('opens a tile for a profile that becomes real', async () => {
    const hermes = new FakeHermes(configured());
    const { watch, opened } = watcher(hermes);
    const stop = watch.start();

    hermes.scenarioModels.ford = 'claude-opus-5';
    await hermes.writeHomeFile('profiles/ford/SOUL.md', '# Ford — the one who finds the exit\n');
    hermes.fireHomeChange('profiles/ford/SOUL.md');
    await vi.waitFor(() => expect(opened).toEqual(['ford']));

    stop();
  });

  // fs.watch fires on directory creation, before SOUL.md exists. Tiling then
  // spawns an agent against a persona that is not there yet (cf. 8733673).
  it('does not tile a directory that has no persona yet', async () => {
    const hermes = new FakeHermes(configured());
    const { watch, opened } = watcher(hermes);
    const stop = watch.start();

    hermes.scenarioModels.ford = 'claude-opus-5';
    hermes.fireHomeChange('profiles/ford');
    await new Promise((r) => setTimeout(r, 40));

    expect(opened).toEqual([]);
    stop();
  });

  it('tiles it once the persona lands on a later event', async () => {
    const hermes = new FakeHermes(configured());
    const { watch, opened } = watcher(hermes);
    const stop = watch.start();

    hermes.scenarioModels.ford = 'claude-opus-5';
    hermes.fireHomeChange('profiles/ford');
    await new Promise((r) => setTimeout(r, 40));
    await hermes.writeHomeFile('profiles/ford/SOUL.md', '# Ford — the one who finds the exit\n');
    hermes.fireHomeChange('profiles/ford/SOUL.md');

    await vi.waitFor(() => expect(opened).toEqual(['ford']));
    stop();
  });

  it('never opens a second tile for a profile that already has one', async () => {
    const hermes = new FakeHermes(configured());
    const open = new Set<string>();
    const { watch, opened } = watcher(hermes, (id) => open.has(id));
    const stop = watch.start();

    hermes.scenarioModels.ford = 'claude-opus-5';
    await hermes.writeHomeFile('profiles/ford/SOUL.md', '# Ford — the one who finds the exit\n');
    hermes.fireHomeChange('profiles/ford/SOUL.md');
    await vi.waitFor(() => expect(opened).toEqual(['ford']));
    open.add('ford');

    hermes.fireHomeChange('profiles/ford/SOUL.md');
    await new Promise((r) => setTimeout(r, 40));

    expect(opened).toEqual(['ford']);
    stop();
  });

  it('coalesces a burst of events into one enumeration', async () => {
    const hermes = new FakeHermes(configured());
    const { watch, opened } = watcher(hermes);
    const stop = watch.start();
    hermes.scenarioModels.ford = 'claude-opus-5';
    await hermes.writeHomeFile('profiles/ford/SOUL.md', '# Ford — the one who finds the exit\n');

    for (let i = 0; i < 20; i++) hermes.fireHomeChange('profiles/ford/SOUL.md');
    await vi.waitFor(() => expect(opened).toEqual(['ford']));

    expect(opened).toEqual(['ford']);
    stop();
  });

  // The home also carries state.db, logs and session files, which change
  // constantly. Re-enumerating profiles on every one of those is waste.
  it('ignores changes outside the profiles directory', async () => {
    const hermes = new FakeHermes(configured());
    const { watch, opened } = watcher(hermes);
    const stop = watch.start();

    hermes.fireHomeChange('state.db');
    hermes.fireHomeChange('circe/state.json');
    await new Promise((r) => setTimeout(r, 40));

    expect(opened).toEqual([]);
    stop();
  });

  it('stops watching when told to', async () => {
    const hermes = new FakeHermes(configured());
    const { watch, opened } = watcher(hermes);
    const stop = watch.start();
    stop();

    hermes.scenarioModels.ford = 'claude-opus-5';
    await hermes.writeHomeFile('profiles/ford/SOUL.md', '# Ford — the one who finds the exit\n');
    hermes.fireHomeChange('profiles/ford/SOUL.md');
    await new Promise((r) => setTimeout(r, 40));

    expect(opened).toEqual([]);
  });

  // A watch that dies on one bad enumeration stops the core loop silently.
  it('survives an enumeration that throws', async () => {
    const hermes = new FakeHermes(configured());
    const { watch, opened } = watcher(hermes);
    const stop = watch.start();
    const realList = hermes.listProfiles.bind(hermes);
    hermes.listProfiles = async () => {
      hermes.listProfiles = realList;
      throw new Error('hermes exploded');
    };

    hermes.fireHomeChange('profiles/ford/SOUL.md');
    await new Promise((r) => setTimeout(r, 40));

    hermes.scenarioModels.ford = 'claude-opus-5';
    await hermes.writeHomeFile('profiles/ford/SOUL.md', '# Ford — the one who finds the exit\n');
    hermes.fireHomeChange('profiles/ford/SOUL.md');
    await vi.waitFor(() => expect(opened).toEqual(['ford']));

    stop();
  });
});
