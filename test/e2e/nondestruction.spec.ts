import { test, expect } from '@playwright/test';
import { launchCirce, seedProfile } from './harness';
import { hashTree } from './hash';

// Circe's own state lives under userData; Hermes writes nothing in these runs.
const skipCirceOwnFiles = (rel: string) => rel.startsWith('userData/');

test('§10.6 — Continue on Screen 4b modifies zero profile files', async () => {
  const ctx = await launchCirce({
    seed: (home) => {
      seedProfile(home, 'athena', '# Athena — the strategist\n\npersona text\n');
      seedProfile(home, 'ford', '# Ford — Career\n\npersona text\n');
      seedProfile(home, 'marvin', '# Marvin — the depressed android\n\npersona text\n');
    },
  });

  try {
    const before = hashTree(ctx.home, skipCirceOwnFiles);
    expect(Object.keys(before).length).toBeGreaterThan(0);

    const wizard = await ctx.app.firstWindow();
    await wizard.getByText('Get started').click();
    await expect(wizard.getByText(/Existing agents/)).toBeVisible({ timeout: 30_000 });

    // Touch no per-row control — just Continue.
    await wizard.getByText('Continue').click();
    await expect(wizard.getByText(/Connect a provider/)).toBeVisible({ timeout: 30_000 });
    await wizard.getByText(/Skip/).click();

    await expect
      .poll(async () => (await ctx.app.windows()).length, { timeout: 30_000 })
      .toBeGreaterThanOrEqual(3);

    const after = hashTree(ctx.home, skipCirceOwnFiles);
    expect(after).toEqual(before);
  } finally {
    await ctx.close();
  }
});

// isRealProfile() returns true for every NAMED profile (profiles.ts:16), so any
// seed at all routes to 4b. An empty home is the only way to reach Screen 4a,
// where the default primary action actually creates a profile — the path §10.6
// most needs covered, since createAgent runs with makeMainOperator: true.
test('§10.6 — a full default-path run adds only the profile it created', async () => {
  const ctx = await launchCirce({});

  try {
    const before = hashTree(ctx.home, skipCirceOwnFiles);
    expect(Object.keys(before)).toContain('SOUL.md');

    const wizard = await ctx.app.firstWindow();
    await wizard.getByText('Get started').click();
    await expect(wizard.getByText(/Your first agent/)).toBeVisible({ timeout: 30_000 });
    await wizard.getByText('Start with this agent').click();
    await expect(wizard.getByText(/Connect a provider/)).toBeVisible({ timeout: 30_000 });
    await wizard.getByText(/Skip/).click();
    await expect
      .poll(async () => (await ctx.app.windows()).length, { timeout: 30_000 })
      .toBeGreaterThanOrEqual(1);

    const after = hashTree(ctx.home, skipCirceOwnFiles);

    // Nothing pre-existing changed.
    for (const [file, hash] of Object.entries(before)) {
      expect(after[file], `${file} was modified`).toBe(hash);
    }
    // Nothing was removed. Not toHaveProperty() — it reads '.' in a filename as
    // a nesting separator, so 'SOUL.md' would be probed as after.SOUL.md.
    for (const file of Object.keys(before)) expect(Object.keys(after)).toContain(file);
    // A profile really was created — otherwise the two loops above would pass
    // against a wizard that did nothing at all.
    expect(Object.keys(after).length).toBeGreaterThan(Object.keys(before).length);
  } finally {
    await ctx.close();
  }
});
