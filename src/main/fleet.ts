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
  /**
   * Profile ids the caller already has a tile open for — normally everything
   * `openFleet` enumerated and launched at boot. Seeds the watch's own record
   * of who has already been notified, so it never asks Hermes to confirm what
   * the caller already knows, and never re-derives it (and races doing so).
   */
  alreadyTiled: Iterable<string>;
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
   * The currently-running sweep, if any. Shared between the debounced timer
   * and `sweepNow` so a manual trigger arriving while a debounced sweep is
   * already in flight joins it instead of starting a redundant second
   * enumeration — see `sweepNow`.
   */
  private inFlight: Promise<void> | null = null;
  /**
   * Every profile id this watch has ever reported, plus whatever
   * `deps.alreadyTiled` seeded it with. Grows on every `onProfile` call —
   * seeding it once at construction and never adding to it would let a
   * profile whose tile the user later *closes* resurrect itself the next
   * time its agent writes anything under its own directory (memory, session
   * state, `circe.json`), since `isOpen` would report it closed and nothing
   * else would remember it was ever handled. A profile that has been
   * reported once stays reported for this watch's whole lifetime.
   */
  private readonly tiled: Set<string>;

  constructor(private readonly deps: FleetWatchDeps) {
    this.tiled = new Set(deps.alreadyTiled);
  }

  start(): () => void {
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

  /**
   * Triggers a sweep immediately, bypassing the debounce, for a caller that
   * already knows work might be sitting unnoticed — `openFleet`'s post-launch
   * catch-up (I2): each iteration of its launch loop awaits a 30s handshake
   * and a full session restore, so for a large fleet a profile that became
   * tileable mid-loop could otherwise sit unnoticed for minutes, until some
   * unrelated later filesystem event happened to sweep again.
   *
   * Deliberately not called from inside this class — a caller earns the
   * immediate catch-up by opting in explicitly (`openFleet` does; the wizard
   * handoff must not, since piling a sweep on top of a fresh handoff is
   * exactly the disruption I1 exists to avoid).
   *
   * Cancels any pending debounced timer first and shares `sweep`'s own
   * in-flight guard, so this can never run concurrently with — or
   * double-dispatch against — a debounced sweep already underway.
   */
  sweepNow(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    return this.sweep();
  }

  /** Guards concurrent runs: a second call while one is in flight joins it. */
  private sweep(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const run = this.doSweep().finally(() => {
      this.inFlight = null;
    });
    this.inFlight = run;
    return run;
  }

  private async doSweep(): Promise<void> {
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
      if (this.tiled.has(profile.id) || this.deps.isOpen(profile.id)) continue;
      // Marked before the call, not after: two overlapping sweeps (a burst
      // that outran the debounce, or two profiles becoming real in the same
      // sweep) must not both decide this profile is unhandled and both
      // launch it.
      this.tiled.add(profile.id);
      try {
        await this.deps.onProfile(profile);
      } catch (err) {
        console.warn(`Could not open a tile for profile "${profile.id}".`, err);
      }
    }
  }
}
