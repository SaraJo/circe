import type { HermesProfile, Palette } from '../shared/types';
import type { HermesRuntime } from './hermes/runtime';
import { profileFilePath } from './hermes/runtime';
import { parseProfileTheme, serializeProfileTheme, THEME_FILE } from './profileTheme';

function hash(text: string): number {
  let value = 2166136261;
  for (const char of text) {
    value ^= char.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function hsl(hue: number, saturation: number, lightness: number): string {
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness - c / 2;
  const [r, g, b] =
    hue < 60 ? [c, x, 0]
    : hue < 120 ? [x, c, 0]
    : hue < 180 ? [0, c, x]
    : hue < 240 ? [0, x, c]
    : hue < 300 ? [x, 0, c]
    : [c, 0, x];
  const channel = (value: number) =>
    Math.round((value + m) * 255).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** Stable, colourful fallback for a retained identity Circe has never seen. */
export function retainedPalette(profileId: string, displayName = profileId): Palette {
  const hue = hash(`${profileId}\0${displayName}`) % 360;
  return {
    bg: hsl(hue, 0.48, 0.18),
    border: hsl(hue, 0.62, 0.72),
    accent: hsl((hue + 12) % 360, 0.78, 0.68),
  };
}

/** Writes only when absent; malformed or user-authored files are never replaced. */
export async function ensureRetainedTheme(
  hermes: HermesRuntime,
  profile: HermesProfile,
): Promise<Palette> {
  const path = profileFilePath(profile.id, THEME_FILE);
  const existing = await hermes.readHomeFile(path);
  const parsed = parseProfileTheme(existing);
  if (existing !== null) return parsed ?? retainedPalette(profile.id, profile.displayName);
  const palette = retainedPalette(profile.id, profile.displayName);
  await hermes.writeHomeFile(path, serializeProfileTheme(palette));
  return palette;
}
