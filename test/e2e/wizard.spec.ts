import { test, expect } from '@playwright/test';
import { launchCirce } from './harness';

test('§10.1 — wizard happy path reaches a streaming tile in ≤ 90s', async () => {
  const started = Date.now();
  const ctx = await launchCirce();

  try {
    const wizard = await ctx.app.firstWindow();

    // Screen 1 → 2 → 3 → 4a
    await wizard.getByText('Get started').click();
    await expect(wizard.getByText(/Your first agent/)).toBeVisible({ timeout: 30_000 });

    // Screen 4a: accept the suggested Neutral character.
    await wizard.getByText('Start with this agent').click();

    // Screen 6: skip provider — the path §6 requires to always work.
    await expect(wizard.getByText(/Connect a provider/)).toBeVisible({ timeout: 30_000 });
    await wizard.getByText(/Skip/).click();

    // Screen 7 → a tile window appears.
    const tile = await ctx.app.waitForEvent('window', { timeout: 30_000 });
    await tile.waitForLoadState('domcontentloaded');
    await expect(tile.locator('#name')).toHaveText('Alpha', { timeout: 15_000 });

    // Send a message and get a streaming response.
    await tile.locator('#input').fill('hello');
    await tile.locator('#send').click();
    await expect(tile.locator('.msg.agent')).toContainText('Hello', { timeout: 30_000 });

    const elapsed = (Date.now() - started) / 1000;
    // Logged every run so regressions are visible (§10.1).
    console.log(`[§10.1] wizard happy path: ${elapsed.toFixed(1)}s`);
    expect(elapsed).toBeLessThanOrEqual(90);
  } finally {
    await ctx.close();
  }
});

test('§10.1 — the wizard resumes where it was left, not at Screen 1 (§8.2)', async () => {
  const first = await launchCirce();
  const home = first.home;
  try {
    const wizard = await first.app.firstWindow();
    await wizard.getByText('Get started').click();
    await expect(wizard.getByText(/Your first agent/)).toBeVisible({ timeout: 30_000 });
  } finally {
    await first.app.close();
  }

  const second = await launchCirce({ home });
  try {
    const wizard = await second.app.firstWindow();
    await expect(wizard.getByText(/Your first agent/)).toBeVisible({ timeout: 30_000 });
  } finally {
    await second.close();
  }
});
