import type { Character, WizardStep } from '../shared/types';
import type { HermesRuntime } from './hermes/runtime';
import { deriveCharacter } from './derive';
import { hasConfiguredDefault } from './profiles';
import { writeSoul } from './soul';
import { loadTemplate, renderOrchestratorSoul } from './orchestrator/soulTemplate';
import { installOrchestratorSkill } from './orchestrator/skill';
import { LAST_LAUNCH_PATH, serializeLastLaunch } from './startup';

/**
 * States from which submitting a fandom makes sense: the fresh question, a
 * failed attempt, and — deliberately — a derivation already in flight. A
 * user who gets impatient and resubmits supersedes the one already running;
 * `runDerivation`'s generation token reconciles whichever settles last,
 * rather than a busy-flag locking the input while one is pending.
 */
const FANDOM_ENTRY_STATES = new Set<WizardStep['kind']>(['fandom', 'derive-failed', 'deriving']);

/**
 * States from which "try another character" is meaningful: a failed or
 * in-flight derivation, or either of the two character-holding review
 * screens. Deliberately not the same set as `FANDOM_ENTRY_STATES` —
 * `retryDerivation` legitimately runs from `meet`/`claim-default`, which
 * `submitFandom` must not, and must NOT run from `saving`/`write-failed`/
 * `launching`, where a lingering `this.character` would otherwise let it fire
 * a real derivation over a write already in progress or awaiting a retry.
 */
const RETRY_ENTRY_STATES = new Set<WizardStep['kind']>([
  'derive-failed',
  'deriving',
  'meet',
  'claim-default',
]);

/**
 * The whole onboarding flow, with no Electron in it. The renderer observes
 * `state` and calls the transitions; nothing here knows a window exists.
 */
export class Wizard {
  state: WizardStep = { kind: 'welcome' };
  private listeners: Array<(s: WizardStep) => void> = [];
  private character: Character | null = null;
  /**
   * Bumped on every derivation attempt. A resolving call compares its own
   * captured value against the current one before touching state — if
   * something newer has started, its result is stale and is dropped.
   */
  private generation = 0;

  constructor(private hermes: HermesRuntime) {}

  onChange(cb: (s: WizardStep) => void): void {
    this.listeners.push(cb);
  }

  private set(next: WizardStep): void {
    this.state = next;
    for (const cb of this.listeners) cb(next);
  }

  /** Runtime and provider checks, then the fandom question. */
  async start(): Promise<void> {
    this.set({ kind: 'runtime-checking' });
    if ((await this.hermes.version()) === null) {
      this.set({ kind: 'runtime-missing' });
      return;
    }
    // Derivation is a model call, so a provider has to exist before the
    // fandom question — otherwise the user answers it and then hits a wall.
    if (!(await this.hermes.hasProvider())) {
      this.set({ kind: 'provider-missing' });
      return;
    }
    this.set({ kind: 'fandom' });
  }

  /**
   * The public fandom-submission entry point. Only proceeds from a state
   * where typing (or retyping) a fandom is sensible — not from screens like
   * `provider-missing` or `launching`, where a submission would otherwise
   * fire a real model call for no reason.
   */
  async submitFandom(fandom: string): Promise<void> {
    if (!FANDOM_ENTRY_STATES.has(this.state.kind)) return;
    await this.runDerivation(fandom);
  }

  /**
   * Re-runs derivation against the same answer — "not that one". Reads the
   * fandom from state when one is in flight or just failed, otherwise falls
   * back to the already-derived character (`meet`/`claim-default`). Calls
   * `runDerivation` directly rather than `submitFandom`, because retrying is
   * legitimate from `meet`/`claim-default` too, and those aren't in
   * `submitFandom`'s entry set. Guarded by its own `RETRY_ENTRY_STATES` —
   * routing around `submitFandom`'s guard means this needed one of its own,
   * otherwise a lingering `this.character` would make it fire from anywhere,
   * `launching` included.
   */
  async retryDerivation(): Promise<void> {
    if (!RETRY_ENTRY_STATES.has(this.state.kind)) return;
    const s = this.state;
    const fandom =
      s.kind === 'derive-failed' || s.kind === 'deriving'
        ? s.fandom
        : (this.character?.fandom ?? '');
    if (fandom) await this.runDerivation(fandom);
  }

  /**
   * The actual derivation run, generation-tokened so a stale resolution can
   * never clobber a newer one — whichever call was issued *last* wins,
   * regardless of which one *resolves* last.
   */
  private async runDerivation(fandom: string): Promise<void> {
    const trimmed = fandom.trim();
    if (!trimmed) return;
    const gen = ++this.generation;
    this.set({ kind: 'deriving', fandom: trimmed });
    let character: Character;
    try {
      character = await deriveCharacter(this.hermes, trimmed);
    } catch (err) {
      // A newer submission has already started (or finished) — this
      // failure is stale and must not stomp on a live state.
      if (gen !== this.generation) return;
      this.set({
        kind: 'derive-failed',
        fandom: trimmed,
        message: err instanceof Error ? err.message : 'Something went wrong.',
      });
      return;
    }
    if (gen !== this.generation) return;

    const profiles = await this.hermes.listProfiles();
    // Re-checked *after* the await, not just before it: `listProfiles` shells
    // out to `hermes profile list`, and a newer derivation issued during that
    // round trip has already claimed the generation. Without this second
    // check a superseded run would still push its own `meet`/`claim-default`
    // — and in the worst interleaving overwrite `launching`, re-opening
    // `accept()`'s guard for a second write.
    if (gen !== this.generation) return;
    this.character = character;

    if (hasConfiguredDefault(profiles)) {
      const existing = profiles.find((p) => p.id === 'default')!;
      this.set({ kind: 'claim-default', character, existingName: existing.displayName });
      return;
    }
    this.set({ kind: 'meet', character });
  }

  /** The user accepted overwriting a persona they wrote. */
  async confirmClaimDefault(): Promise<void> {
    if (this.state.kind !== 'claim-default') return;
    await this.commitAccept();
  }

  /** The user refused. Nothing has been written, and nothing will be. */
  declineClaimDefault(): void {
    if (this.state.kind !== 'claim-default') return;
    this.character = null;
    this.set({ kind: 'fandom' });
  }

  /**
   * Writes the persona and the skill. Refuses to start once a write is
   * underway or done (`saving`, `launching`) and refuses to run directly
   * from `claim-default` — that screen's explicit confirm
   * (`confirmClaimDefault`) is the only sanctioned route out of it, so a
   * future renderer can't wire a button straight to `accept()` and skip the
   * confirm step.
   *
   * `write-failed` is deliberately *not* in the refusal set: that is the
   * retry path, and it is only ever reached after a `meet` accept or a
   * `claim-default` confirm has already happened, so retrying from it can't
   * launder a confirm the user never gave.
   */
  async accept(): Promise<void> {
    const k = this.state.kind;
    if (k === 'saving' || k === 'launching' || k === 'claim-default') return;
    await this.commitAccept();
  }

  /**
   * `writeSoul` handles backing up anything the user wrote, so the
   * claim-default screen is a courtesy, not the guard.
   *
   * Ordering is load-bearing. `set()` notifies its listeners *synchronously*,
   * and `src/main/index.ts` reacts to `launching` by spawning
   * `hermes -p default acp` — which reads `SOUL.md` at startup. Announcing
   * `launching` before the writes therefore raced the agent's own read
   * against them, and the user could meet the scaffold Hermes instead of
   * their character. So both writes complete first, and `launching` is the
   * last thing that happens. `saving` exists purely to give the UI something
   * to show in the meantime without reusing the state that means "spawn now".
   *
   * `saving` is entered synchronously, before the first `await`, so it is
   * still the re-entrancy guard: a second call issued before this one settles
   * sees it and bails in `accept()`. `this.character` is cleared only once
   * the writes have actually succeeded — the failure path keeps it so the
   * user can retry.
   */
  private async commitAccept(): Promise<void> {
    const character = this.character;
    if (!character) return;
    this.set({ kind: 'saving', character });
    // Tracked so the failure path can tell the two halves apart: a failure in
    // `installOrchestratorSkill` happens *after* the persona has already been
    // replaced, and the screen must not then claim nothing was changed
    // (Ruling F-1). Stays null if `writeSoul` is what threw.
    let personaReplaced: { path: string; backedUpTo: string | null } | null = null;
    try {
      const soul = renderOrchestratorSoul(character, await loadTemplate());
      const written = await writeSoul({
        hermes: this.hermes,
        profileId: 'default',
        contents: soul,
      });
      personaReplaced = { path: written.path, backedUpTo: written.backedUpTo };
      await installOrchestratorSkill(this.hermes, 'default');
    } catch (err) {
      // Nothing is launched: a tile in front of an agent with no persona is
      // worse than an honest error, and an unhandled rejection here used to
      // leave the wizard stuck on "Starting…" forever.
      this.set({
        kind: 'write-failed',
        character,
        message: err instanceof Error ? err.message : String(err),
        personaReplaced,
      });
      return;
    }
    // Deliberately outside the block above, and deliberately swallowed. This
    // record only caches the tile's colours for the next cold start — the way
    // back to the agent is `SOUL.md`, which is already written by now. Failing
    // the launch over a cache write would trade a working agent for nothing.
    try {
      await this.hermes.writeHomeFile(
        LAST_LAUNCH_PATH,
        serializeLastLaunch(character, 'default'),
      );
    } catch (err) {
      console.warn(`Could not record the launch (${LAST_LAUNCH_PATH}):`, err);
    }

    this.character = null;
    this.set({ kind: 'launching', character, profileId: 'default' });
  }
}
