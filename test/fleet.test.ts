import { describe, expect, it, vi } from 'vitest';
import { FleetWatch, tileableProfiles } from '../src/main/fleet';
import { characterFor } from '../src/main/startup';
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

  it('keeps the root default agent tileable even when its persona has no H1', async () => {
    expect((await tileableProfiles(new FakeHermes(INSTALLED_EMPTY))).map((p) => p.id)).toEqual([
      'default',
    ]);
  });

  it('omits profiles the user excluded during adoption', async () => {
    const ids = (
      await tileableProfiles(new FakeHermes(INSTALLED_WITH_AGENTS), ['ford'])
    ).map((profile) => profile.id);

    expect(ids).toContain('default');
    expect(ids).not.toContain('ford');
  });
});

// The spec's own required test (§6, "Constraint 10"): build a profile
// directory by hand with only the two files the spec says describe a
// profile, with no Circe-side record of it anywhere, and confirm the tile
// pipeline shows it correctly. If this passes, no agent fact has leaked into
// Circe's own state — everything came from the profile itself.
describe('constraint 10: a hand-built profile, end to end', () => {
  it('tileableProfiles + characterFor show a profile built with only SOUL.md and circe.json', async () => {
    const palette = { bg: '#0b1d3a', border: '#f2c14e', accent: '#ffe1a8' };
    const hermes = new FakeHermes({
      version: '0.14.0',
      hasProvider: true,
      models: { default: 'claude-opus-5', prak: 'claude-opus-5' },
      files: {
        'SOUL.md': '# Trillian — the one who keeps the plot\n',
        'profiles/prak/SOUL.md': '# Prak — the one who cannot lie\n',
        'profiles/prak/circe.json': JSON.stringify({ version: 1, palette }),
      },
    });

    const profiles = await tileableProfiles(hermes);
    const prak = profiles.find((p) => p.id === 'prak');
    expect(prak).toBeDefined();

    const character = await characterFor(hermes, prak!);
    expect(character.name).toBe('Prak');
    expect(character.palette).toEqual(palette);
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

  /**
   * `default` is real in `configured()` from the start, modelling a machine
   * that has already finished onboarding. `alreadyTiled` defaults to
   * `['default']` because that's the realistic starting state: whatever
   * enumerates the fleet at boot (`openFleet`, the next task) has already
   * opened its tile before this watch is ever constructed. Tests that want a
   * profile reported from scratch pass `alreadyTiled: []` explicitly.
   */
  function watcher(
    hermes: FakeHermes,
    isOpen: (id: string) => boolean = () => false,
    alreadyTiled: Iterable<string> = ['default'],
    ignoredProfileIds: Iterable<string> = [],
  ) {
    const opened: string[] = [];
    const known: string[] = [];
    const watch = new FleetWatch({
      hermes,
      isOpen,
      alreadyTiled,
      ignoredProfileIds,
      onProfile: (profile) => {
        opened.push(profile.id);
      },
      onKnownProfile: (profile) => {
        known.push(profile.id);
      },
      debounceMs: 10,
    });
    return { watch, opened, known };
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

  it('discovers profiles from Windows file-watcher paths', async () => {
    const hermes = new FakeHermes(configured());
    const { watch, opened } = watcher(hermes);
    const stop = watch.start();
    hermes.scenarioModels.ford = 'claude-opus-5';
    await hermes.writeHomeFile('profiles/ford/SOUL.md', '# Ford\n');
    hermes.fireHomeChange('profiles\\ford\\SOUL.md');
    await vi.waitFor(() => expect(opened).toEqual(['ford']));
    stop();
  });

  it('does not open an excluded profile when its files change', async () => {
    const hermes = new FakeHermes(configured());
    const { watch, opened } = watcher(hermes, () => false, ['default'], ['ford']);
    const stop = watch.start();

    hermes.scenarioModels.ford = 'claude-opus-5';
    await hermes.writeHomeFile('profiles/ford/SOUL.md', '# Ford — the one who finds the exit\n');
    hermes.fireHomeChange('profiles/ford/SOUL.md');
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(opened).toEqual([]);
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

  /**
   * The resurrection bug this fix round exists for: an agent's own directory
   * keeps changing after its tile opens — memory, session state,
   * `circe.json` — and none of that means "open me again". Once a profile
   * has been reported, this watch must never report it a second time, even
   * with an `isOpen` that (as it would the instant the user closes the tile)
   * says it no longer has one.
   */
  it('does not resurrect a tile the user closed, on a later write under the same profile', async () => {
    const hermes = new FakeHermes(configured());
    const { watch, opened } = watcher(hermes, () => false);
    const stop = watch.start();

    hermes.scenarioModels.ford = 'claude-opus-5';
    await hermes.writeHomeFile('profiles/ford/SOUL.md', '# Ford — the one who finds the exit\n');
    hermes.fireHomeChange('profiles/ford/SOUL.md');
    await vi.waitFor(() => expect(opened).toEqual(['ford']));

    // The user closed the tile; the caller's isOpen now truthfully says so.
    // Ford's own agent then writes something unrelated inside its directory.
    await hermes.writeHomeFile('profiles/ford/circe.json', '{"lastActive":"2026-08-17"}');
    hermes.fireHomeChange('profiles/ford/circe.json');
    await new Promise((r) => setTimeout(r, 40));

    expect(opened).toEqual(['ford']);
    stop();
  });

  it('coalesces a burst of events into one enumeration', async () => {
    const hermes = new FakeHermes(configured());
    const { watch, opened } = watcher(hermes);
    const listProfiles = vi.spyOn(hermes, 'listProfiles');
    const stop = watch.start();
    hermes.scenarioModels.ford = 'claude-opus-5';
    await hermes.writeHomeFile('profiles/ford/SOUL.md', '# Ford — the one who finds the exit\n');

    for (let i = 0; i < 20; i++) hermes.fireHomeChange('profiles/ford/SOUL.md');
    await vi.waitFor(() => expect(opened).toEqual(['ford']));

    // The assertion that actually names "one enumeration": twenty events
    // debounced into a single call to Hermes, not just a single notification
    // (which the tiled-profile dedup would guarantee on its own).
    expect(listProfiles).toHaveBeenCalledTimes(1);
    stop();
  });

  // The home also carries state.db, logs and session files, which change
  // constantly. Re-enumerating profiles on every one of those is waste.
  it('ignores changes outside the profiles directory', async () => {
    const hermes = new FakeHermes(configured());
    const { watch, opened } = watcher(hermes);
    const listProfiles = vi.spyOn(hermes, 'listProfiles');
    const stop = watch.start();

    hermes.fireHomeChange('state.db');
    hermes.fireHomeChange('circe/state.json');
    await new Promise((r) => setTimeout(r, 40));

    expect(listProfiles).not.toHaveBeenCalled();
    expect(opened).toEqual([]);
    stop();
  });

  /**
   * The filter is a prefix check with a trailing slash, not a substring
   * match: `profiles-backup/x` and `profilesX` must not count as under
   * `profiles/`, and the bare directory name `profiles` (what `fs.watch`
   * reports for the directory itself, with no trailing path) must.
   */
  it('rejects profiles-prefixed lookalikes but admits the bare profiles directory', async () => {
    const hermes = new FakeHermes(configured());
    const { watch } = watcher(hermes);
    const listProfiles = vi.spyOn(hermes, 'listProfiles');
    const stop = watch.start();

    hermes.fireHomeChange('profiles-backup/ford/SOUL.md');
    hermes.fireHomeChange('profilesX/ford/SOUL.md');
    await new Promise((r) => setTimeout(r, 40));
    expect(listProfiles).not.toHaveBeenCalled();

    hermes.fireHomeChange('profiles');
    await new Promise((r) => setTimeout(r, 40));
    expect(listProfiles).toHaveBeenCalledTimes(1);

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

  // Distinct from the previous test: this stops *after* an event has already
  // armed the debounce timer, proving the stop function actually cancels a
  // pending sweep rather than only detaching the watch callback.
  it('reports nothing if stopped after an event but before the debounce fires', async () => {
    const hermes = new FakeHermes(configured());
    const { watch, opened } = watcher(hermes);
    const stop = watch.start();

    hermes.scenarioModels.ford = 'claude-opus-5';
    await hermes.writeHomeFile('profiles/ford/SOUL.md', '# Ford — the one who finds the exit\n');
    hermes.fireHomeChange('profiles/ford/SOUL.md');
    stop();

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

  // A single bad tile must not stop the sweep from reaching the rest of the
  // profiles it found in the same enumeration.
  // I2: `openFleet`'s launch loop can run for minutes on a large fleet, and a
  // profile that becomes tileable during it must not wait for some later,
  // unrelated filesystem event to be noticed.
  describe('sweepNow', () => {
    it('opens tiles for anything already tileable, without waiting on a filesystem event or the debounce', async () => {
      const hermes = new FakeHermes(configured());
      hermes.scenarioModels.ford = 'claude-opus-5';
      await hermes.writeHomeFile('profiles/ford/SOUL.md', '# Ford — the one who finds the exit\n');
      // Deliberately never call `watch.start()` and never fire a home change:
      // `sweepNow` must not depend on either to do its job.
      const { watch, opened } = watcher(hermes);

      await watch.sweepNow();

      expect(opened).toEqual(['ford']);
    });

    // Proves the in-flight guard: a manual sweep arriving while a debounced
    // one is already mid-`onProfile` must join it, not run a second
    // enumeration and risk opening the same profile twice.
    it('joins a debounced sweep already in flight rather than double-dispatching', async () => {
      const hermes = new FakeHermes(configured());
      hermes.scenarioModels.ford = 'claude-opus-5';
      await hermes.writeHomeFile('profiles/ford/SOUL.md', '# Ford — the one who finds the exit\n');
      const listProfiles = vi.spyOn(hermes, 'listProfiles');
      const opened: string[] = [];
      let release: (() => void) | null = null;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const watch = new FleetWatch({
        hermes,
        isOpen: () => false,
        alreadyTiled: ['default'],
        onProfile: async (profile) => {
          await gate; // holds the debounced sweep mid-flight
          opened.push(profile.id);
        },
        // Nothing in this test has a tile, so this is never reached.
        onKnownProfile: () => {},
        debounceMs: 10,
      });
      const stop = watch.start();

      hermes.fireHomeChange('profiles/ford/SOUL.md');
      // Let the debounce actually fire and the sweep reach the held
      // `onProfile` call before triggering the manual one.
      await vi.waitFor(() => expect(listProfiles).toHaveBeenCalledTimes(1));

      const manual = watch.sweepNow();
      release!();
      await manual;

      expect(opened).toEqual(['ford']);
      expect(listProfiles).toHaveBeenCalledTimes(1); // not a second enumeration
      stop();
    });
  });

  // D1 (2026-08-18 walkthrough): a profile's files keep changing after its tile
  // opens — the orchestrator writes `circe.json` seconds after the `SOUL.md`
  // that made the profile tileable, so the tile launches with no colours of its
  // own and stays that way until a restart. The sweep already sees those later
  // writes; it just had nothing to say about them.
  it('re-reports a profile that already has a tile instead of launching a second one', async () => {
    const hermes = new FakeHermes(configured());
    const { watch, opened, known } = watcher(hermes, (id) => id === 'default');
    const stop = watch.start();

    await hermes.writeHomeFile('profiles/default/circe.json', '{"version":1}');
    hermes.fireHomeChange('profiles/default/circe.json');

    await vi.waitFor(() => expect(known).toEqual(['default']));
    expect(opened).toEqual([]);
    stop();
  });

  // The resurrection guard's other half: a tile the user closed stays closed,
  // and must not be re-themed either — there is no window to send to, and
  // asking would mean reading its files on every unrelated write forever.
  it('says nothing about a profile whose tile the user closed', async () => {
    const hermes = new FakeHermes(configured());
    const { watch, opened, known } = watcher(hermes, () => false);
    const stop = watch.start();

    await hermes.writeHomeFile('profiles/default/circe.json', '{"version":1}');
    hermes.fireHomeChange('profiles/default/circe.json');
    await hermes.writeHomeFile('SOUL.md', '# Trillian — still here\n');
    hermes.fireHomeChange('profiles/default/SOUL.md');

    await new Promise((r) => setTimeout(r, 60));
    expect(known).toEqual([]);
    expect(opened).toEqual([]);
    stop();
  });

  it('keeps sweeping when onKnownProfile throws for one profile', async () => {
    const hermes = new FakeHermes(configured());
    const opened: string[] = [];
    const watch = new FleetWatch({
      hermes,
      isOpen: (id) => id === 'default',
      alreadyTiled: ['default'],
      onProfile: (profile) => {
        opened.push(profile.id);
      },
      onKnownProfile: () => {
        throw new Error('could not re-read the profile');
      },
      debounceMs: 10,
    });
    const stop = watch.start();

    hermes.scenarioModels.ford = 'claude-opus-5';
    await hermes.writeHomeFile('profiles/ford/SOUL.md', '# Ford — the one who finds the exit\n');
    hermes.fireHomeChange('profiles/ford/SOUL.md');

    await vi.waitFor(() => expect(opened).toEqual(['ford']));
    stop();
  });

  it('keeps opening tiles for other profiles when onProfile throws for one', async () => {
    const hermes = new FakeHermes(configured());
    const opened: string[] = [];
    const watch = new FleetWatch({
      hermes,
      isOpen: () => false,
      alreadyTiled: ['default'],
      onProfile: (profile) => {
        if (profile.id === 'ford') throw new Error('tile failed to open');
        opened.push(profile.id);
      },
      // Nothing in this test has a tile, so this is never reached.
      onKnownProfile: () => {},
      debounceMs: 10,
    });
    const stop = watch.start();

    hermes.scenarioModels.ford = 'claude-opus-5';
    hermes.scenarioModels.zaphod = 'claude-opus-5';
    await hermes.writeHomeFile('profiles/ford/SOUL.md', '# Ford — the one who finds the exit\n');
    await hermes.writeHomeFile('profiles/zaphod/SOUL.md', '# Zaphod — the one with two heads\n');
    hermes.fireHomeChange('profiles/ford/SOUL.md');

    await vi.waitFor(() => expect(opened).toEqual(['zaphod']));
    stop();
  });
});
