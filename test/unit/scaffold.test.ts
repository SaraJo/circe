import { describe, it, expect } from 'vitest';
import { GATE_MODES, emptyState, DEFAULT_PALETTE } from '../../src/shared/types';

describe('shared types', () => {
  it('orders gate modes as the §6.4 cycle: locked → ask → unlocked', () => {
    expect(GATE_MODES).toEqual(['locked', 'ask', 'unlocked']);
  });

  it('starts un-onboarded with no tiles and no main operator', () => {
    expect(emptyState()).toEqual({
      version: 1,
      onboarded: false,
      mainOperatorId: null,
      tiles: {},
      wizardScreen: null,
    });
  });

  it('ships a default palette with both an accent and a background', () => {
    expect(DEFAULT_PALETTE.accent).toMatch(/^#[0-9a-f]{6}$/i);
    expect(DEFAULT_PALETTE.background).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
