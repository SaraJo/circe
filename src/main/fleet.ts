import type { HermesProfile } from '../shared/types';
import type { HermesRuntime } from './hermes/runtime';

/**
 * The profiles that deserve a tile: the ones that describe themselves.
 *
 * `isReal` is Hermes-derived and is exactly "the SOUL.md has an H1" — spec
 * §5.4's realness rule. A profile that is still Hermes's stock scaffold has no
 * character to show and no persona for an agent to load, so tiling it would put
 * an unnamed grey window in front of the user.
 */
export async function tileableProfiles(hermes: HermesRuntime): Promise<HermesProfile[]> {
  return (await hermes.listProfiles()).filter((p) => p.isReal);
}

export interface FleetWatchDeps {
  hermes: HermesRuntime;
  /** True when this profile already has a tile. */
  isOpen(profileId: string): boolean;
  /** Called once per profile that has become tileable. */
  onProfile(profile: HermesProfile): void | Promise<void>;
  /** The prototype settles at 600ms; tests run it far shorter. */
  debounceMs?: number;
}

/**
 * Opens a tile when a new agent appears on disk.
 *
 * This is the visible half of the product's core loop: the orchestrator creates
 * a specialist through conversation and it materialises on the desktop. It is a
 * watch rather than a tool Circe exposes because an agent must not need a
 * Circe-provided capability to bring a peer into existence — that is constraint
 * 10's inversion in a gentler form, and it would leave a profile created at a
 * terminal with no tile (§4.3).
 *
 * Debounced because a profile's creation is several filesystem events — the
 * directory, then `SOUL.md`, then whatever else the creator writes — and
 * because the readiness condition is only met partway through. Every fire
 * re-enumerates from Hermes rather than trusting the event's path, so a burst
 * costs one enumeration and a half-written profile is simply not yet tileable.
 */
export class FleetWatch {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  /**
   * Profiles that were already tileable the instant the watch started.
   * Opening tiles for those is whatever enumerated the fleet at boot; this
   * watch's job is only the ones that show up afterwards. `onProfile` is
   * documented as firing once per profile, so a profile real at start must
   * never reach it — `isOpen` alone can't provide that guarantee, since the
   * caller only learns a profile exists by way of this watch calling
   * `onProfile` for it in the first place.
   */
  private alreadyTiled: Promise<Set<string>> = Promise.resolve(new Set());

  constructor(private readonly deps: FleetWatchDeps) {}

  start(): () => void {
    this.alreadyTiled = tileableProfiles(this.deps.hermes)
      .then((profiles) => new Set(profiles.map((p) => p.id)))
      .catch(() => new Set<string>());

    const unwatch = this.deps.hermes.watchHome((relPath) => {
      // The home also carries `state.db`, logs, and session files, all of which
      // change constantly during a conversation. Only a profile directory can
      // produce a new agent.
      if (!relPath.startsWith('profiles/') && relPath !== 'profiles') return;
      this.schedule();
    });
    return () => {
      this.stopped = true;
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      unwatch();
    };
  }

  private schedule(): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.sweep();
    }, this.deps.debounceMs ?? 600);
  }

  private async sweep(): Promise<void> {
    if (this.stopped) return;
    const baseline = await this.alreadyTiled;
    if (this.stopped) return;
    let profiles: HermesProfile[];
    try {
      profiles = await tileableProfiles(this.deps.hermes);
    } catch (err) {
      // A watch that dies on one bad enumeration stops the core loop with no
      // sign to the user. The next event sweeps again.
      console.warn('Could not enumerate profiles; will try again on the next change.', err);
      return;
    }
    for (const profile of profiles) {
      if (this.stopped) return;
      if (baseline.has(profile.id) || this.deps.isOpen(profile.id)) continue;
      try {
        await this.deps.onProfile(profile);
      } catch (err) {
        console.warn(`Could not open a tile for profile "${profile.id}".`, err);
      }
    }
  }
}
