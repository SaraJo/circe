import type { Palette } from '../shared/types';

export function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * The variable set the tile stylesheet consumes. The alpha values match the
 * prototype's hand-written per-profile blocks, so a derived tile lands on the
 * same visual weight the reference fleet has.
 */
export function paletteVars(p: Palette): Record<string, string> {
  return {
    '--tile-bg': rgba(p.bg, 0.85),
    '--tile-border': rgba(p.border, 0.45),
    '--accent': p.accent,
    '--accent-soft': rgba(p.accent, 0.7),
    '--accent-glow': rgba(p.accent, 0.2),
    '--text': '#ffffff',
    '--muted': 'rgba(255, 255, 255, 0.72)',
    '--input-bg': 'rgba(255, 255, 255, 0.08)',
    '--user-bg': 'rgba(255, 255, 255, 0.14)',
    '--agent-bg': 'rgba(0, 0, 0, 0.18)',
  };
}

export function paletteCss(p: Palette): string {
  const body = Object.entries(paletteVars(p))
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');
  return `:root {\n${body}\n}\n`;
}
