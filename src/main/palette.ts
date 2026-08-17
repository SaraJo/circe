import type { Palette } from '../shared/types';

/**
 * Used for any profile whose colours Circe cannot read — someone else's
 * coordinator, a specialist created at a terminal before it was themed, or a
 * `circe.json` that failed to parse. Deliberately neutral: it should read as
 * "not themed yet", not as a character choice.
 *
 * Lives here, next to the functions that consume it, because both the main
 * process and the renderer fall back to it and they must agree. They did not:
 * `startup.ts` and `src/renderer/tile/main.ts` each had their own, with
 * different colours.
 */
export const DEFAULT_PALETTE: Palette = {
  bg: '#1c1c1e',
  border: '#8a8a8e',
  accent: '#c9c9ce',
};

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * True for a well-formed six-digit-hex palette. The tile reads
 * `character?.palette` out of a JSON blob smuggled through a URL query
 * param (`parseCharacter` in `src/renderer/tile/main.ts`), which only
 * validates that `name` is a string — a malformed `palette` (`5`, a partial
 * object, a channel that isn't a hex string) is otherwise handed straight to
 * `paletteVars`, which throws at module top level and kills the whole tile
 * script before any listener is wired up, leaving a blank window with no
 * input. Nothing produces that today, but the fallback guard needs to match
 * the "missing or malformed" claim it makes, not just "missing".
 */
export function isPalette(v: unknown): v is Palette {
  if (typeof v !== 'object' || v === null) return false;
  const { bg, border, accent } = v as Record<string, unknown>;
  const isHex = (x: unknown): x is string => typeof x === 'string' && HEX.test(x);
  return isHex(bg) && isHex(border) && isHex(accent);
}

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

/** Hue in degrees, or 0 for a colour with no hue to speak of. */
export function hueOf(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h =
    max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

/** HSL lightness, 0-1. */
export function lightnessOf(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  return (Math.max(r!, g!, b!) + Math.min(r!, g!, b!)) / 2;
}

/** HSL saturation, 0-1. */
export function saturationOf(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r!, g!, b!);
  const min = Math.min(r!, g!, b!);
  if (max === min) return 0;
  const l = (max + min) / 2;
  return l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
}

function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** HSL back to hex. Hue in degrees, saturation and lightness 0-1. */
function fromHsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
    : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c]
    : h < 300 ? [x, 0, c]
    : [c, 0, x];
  return toHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

/**
 * Floors below which a background has stopped being a colour: a black, a
 * white, or a true grey. Deliberately far beneath the range the reference
 * implementation's own hand-picked palettes occupy — its least saturated is
 * deep-thought at 36.8%, and its darkest is that same colour at 7.5%
 * lightness. A floor anywhere near those would start overruling the model on
 * colours that are working perfectly well.
 *
 * This exists to rescue `#000000` and `#1c1c1e`, not to enforce taste. When a
 * derived tile looks black, suspect the card before suspecting the colour:
 * the palette that prompted this guard turned out to be more saturated than
 * half the prototype's, and what was actually missing was the floating card
 * and its `saturate(140%)` backdrop.
 */
const MIN_SATURATION = 0.15;
const MIN_LIGHTNESS = 0.06;

/**
 * Returns the colour unchanged unless it is degenerate, in which case it is
 * given the smallest nudge that makes it a colour again — keeping its hue, so
 * a desaturated blue-grey comes back blue rather than becoming a house default.
 *
 * A hueless input (a true grey or a black) has no hue to keep; it takes the
 * neutral slate the default palette already uses, so the result is a
 * deliberate colour rather than an accident of rounding.
 *
 * **Lightness is only ever raised, never lowered.** Darkening here would let a
 * light grey — which `derive.ts` must reject as unreadable under white text —
 * arrive at the luminance check already dimmed enough to pass, turning a
 * validation failure into a silent repair. This function rescues colours that
 * are too dark or too grey; deciding a colour is too *light* is not its job.
 */
export function liftDegenerateBackground(hex: string): string {
  const s = saturationOf(hex);
  const l = lightnessOf(hex);
  if (s >= MIN_SATURATION && l >= MIN_LIGHTNESS) return hex;
  // A true grey carries no hue to preserve. 220° is the blue-slate the neutral
  // default already reads as, so a colourless answer lands somewhere chosen.
  const hue = s === 0 ? 220 : hueOf(hex);
  return fromHsl(hue, Math.max(s, MIN_SATURATION), Math.max(l, MIN_LIGHTNESS));
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
