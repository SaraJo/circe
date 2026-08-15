import type { Character, WizardStep } from '../shared/types';
import type { HermesRuntime } from './hermes/runtime';
import { deriveCharacter } from './derive';
import { hasConfiguredDefault } from './profiles';
import { writeSoul } from './soul';
import { loadTemplate, renderOrchestratorSoul } from './orchestrator/soulTemplate';
import { installOrchestratorSkill } from './orchestrator/skill';

/**
 * States from which submitting a fandom makes sense: the fresh question, a
 * failed attempt, and — deliberately — a derivation already in flight. A
 * user who gets impatient and resubmits supersedes the one already running;
 * `runDerivation`'s generation token reconciles whichever settles last,
 * rather than a busy-flag locking the input while one is pending.
 */
const FANDOM_ENTRY_STATES = new Set<WizardStep['kind']>(['fandom', 'derive-failed', 'deriving']);

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
   * `submitFandom`'s entry set.
   */
  async retryDerivation(): Promise<void> {
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
    this.character = character;

    const profiles = await this.hermes.listProfiles();
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
   * Writes the persona and the skill. Refuses to start once already done
   * (`launching`) and refuses to run directly from `claim-default` — that
   * screen's explicit confirm (`confirmClaimDefault`) is the only sanctioned
   * route out of it, so a future renderer can't wire a button straight to
   * `accept()` and skip the confirm step.
   */
  async accept(): Promise<void> {
    if (this.state.kind === 'launching' || this.state.kind === 'claim-default') return;
    await this.commitAccept();
  }

  /**
   * `writeSoul` handles backing up anything the user wrote, so the
   * claim-default screen is a courtesy, not the guard. The transition to
   * `launching` happens *before* any `await`, synchronously, so a second
   * call issued before this one's first await settles sees `launching`
   * already and bails via `accept()`'s guard — the re-entrancy guard is the
   * state transition itself, not a separate flag.
   */
  private async commitAccept(): Promise<void> {
    const character = this.character;
    if (!character) return;
    this.set({ kind: 'launching', character, profileId: 'default' });
    const soul = renderOrchestratorSoul(character, await loadTemplate());
    await writeSoul({ hermes: this.hermes, profileId: 'default', contents: soul });
    await installOrchestratorSkill(this.hermes, 'default');
  }
}
