import { enumerateProfiles } from './hermes/profiles';
import type { TileManager } from './tiles/manager';
import type { StateStore } from './state/store';

export interface SkippedTile {
  profileId: string;
  reason: 'not-tiled' | 'missing';
}

export interface FleetDeps {
  store: StateStore;
  tiles: TileManager;
  hermesHome: string;
}

const TILE_W = 500;
const TILE_H = 600;
const GAP = 20;

export class Fleet {
  constructor(private readonly deps: FleetDeps) {}

  /** Works out what would launch, without launching it. */
  async plan(): Promise<{ launchable: string[]; skipped: SkippedTile[] }> {
    const onDisk = new Set((await enumerateProfiles(this.deps.hermesHome)).map((p) => p.id));
    const launchable: string[] = [];
    const skipped: SkippedTile[] = [];

    for (const [profileId, tile] of Object.entries(this.deps.store.get().tiles)) {
      if (!tile.tiled) {
        skipped.push({ profileId, reason: 'not-tiled' });
      } else if (!onDisk.has(profileId)) {
        // §8.2 — refuse to spawn, name the profile, leave the others alone.
        skipped.push({ profileId, reason: 'missing' });
      } else {
        launchable.push(profileId);
      }
    }
    return { launchable, skipped };
  }

  async launch(): Promise<{ launched: number; skipped: SkippedTile[] }> {
    const { launchable, skipped } = await this.plan();
    let launched = 0;

    for (const profileId of launchable) {
      try {
        await this.deps.tiles.spawnTile(profileId);
        launched += 1;
      } catch {
        // A tile that fails to spawn must not take the rest of the fleet down.
        skipped.push({ profileId, reason: 'missing' });
      }
    }
    return { launched, skipped };
  }

  /** Grid layout across the primary display (§6 Screen 7). */
  layout(
    count: number,
    display: { width: number; height: number },
  ): { x: number; y: number; width: number; height: number }[] {
    if (count <= 0) return [];
    const perRow = Math.max(1, Math.floor((display.width + GAP) / (TILE_W + GAP)));
    return Array.from({ length: count }, (_, i) => ({
      x: (i % perRow) * (TILE_W + GAP),
      y: Math.floor(i / perRow) * (TILE_H + GAP),
      width: TILE_W,
      height: TILE_H,
    }));
  }
}
