import { describe, expect, it } from 'vitest';
import {
  hexToRgb,
  hueOf,
  liftDegenerateBackground,
  lightnessOf,
  paletteCss,
  paletteVars,
  rgba,
  saturationOf,
} from '../src/main/palette';
import { relativeLuminance } from '../src/main/derive';

const TRILLIAN = { bg: '#1e2952', border: '#c7d2fe', accent: '#a5b4fc' };

describe('hexToRgb', () => {
  it('splits a six-digit hex', () => {
    expect(hexToRgb('#1e2952')).toEqual([30, 41, 82]);
  });
});

describe('rgba', () => {
  it('renders an rgba string at the given alpha', () => {
    expect(rgba('#1e2952', 0.85)).toBe('rgba(30, 41, 82, 0.85)');
  });
});

describe('paletteVars', () => {
  it('derives every variable the tile stylesheet needs', () => {
    const vars = paletteVars(TRILLIAN);
    expect(vars['--tile-bg']).toBe('rgba(30, 41, 82, 0.85)');
    expect(vars['--accent']).toBe('#a5b4fc');
    expect(Object.keys(vars)).toEqual([
      '--tile-bg',
      '--tile-border',
      '--accent',
      '--accent-soft',
      '--accent-glow',
      '--text',
      '--muted',
      '--input-bg',
      '--user-bg',
      '--agent-bg',
    ]);
  });
});

describe('paletteCss', () => {
  it('emits a :root block', () => {
    const css = paletteCss(TRILLIAN);
    expect(css.startsWith(':root {')).toBe(true);
    expect(css).toContain('--accent: #a5b4fc;');
    expect(css.trimEnd().endsWith('}')).toBe(true);
  });

  it('produces no properties outside the known set', () => {
    const names = [...paletteCss(TRILLIAN).matchAll(/(--[a-z-]+):/g)].map((m) => m[1]);
    expect(new Set(names).size).toBe(10);
  });
});

/**
 * The floor exists only to catch a degenerate answer — a black, a white, or a
 * true grey — not to second-guess a character's colours. It is deliberately
 * far below the range the prototype's own hand-picked palettes occupy: those
 * run from 36.8% saturation (deep-thought's almost-black teal) upward, and a
 * floor anywhere near that would start overruling the model on colours that
 * are working. Anything the prototype ships must pass untouched.
 */
describe('liftDegenerateBackground', () => {
  /** Every hand-picked background from the reference implementation. */
  const PROTOTYPE_BACKGROUNDS = [
    '#1e2952', // default
    '#0c141a', // deep-thought — the darkest, at 7.5% lightness
    '#37285f', // eddie
    '#78370f', // ford
    '#6e1e41', // prak
    '#1e4b2d', // random
    '#0f3c58', // slartibartfast
    '#691969', // zaphod
    '#581c87', // trillian
  ];

  it('leaves every prototype palette exactly as it is', () => {
    for (const bg of PROTOTYPE_BACKGROUNDS) {
      expect(liftDegenerateBackground(bg)).toBe(bg);
    }
  });

  // The colour that prompted this work. It is not degenerate — 45.8% saturated,
  // and brighter than deep-thought — so the floor must not touch it either.
  // What made it look black was the missing card, not the colour.
  it('leaves a dark but genuinely coloured background alone', () => {
    expect(liftDegenerateBackground('#2b1810')).toBe('#2b1810');
  });

  it('gives a true grey some colour rather than passing it through', () => {
    const lifted = liftDegenerateBackground('#1c1c1e');
    expect(lifted).not.toBe('#1c1c1e');
    expect(saturationOf(lifted)).toBeGreaterThan(saturationOf('#1c1c1e'));
  });

  it('rescues pure black, which would otherwise render an invisible tile', () => {
    const lifted = liftDegenerateBackground('#000000');
    expect(lifted).not.toBe('#000000');
    expect(lightnessOf(lifted)).toBeGreaterThan(0);
  });

  it('keeps a lifted colour dark enough for white text', () => {
    for (const bg of ['#000000', '#1c1c1e', '#2a2a2a']) {
      expect(relativeLuminance(liftDegenerateBackground(bg))).toBeLessThanOrEqual(0.22);
    }
  });

  // Darkening here would let a light grey reach `derive.ts`'s luminance check
  // already dimmed enough to pass, turning a rejection into a silent repair.
  // Deciding a colour is too light belongs to that check, not to this one.
  it('never darkens a colour, so a too-light background still gets rejected', () => {
    for (const bg of ['#f5f5f5', '#cccccc', '#e8e8f0']) {
      expect(lightnessOf(liftDegenerateBackground(bg))).toBeGreaterThanOrEqual(lightnessOf(bg));
    }
  });

  it('preserves the hue it was given', () => {
    // A desaturated blue-grey should come back blue, not become a default.
    // Tolerance is a few degrees, not exact: the round trip through 8-bit
    // channels cannot land on the same hue it started from, and demanding it
    // would be asserting against arithmetic rather than against behaviour.
    const lifted = liftDegenerateBackground('#1a1c22');
    expect(Math.abs(hueOf(lifted) - hueOf('#1a1c22'))).toBeLessThan(5);
  });

  it('always answers a six-digit hex colour', () => {
    for (const bg of ['#000000', '#1c1c1e', '#2b1810', '#78370f']) {
      expect(liftDegenerateBackground(bg)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
