import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchCirce, seedProfile } from './harness';

/** Reads the persisted state file the way the app writes it. */
function readState(home: string) {
  return JSON.parse(readFileSync(join(home, 'userData', 'state.json'), 'utf8'));
}

test('§10.5 — every persisted field survives a clean quit and relaunch', async () => {
  const seeded = await launchCirce({
    seed: (home) => {
      seedProfile(home, 'athena', '# Athena — the strategist\n');
      seedProfile(home, 'ford', '# Ford — Career\n');
      seedProfile(home, 'marvin', '# Marvin — the depressed android\n');
    },
  });
  const home = seeded.home;

  try {
    const wizard = await seeded.app.firstWindow();
    // Screen 1 → 3 finds three real profiles → Screen 4b → continue → skip → launch.
    await wizard.getByText('Get started').click();
    await expect(wizard.getByText(/Existing agents/)).toBeVisible({ timeout: 30_000 });
    await wizard.getByText('Continue').click();
    await expect(wizard.getByText(/Connect a provider/)).toBeVisible({ timeout: 30_000 });
    await wizard.getByText(/Skip/).click();

    // Wait for all three tiles.
    await expect.poll(async () => (await seeded.app.windows()).length, { timeout: 30_000 })
      .toBeGreaterThanOrEqual(3);

    // Cycle one tile's gate so there is a non-default value to restore.
    const windows = seeded.app.windows();
    const tile = windows[windows.length - 1]!;
    await tile.locator('#gate').click();

    await expect.poll(() => readState(home).tiles['marvin']?.gateMode ?? readState(home).tiles['athena']?.gateMode,
      { timeout: 15_000 }).toBeTruthy();
  } finally {
    await seeded.app.close();
  }

  const before = readState(home);
  expect(Object.keys(before.tiles).sort()).toEqual(['athena', 'ford', 'marvin']);

  // Relaunch against the same home.
  const relaunched = await launchCirce({ home });
  try {
    await expect.poll(async () => (await relaunched.app.windows()).length, { timeout: 30_000 })
      .toBeGreaterThanOrEqual(3);

    const after = readState(home);
    for (const id of ['athena', 'ford', 'marvin']) {
      expect(after.tiles[id].bounds, `${id} bounds`).toEqual(before.tiles[id].bounds);
      expect(after.tiles[id].gateMode, `${id} gate`).toBe(before.tiles[id].gateMode);
      expect(after.tiles[id].activeTabId, `${id} active tab`).toBe(before.tiles[id].activeTabId);
      expect(after.tiles[id].tabs.length, `${id} tab count`).toBe(before.tiles[id].tabs.length);
      expect(after.tiles[id].tabs[0].messages, `${id} transcript`).toEqual(
        before.tiles[id].tabs[0].messages,
      );
      expect(after.tiles[id].palette, `${id} palette`).toEqual(before.tiles[id].palette);
    }
    expect(after.mainOperatorId).toBe(before.mainOperatorId);
  } finally {
    await relaunched.close();
  }
});
