import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WizardController } from '../../src/main/wizard/controller';
import { StateStore } from '../../src/main/state/store';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOCK_DIR = resolve(HERE, '../fixtures/mock-hermes');
const SCAFFOLD = 'You are Hermes Agent, an intelligent AI assistant created by Nous Research.';

let home: string;
let store: StateStore;

function makeController(env: Record<string, string> = {}) {
  return new WizardController({
    store,
    hermesHome: home,
    // A temp dir with no .local/bin, so the not-found path can't be rescued by
    // a real Hermes install on the developer's machine.
    home,
    env: { PATH: MOCK_DIR, MOCK_HERMES_HOME: home, ...env },
  });
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'circe-wizard-'));
  writeFileSync(join(home, 'SOUL.md'), SCAFFOLD);
  store = new StateStore(join(home, 'state.json'));
  await store.load();
});
afterEach(async () => {
  await store.whenIdle();
  rmSync(home, { recursive: true, force: true });
});

describe('WizardController', () => {
  it('starts on welcome for a first run', async () => {
    expect(await makeController().start()).toBe('welcome');
  });

  it('resumes where the user left off rather than restarting (§8.2)', async () => {
    await store.save({ ...store.get(), wizardScreen: 'provider' });
    expect(await makeController().start()).toBe('provider');
  });

  it('persists the screen on every navigation', async () => {
    const w = makeController();
    await w.start();
    w.goto('runtime');
    expect(store.get().wizardScreen).toBe('runtime');
  });

  it('goes back through the screens it actually visited', async () => {
    const w = makeController();
    await w.start();
    w.goto('runtime');
    w.goto('profiles');
    w.back();
    expect(w.screen).toBe('runtime');
    w.back();
    expect(w.screen).toBe('welcome');
  });

  it('back at the first screen is a no-op', async () => {
    const w = makeController();
    await w.start();
    w.back();
    expect(w.screen).toBe('welcome');
  });

  it('detects an installed runtime and reports its version (Screen 2)', async () => {
    const status = await makeController().detectRuntime();
    expect(status.installed).toBe(true);
    expect(status.version).toBe('0.14.0');
  });

  it('reports a specific message when the runtime is missing (Screen 2)', async () => {
    const status = await makeController({ PATH: '/nonexistent' }).detectRuntime();
    expect(status.installed).toBe(false);
    expect(status.message).toMatch(/hermes/i);
    expect(status.message).not.toMatch(/at Object|\bstack\b/);
  });

  it('reports a too-old runtime as not usable (§8.1)', async () => {
    const status = await makeController({ MOCK_HERMES_VERSION: '0.13.0' }).detectRuntime();
    expect(status.installed).toBe(false);
    expect(status.message).toContain('0.14.0');
  });

  it('routes a fresh install to Screen 4a (§5.4)', async () => {
    const { next, profiles } = await makeController().detectProfiles();
    expect(next).toBe('create');
    expect(profiles.filter((p) => p.real)).toHaveLength(0);
  });

  it('routes an install with real profiles to Screen 4b', async () => {
    mkdirSync(join(home, 'profiles', 'ford'), { recursive: true });
    writeFileSync(join(home, 'profiles', 'ford', 'SOUL.md'), '# Ford — Career\n');
    const { next, profiles } = await makeController().detectProfiles();
    expect(next).toBe('profiles');
    expect(profiles.filter((p) => p.real).map((p) => p.id)).toEqual(['ford']);
  });

  it('treats an adopted default as real and routes to Screen 4b', async () => {
    writeFileSync(join(home, 'SOUL.md'), '# Trillian — Central Coordinator\n');
    expect((await makeController().detectProfiles()).next).toBe('profiles');
  });
});
