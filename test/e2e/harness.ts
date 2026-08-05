import { _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const MOCK_DIR = resolve(__dirname, '../fixtures/mock-hermes');
export const MOCK_BIN = join(MOCK_DIR, 'hermes');
export const SCAFFOLD =
  'You are Hermes Agent, an intelligent AI assistant created by Nous Research.';

export interface LaunchOptions {
  /** Reuse an existing temp home to simulate a relaunch. */
  home?: string;
  scenario?: string;
  seed?: (home: string) => void;
}

export async function launchCirce(opts: LaunchOptions = {}) {
  const home = opts.home ?? mkdtempSync(join(tmpdir(), 'circe-e2e-'));
  const userData = join(home, 'userData');
  mkdirSync(userData, { recursive: true });

  if (!opts.home) {
    writeFileSync(join(home, 'SOUL.md'), SCAFFOLD);
    opts.seed?.(home);
  }

  const app: ElectronApplication = await electron.launch({
    args: [resolve(__dirname, '../../out/main/index.js'), `--user-data-dir=${userData}`],
    env: {
      ...process.env,
      HERMES_HOME: home,
      MOCK_HERMES_HOME: home,
      MOCK_HERMES_SCENARIO: opts.scenario ?? 'stream',
      // Put the mock first so locateHermes() finds it instead of a real install.
      PATH: `${MOCK_DIR}:${process.env.PATH ?? ''}`,
      CIRCE_E2E: '1',
    },
  });

  return {
    app,
    home,
    async close() {
      await app.close();
      if (!opts.home) rmSync(home, { recursive: true, force: true });
    },
  };
}

/** Seeds a configured profile so the wizard routes to Screen 4b. */
export function seedProfile(home: string, id: string, soul?: string) {
  const dir = join(home, 'profiles', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SOUL.md'), soul ?? `# ${id} — seeded\n\nbody\n`);
}
