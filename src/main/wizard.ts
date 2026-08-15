import type { Character, WizardStep } from '../shared/types';
import type { HermesRuntime } from './hermes/runtime';
import { deriveCharacter } from './derive';
import { hasConfiguredDefault } from './profiles';
import { writeSoul } from './soul';
import { loadTemplate, renderOrchestratorSoul } from './orchestrator/soulTemplate';
import { installOrchestratorSkill } from './orchestrator/skill';

/**
 * The whole onboarding flow, with no Electron in it. The renderer observes
 * `state` and calls the transitions; nothing here knows a window exists.
 */
export class Wizard {
  state: WizardStep = { kind: 'welcome' };
  private listeners: Array<(s: WizardStep) => void> = [];
  private character: Character | null = null;

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

  async submitFandom(fandom: string): Promise<void> {
    const trimmed = fandom.trim();
    if (!trimmed) return;
    this.set({ kind: 'deriving', fandom: trimmed });
    let character: Character;
    try {
      character = await deriveCharacter(this.hermes, trimmed);
    } catch (err) {
      this.set({
        kind: 'derive-failed',
        fandom: trimmed,
        message: err instanceof Error ? err.message : 'Something went wrong.',
      });
      return;
    }
    this.character = character;

    const profiles = await this.hermes.listProfiles();
    if (hasConfiguredDefault(profiles)) {
      const existing = profiles.find((p) => p.id === 'default')!;
      this.set({ kind: 'claim-default', character, existingName: existing.displayName });
      return;
    }
    this.set({ kind: 'meet', character });
  }

  /** Re-runs derivation against the same answer — "not that one". */
  async retryDerivation(): Promise<void> {
    const s = this.state;
    const fandom =
      s.kind === 'derive-failed' || s.kind === 'deriving'
        ? s.fandom
        : (this.character?.fandom ?? '');
    if (fandom) await this.submitFandom(fandom);
  }

  /** The user accepted overwriting a persona they wrote. */
  async confirmClaimDefault(): Promise<void> {
    if (this.state.kind !== 'claim-default') return;
    await this.accept();
  }

  /** The user refused. Nothing has been written, and nothing will be. */
  declineClaimDefault(): void {
    if (this.state.kind !== 'claim-default') return;
    this.character = null;
    this.set({ kind: 'fandom' });
  }

  /**
   * Writes the persona and the skill. `writeSoul` handles backing up anything
   * the user wrote, so the claim-default screen is a courtesy, not the guard.
   */
  async accept(): Promise<void> {
    const character = this.character;
    if (!character) return;
    const soul = renderOrchestratorSoul(character, await loadTemplate());
    await writeSoul({ hermes: this.hermes, profileId: 'default', contents: soul });
    await installOrchestratorSkill(this.hermes, 'default');
    this.set({ kind: 'launching', character, profileId: 'default' });
  }
}
