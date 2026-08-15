import { describe, expect, it } from 'vitest';
import { hexToRgb, paletteCss, paletteVars, rgba } from '../src/main/palette';

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
