/** The three permission-gate states from spec §6.4, in cycle order. */
export const GATE_MODES = ['locked', 'ask', 'unlocked'] as const;
export type GateMode = (typeof GATE_MODES)[number];

/** Per-profile theming from spec §6.3.2. Both values are CSS colors. */
export interface Palette {
  accent: string;
  background: string;
}

/** The parsed `# Name — tagline` first line of a SOUL.md. */
export interface SoulHeading {
  name: string;
  tagline: string | null;
}

/** A Hermes profile discovered on disk. */
export interface HermesProfile {
  /** Hermes profile id — what `hermes -p <id>` takes. 'default' for the root profile. */
  id: string;
  /** Absolute path to the profile directory. */
  path: string;
  /** Absolute path to the profile's SOUL.md. */
  soulPath: string;
  /** True for the root `~/.hermes` profile, which is structurally different. */
  isDefault: boolean;
  /** Result of the §5.4 realness rule. */
  real: boolean;
  /** Display name from the SOUL.md heading; falls back to `id` when absent. */
  displayName: string;
  /** Tagline from the SOUL.md heading, or null. */
  tagline: string | null;
}

export interface Message {
  role: 'user' | 'agent' | 'tool' | 'system';
  text: string;
  /** Optional visual treatment. 'denied' renders the locked-gate card from §6.4. */
  kind?: 'error' | 'denied' | 'pending';
}

export interface TabState {
  id: string;
  title: string;
  /** ACP session id, or null before the session is established. */
  sessionId: string | null;
  messages: Message[];
}

export interface TileState {
  profileId: string;
  bounds: { x: number; y: number; width: number; height: number };
  gateMode: GateMode;
  palette: Palette;
  tabs: TabState[];
  activeTabId: string;
  /** False when the user chose "leave alone (don't tile)" in Screen 4b. */
  tiled: boolean;
  /** §5.5 — set by the Screen 5 role picker, or by inference for imported profiles. */
  isCodingProfile: boolean;
}

export interface CirceState {
  version: 1;
  onboarded: boolean;
  mainOperatorId: string | null;
  tiles: Record<string, TileState>;
  /** Where the wizard left off, so §8.2 can resume instead of restarting. */
  wizardScreen: string | null;
}

export const DEFAULT_PALETTE: Palette = {
  accent: '#8b7fd4',
  background: '#1a1820',
};

export function emptyState(): CirceState {
  return { version: 1, onboarded: false, mainOperatorId: null, tiles: {}, wizardScreen: null };
}
