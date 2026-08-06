import { test, expect } from '@playwright/test';
import { launchCirce, seedProfile } from './harness';

test('§10.4 — switching to Locked denies the next tool call and renders a card', async () => {
  const ctx = await launchCirce({
    scenario: 'permission',
    seed: (home) => seedProfile(home, 'athena', '# Athena — the strategist\n'),
  });

  try {
    const wizard = await ctx.app.firstWindow();
    await wizard.getByText('Get started').click();
    await expect(wizard.getByText(/Existing agents/)).toBeVisible({ timeout: 30_000 });
    await wizard.getByText('Continue').click();
    await wizard.getByText(/Skip/).click();

    const tile = await ctx.app.waitForEvent('window', { timeout: 30_000 });
    await tile.waitForLoadState('domcontentloaded');
    await expect(tile.locator('#name')).toHaveText('Athena', { timeout: 15_000 });

    // New non-coding profiles open unlocked; one click cycles to locked (§6.4).
    await expect(tile.locator('#gate')).toHaveText('🔓');
    await tile.locator('#gate').click();
    await expect(tile.locator('#gate')).toHaveText('🔒');

    await tile.locator('#input').fill('write a file');
    await tile.locator('#send').click();

    // The denied card must appear — the user has to see the agent tried (§6.4).
    await expect(tile.locator('.msg.denied')).toContainText('write_file', { timeout: 30_000 });
  } finally {
    await ctx.close();
  }
});

test('§6.4 — the gate button cycles locked → ask → unlocked → locked', async () => {
  const ctx = await launchCirce({
    seed: (home) => seedProfile(home, 'athena', '# Athena — the strategist\n'),
  });

  try {
    const wizard = await ctx.app.firstWindow();
    await wizard.getByText('Get started').click();
    await expect(wizard.getByText(/Existing agents/)).toBeVisible({ timeout: 30_000 });
    await wizard.getByText('Continue').click();
    await wizard.getByText(/Skip/).click();

    const tile = await ctx.app.waitForEvent('window', { timeout: 30_000 });
    await tile.waitForLoadState('domcontentloaded');

    await expect(tile.locator('#gate')).toHaveText('🔓');
    await tile.locator('#gate').click();
    await expect(tile.locator('#gate')).toHaveText('🔒');
    await tile.locator('#gate').click();
    await expect(tile.locator('#gate')).toHaveText('⛔');
    await tile.locator('#gate').click();
    await expect(tile.locator('#gate')).toHaveText('🔓');
  } finally {
    await ctx.close();
  }
});
