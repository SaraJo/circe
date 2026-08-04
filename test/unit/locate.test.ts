import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  parseVersion,
  compareVersions,
  locateHermes,
  MIN_HERMES_VERSION,
} from '../../src/main/hermes/locate';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOCK_DIR = resolve(HERE, '../fixtures/mock-hermes');

describe('parseVersion', () => {
  it('reads the real Hermes version banner', () => {
    expect(parseVersion('Hermes Agent v0.14.0 (2026.5.16)\nProject: /x\n')).toBe('0.14.0');
  });

  it('reads a bare version line', () => {
    expect(parseVersion('0.14.0\n')).toBe('0.14.0');
  });

  it('returns null for unrecognised output', () => {
    expect(parseVersion('command not found')).toBeNull();
  });

  it('does not mistake the build-date parenthetical for the version', () => {
    expect(parseVersion('Hermes Agent vnot-a-version (2026.5.16)')).toBeNull();
  });

  it('does not read a version out of unrelated banner text', () => {
    expect(parseVersion('Loaded 3 plugins from 2 sources\nno version here\n')).toBeNull();
  });
});

describe('compareVersions', () => {
  it('orders by major, minor, then patch', () => {
    expect(compareVersions('0.14.0', '0.14.0')).toBe(0);
    expect(compareVersions('0.15.0', '0.14.9')).toBeGreaterThan(0);
    expect(compareVersions('0.13.9', '0.14.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0);
  });

  it('treats a missing patch segment as zero', () => {
    expect(compareVersions('0.14', '0.14.0')).toBe(0);
  });
});

describe('locateHermes', () => {
  it('finds the binary on PATH and reports its version', async () => {
    const r = await locateHermes({ env: { PATH: MOCK_DIR } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.version).toBe('0.14.0');
  });

  it('falls back to ~/.local/bin when PATH has nothing', async () => {
    // The fixture dir stands in for ~/.local/bin.
    const r = await locateHermes({ env: { PATH: '/nonexistent' }, home: resolve(MOCK_DIR, '../..') });
    // No hermes at <home>/.local/bin either, so this must fail cleanly.
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not-found');
  });

  it('reports a specific, actionable message when not found', async () => {
    const r = await locateHermes({ env: { PATH: '/nonexistent' }, home: '/nonexistent' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('not-found');
      expect(r.message).toMatch(/hermes/i);
      expect(r.message).not.toMatch(/Error:|at Object|\bstack\b/);
    }
  });

  it('rejects a version below the minimum', async () => {
    const r = await locateHermes({ env: { PATH: MOCK_DIR, MOCK_HERMES_VERSION: '0.13.0' } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('too-old');
      expect(r.message).toContain(MIN_HERMES_VERSION);
    }
  });

  it('accepts a version above the minimum — never fail closed on newer (§8.1)', async () => {
    const r = await locateHermes({ env: { PATH: MOCK_DIR, MOCK_HERMES_VERSION: '99.0.0' } });
    expect(r.ok).toBe(true);
  });

  it('reports unreadable-version when the binary prints something unparseable', async () => {
    const r = await locateHermes({ env: { PATH: MOCK_DIR, MOCK_HERMES_VERSION: 'not-a-version' } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('unreadable-version');
      expect(r.message).toContain(MIN_HERMES_VERSION);
      expect(r.message).not.toMatch(/Error:|at Object|\bstack\b/);
    }
  });
});
