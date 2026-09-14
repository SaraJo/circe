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
  /**
   * The character's full name as the wider world writes it, e.g. `Trillian
   * Astra` for a display name of `Trillian`. Used only by the avatar lookup,
   * which needs a name Wikipedia can resolve; every screen shows `name`.
   * Falls back to `name` when the model gives nothing better.
   */
  fullName: string;
  /**
   * The Fandom wiki this character lives on, e.g. `lotr.fandom.com`, or `''`
   * when the model named nothing usable. Validated at derivation, because it
   * is the one model-supplied field that chooses an outbound destination.
   */
  wiki: string;
  /** The page title on that wiki. Falls back to `fullName`. */
  wikiPage: string;
  /** Hermes on-disk profile id: lowercase, `[a-z0-9-]`, <= 32 chars. */
  profileId: string;
  /** Four to eight words, e.g. `the one who keeps the plot`. */
  tagline: string;
  palette: Palette;
  /** One sentence explaining why this character coordinates. Shown on the meet screen. */
  why: string;
  /** The fandom the user typed, carried through so the SOUL template can name it. */
  fandom: string;
  /**
   * How this character speaks — diction, rhythm, the words they reach for.
   * Written into the profile's `## Voice` section. Empty means plain-spoken,
   * which is also what a user who asks for plain speech ends up with.
   */
  voice: string;
  /**
   * One line in the character's own voice, shown on the meet screen while the
   * user is still deciding. Not the greeting: nothing has been accepted yet.
   * Empty shows nothing, and is what a character with no voice always has.
   */
  intro: string;
  /** The agent's own first message, in voice. Empty falls back to Circe's scripted one. */
  greeting: string;
  /** One in-voice sentence asking whether to keep speaking this way. Empty asks nothing. */
  voiceCheck: string;
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

/** Renderer-facing conversation tabs for one agent tile. */
export interface TileTabsView {
  /** Active conversation model reported by Hermes, or null when unavailable. */
  model?: string | null;
  titles?: string[];
  /** Hermes session ids never cross the preload boundary; only their count and display titles do. */
  count: number;
  activeIndex: number;
  /** True while a turn, replay, or permission decision makes switching unsafe. */
  busy: boolean;
  /** A new session can be created while another session processes a turn. */
  canCreate?: boolean;
  /** Older ACP agents without session/load keep the existing one-conversation UI. */
  supported: boolean;
}

export interface FleetIdentityProposal {
  profile: HermesProfile;
  character: Character;
}

export type FleetFandomIntent = 'rename' | 'keep' | 'new-coordinator';

export type WizardStep =
  | { kind: 'welcome' }
  | { kind: 'runtime-checking' }
  | { kind: 'runtime-missing' }
  | { kind: 'provider-missing' }
  | { kind: 'existing-fleet'; profiles: HermesProfile[] }
  | { kind: 'fleet-selection'; profiles: HermesProfile[] }
  | {
      kind: 'fleet-identity-choice';
      profiles: HermesProfile[];
      ignoredProfileIds: string[];
    }
  | {
      kind: 'fleet-fandom';
      profiles: HermesProfile[];
      intent: FleetFandomIntent;
      ignoredProfileIds?: string[];
    }
  | {
      kind: 'fleet-deriving';
      profiles: HermesProfile[];
      intent: FleetFandomIntent;
      fandom: string;
      ignoredProfileIds?: string[];
    }
  | {
      kind: 'fleet-derive-failed';
      profiles: HermesProfile[];
      intent: FleetFandomIntent;
      fandom: string;
      message: string;
      ignoredProfileIds?: string[];
    }
  | {
      kind: 'fleet-preview';
      proposals: FleetIdentityProposal[];
      fandom: string;
      ignoredProfileIds: string[];
    }
  | {
      kind: 'fleet-saving';
      proposals: FleetIdentityProposal[];
      selectedProfileIds: string[];
    }
  | {
      kind: 'coordinator-choice';
      profiles: HermesProfile[];
      fandom: string | null;
      ignoredProfileIds: string[];
    }
  | {
      kind: 'new-coordinator-preview';
      profiles: HermesProfile[];
      character: Character;
      ignoredProfileIds: string[];
    }
  | { kind: 'adoption-write-failed'; message: string }
  | {
      kind: 'fleet-launching';
      mainProfileId: string;
      openingProfileId: string | null;
      ignoredProfileIds: string[];
    }
  | { kind: 'fandom' }
  | { kind: 'deriving'; fandom: string }
  | { kind: 'derive-failed'; fandom: string; message: string }
  /** The default profile already holds a persona the user wrote. */
  | { kind: 'claim-default'; character: Character; existingName: string }
  | { kind: 'meet'; character: Character }
  /**
   * The persona and skill are being written. Distinct from `launching`
   * precisely so the writes can finish *before* anything spawns an agent
   * against them — see `Wizard.commitAccept`.
   */
  | { kind: 'saving'; character: Character }
  /**
   * A write failed. Nothing has been launched; the user can retry.
   *
   * `personaReplaced` is non-null when `SOUL.md` had already been written by
   * the time the failure happened — i.e. the skill install is what broke. The
   * user's persona *is* gone in that case (a backup was taken if there was
   * anything worth keeping), and the screen must say so rather than claim
   * their setup is untouched. Null means nothing was written.
   */
  | {
      kind: 'write-failed';
      character: Character;
      message: string;
      personaReplaced: { path: string; backedUpTo: string | null } | null;
    }
  | { kind: 'launching'; character: Character; profileId: string; ignoredProfileIds?: string[] };
