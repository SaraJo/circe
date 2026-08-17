import type { Character, Palette } from '../shared/types';
import { liftDegenerateBackground } from './palette';
import type { HermesRuntime } from './hermes/runtime';

const HEX = /^#[0-9a-fA-F]{6}$/;
/** White body text needs a genuinely dark tile behind it. */
const MAX_BG_LUMINANCE = 0.22;

export function DERIVATION_PROMPT(fandom: string): string {
  return [
    `A user has chosen this fandom, universe, or community: "${fandom}".`,
    '',
    'Pick the single character from that world best suited to be a coordinator —',
    'the one who keeps track of what everyone else is doing, sees the whole picture,',
    'and would plausibly delegate work to specialists. Not the loudest or most',
    'powerful character. The one who organises. If the answer is a real community',
    'rather than a fiction, invent a fitting name in its idiom.',
    '',
    'Then choose three colours drawn from that character — their world, their',
    'palette, their temperament. Make them saturated: the tile is dark by',
    'necessity, and a dark colour that is also near-grey reads as black. Pick a',
    'colour that is unmistakably *a* colour — a deep green, a burnt orange, a',
    'bruised purple — not a neutral brown or charcoal.',
    '',
    'Reply with ONLY a JSON object and no other text:',
    '{',
    '  "name": "<the character\'s name>",',
    '  "tagline": "<four to eight words naming their role>",',
    '  "palette": {',
    '    "bg": "<#rrggbb, dark tile background>",',
    '    "border": "<#rrggbb, light tile border>",',
    '    "accent": "<#rrggbb, bright, readable on bg>"',
    '  },',
    '  "why": "<one sentence: why this character coordinates>"',
    '}',
    '',
    'All three colours must be six-digit hex. "bg" must be dark enough that white',
    'text is readable on it, and must not be a grey, a black, or a near-black.',
  ].join('\n');
}

/** Hermes profile ids are lowercase alphanumeric with hyphens, max 32 chars. */
export function toProfileId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/, '');
}

/** WCAG relative luminance, used only to reject an unreadable background. */
export function relativeLuminance(hex: string): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(parseInt(hex.slice(1, 3), 16));
  const g = channel(parseInt(hex.slice(3, 5), 16));
  const b = channel(parseInt(hex.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Models often wrap JSON in prose or a fence. Take the outermost object. */
function extractJson(reply: string): unknown {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error('Could not read a character out of that reply.');
  }
  try {
    return JSON.parse(reply.slice(start, end + 1));
  } catch {
    throw new Error('Could not read a character out of that reply.');
  }
}

function validate(raw: unknown, fandom: string): Character {
  const o = raw as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  const tagline = typeof o.tagline === 'string' ? o.tagline.trim() : '';
  const why = typeof o.why === 'string' ? o.why.trim() : '';
  const p = (o.palette ?? {}) as Record<string, unknown>;

  if (!name) throw new Error('Could not read a character out of that reply.');
  for (const key of ['bg', 'border', 'accent'] as const) {
    if (typeof p[key] !== 'string' || !HEX.test(p[key] as string)) {
      throw new Error(`The ${key} colour was not a six-digit hex value.`);
    }
  }
  const palette: Palette = {
    // Repaired rather than rejected. A background that came back as a black or
    // a true grey is a cosmetic failure, and failing the whole derivation over
    // it would make the user re-roll their character to fix a colour. The lift
    // is a no-op for anything that is already a colour — including palettes
    // considerably darker than this one.
    bg: liftDegenerateBackground((p.bg as string).toLowerCase()),
    border: (p.border as string).toLowerCase(),
    accent: (p.accent as string).toLowerCase(),
  };
  if (relativeLuminance(palette.bg) > MAX_BG_LUMINANCE) {
    throw new Error('The background colour was too light to read white text on.');
  }
  const profileId = toProfileId(name);
  if (!profileId) throw new Error('Could not read a character out of that reply.');

  return { name, profileId, tagline, palette, why, fandom };
}

export interface DeriveOptions {
  /** Extra attempts after the first. One retry by default. */
  retries?: number;
}

/**
 * Runs the derivation through the `default` profile, which is the only profile
 * guaranteed to exist. This is a model call and can take up to a minute.
 */
export async function deriveCharacter(
  hermes: HermesRuntime,
  fandom: string,
  opts: DeriveOptions = {},
): Promise<Character> {
  const retries = opts.retries ?? 1;
  const prompt = DERIVATION_PROMPT(fandom);
  let last: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return validate(extractJson(await hermes.query('default', prompt)), fandom);
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error('Derivation failed.');
}
