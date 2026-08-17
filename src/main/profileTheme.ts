import type { Palette } from '../shared/types';
import { DEFAULT_PALETTE } from './palette';
import { profileFilePath, type HermesRuntime } from './hermes/runtime';

/** The profile-owned file that carries an agent's colours (spec §3.1). */
export const THEME_FILE = 'circe.json';

const RECORD_VERSION = 1;

/**
 * Six-digit hex only. `hexToRgb` is `parseInt(hex.slice(1, 3), 16)`, so any
 * other shape yields `NaN` channels and an `rgba(NaN, …)` custom property,
 * which the browser drops — leaving an unstyled tile rather than a
 * default-coloured one. Rejecting here is what keeps the fallback visible.
 */
const HEX = /^#[0-9a-fA-F]{6}$/;

function isHex(v: unknown): v is string {
  return typeof v === 'string' && HEX.test(v);
}

export function serializeProfileTheme(palette: Palette): string {
  return `${JSON.stringify({ version: RECORD_VERSION, palette }, null, 2)}\n`;
}

/**
 * The palette a `circe.json` describes, or null for anything Circe should not
 * act on. Version-gated for the same reason `startup.ts` is: a file written by
 * a later Circe may carry fields this build would half-read.
 */
export function parseProfileTheme(json: string | null): Palette | null {
  if (json === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as { version?: unknown; palette?: unknown };
  if (record.version !== RECORD_VERSION) return null;
  const p = record.palette;
  if (typeof p !== 'object' || p === null) return null;
  const { bg, border, accent } = p as Record<string, unknown>;
  if (!isHex(bg) || !isHex(border) || !isHex(accent)) return null;
  return { bg, border, accent };
}

/**
 * A profile's own colours, or the neutral default.
 *
 * Never throws. `readHomeFile` rejects for a file that exists but cannot be
 * read — an unreadable `circe.json` costs colours, never a tile (§3.1), and a
 * profile whose theme cannot be read still has an agent behind it.
 */
export async function readProfilePalette(
  hermes: HermesRuntime,
  profileId: string,
): Promise<Palette> {
  let json: string | null;
  try {
    json = await hermes.readHomeFile(profileFilePath(profileId, THEME_FILE));
  } catch (err) {
    console.warn(`Could not read colours for profile "${profileId}"; using the default.`, err);
    return DEFAULT_PALETTE;
  }
  return parseProfileTheme(json) ?? DEFAULT_PALETTE;
}

/**
 * Writes a profile's colours. Callers treat a failure as non-fatal: it costs
 * colours, not an agent, and must never roll back a persona that succeeded
 * (ruling F-1).
 */
export async function writeProfileTheme(
  hermes: HermesRuntime,
  profileId: string,
  palette: Palette,
): Promise<void> {
  await hermes.writeHomeFile(profileFilePath(profileId, THEME_FILE), serializeProfileTheme(palette));
}
