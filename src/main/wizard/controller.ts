import { locateHermes, MIN_HERMES_VERSION } from '../hermes/locate';
import { enumerateProfiles } from '../hermes/profiles';
import type { StateStore } from '../state/store';
import type { HermesProfile } from '../../shared/types';

export type ScreenId =
  | 'welcome'    // 1
  | 'runtime'    // 2
  | 'profiles'   // 4b
  | 'create'     // 4a
  | 'walkthrough'// 5
  | 'provider'   // 6
  | 'ready';     // 7

export interface RuntimeStatus {
  installed: boolean;
  bin: string | null;
  version: string | null;
  message: string;
}

export interface WizardDeps {
  store: StateStore;
  /** The Hermes profile home, e.g. ~/.hermes — where profiles are enumerated. */
  hermesHome: string;
  /**
   * The OS home directory. Distinct from `hermesHome`: locateHermes falls back
   * to <home>/.local/bin/hermes when PATH yields nothing, so this has to be
   * injectable or a test asserting the not-found path finds the developer's
   * real install instead. Defaults to homedir() in production.
   */
  home?: string;
  env?: NodeJS.ProcessEnv;
}

export class WizardController {
  private current: ScreenId = 'welcome';
  private history: ScreenId[] = [];

  constructor(private readonly deps: WizardDeps) {}

  get screen(): ScreenId {
    return this.current;
  }

  /** Resumes at the persisted screen, so quitting mid-run doesn't restart (§8.2). */
  async start(): Promise<ScreenId> {
    const saved = this.deps.store.get().wizardScreen;
    this.current = (saved as ScreenId | null) ?? 'welcome';
    this.history = [];
    return this.current;
  }

  goto(screen: ScreenId): void {
    this.history.push(this.current);
    this.current = screen;
    void this.deps.store.save({ ...this.deps.store.get(), wizardScreen: screen });
  }

  back(): void {
    const previous = this.history.pop();
    if (!previous) return;
    this.current = previous;
    void this.deps.store.save({ ...this.deps.store.get(), wizardScreen: previous });
  }

  /** Screen 2. Advances automatically when Hermes is present and new enough. */
  async detectRuntime(): Promise<RuntimeStatus> {
    const found = await locateHermes({ env: this.deps.env, home: this.deps.home });
    if (found.ok) {
      return { installed: true, bin: found.bin, version: found.version, message: '' };
    }
    return {
      installed: false,
      bin: found.bin,
      version: found.version,
      message: found.message.includes(MIN_HERMES_VERSION)
        ? found.message
        : `${found.message}`,
    };
  }

  /** Screen 3. Branches to 4a when nothing real exists, otherwise 4b (§5.4). */
  async detectProfiles(): Promise<{ next: ScreenId; profiles: HermesProfile[] }> {
    const profiles = await enumerateProfiles(this.deps.hermesHome);
    const real = profiles.filter((p) => p.real);
    return { next: real.length === 0 ? 'create' : 'profiles', profiles };
  }
}
