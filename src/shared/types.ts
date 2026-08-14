/** The three colours a character's world contributes to their tile. */
export interface Palette {
  /** Dark tile background. Hex, e.g. `#1e2952`. */
  bg: string;
  /** Light tile border. Hex. */
  border: string;
  /** Bright accent, readable against `bg`. Hex. */
  accent: string;
}

/** What the derivation produces from a fandom, and what a tile is themed by. */
export interface Character {
  /** Display name, e.g. `Trillian`. */
  name: string;
  /** Hermes on-disk profile id: lowercase, `[a-z0-9-]`, <= 32 chars. */
  profileId: string;
  /** Four to eight words, e.g. `the one who keeps the plot`. */
  tagline: string;
  palette: Palette;
  /** One sentence explaining why this character coordinates. Shown on the meet screen. */
  why: string;
  /** The fandom the user typed, carried through so the SOUL template can name it. */
  fandom: string;
}

/** The `# Name — tagline` line at the top of a SOUL.md. */
export interface SoulHeading {
  name: string;
  tagline: string | null;
}

export interface HermesProfile {
  /** On-disk profile name. The root profile's id is the literal string `default`. */
  id: string;
  /** From the SOUL.md H1 when there is one, otherwise falls back to `id`. */
  displayName: string;
  model: string | null;
  /** False for an untouched Hermes scaffold. See `profiles.ts`. */
  isReal: boolean;
}
