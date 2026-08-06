import { test, expect } from '@playwright/test';
import { launchCirce, seedProfile } from './harness';

test('§10.3 — a 1000-token stream renders with ≤ 300ms p95 per-chunk lag', async () => {
  // The mock ignores the prompt and streams MOCK_HERMES_REPLY one word per
  // chunk, so the stream length is set here rather than by what we type.
  const words = Array.from({ length: 1000 }, (_, i) => `w${i}`).join(' ');

  const ctx = await launchCirce({
    seed: (home) => seedProfile(home, 'athena', '# Athena — the strategist\n'),
    env: { MOCK_HERMES_REPLY: words },
  });

  try {
    const wizard = await ctx.app.firstWindow();
    await wizard.getByText('Get started').click();
    await expect(wizard.getByText(/Existing agents/)).toBeVisible({ timeout: 30_000 });
    await wizard.getByText('Continue').click();
    await wizard.getByText(/Skip/).click();

    const tile = await ctx.app.waitForEvent('window', { timeout: 30_000 });
    await tile.waitForLoadState('domcontentloaded');

    // Record the wall-clock gap between successive DOM mutations of the
    // streaming bubble — this is the renderer-side half of the §10.3 budget.
    await tile.evaluate(() => {
      (window as any).__lags = [];
      let last = performance.now();
      new MutationObserver(() => {
        const now = performance.now();
        (window as any).__lags.push(now - last);
        last = now;
      }).observe(document.getElementById('transcript')!, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    });

    await tile.locator('#input').fill('stream me a long reply');
    await tile.locator('#send').click();
    await expect(tile.locator('#send')).toHaveText('Send', { timeout: 120_000 });

    const lags: number[] = await tile.evaluate(() => (window as any).__lags);
    expect(lags.length).toBeGreaterThan(100);

    const sorted = [...lags].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
    console.log(`[§10.3] chunks=${lags.length} p95=${p95.toFixed(1)}ms`);
    expect(p95).toBeLessThanOrEqual(300);
  } finally {
    await ctx.close();
  }
});
