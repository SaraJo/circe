import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  emptyState,
  GATE_MODES,
  type CirceState,
  type TileState,
  type GateMode,
} from '../../shared/types';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validTile(v: unknown): v is TileState {
  if (!isRecord(v)) return false;
  const b = v.bounds;
  return (
    typeof v.profileId === 'string' &&
    isRecord(b) &&
    typeof b.x === 'number' &&
    typeof b.y === 'number' &&
    typeof b.width === 'number' &&
    typeof b.height === 'number' &&
    GATE_MODES.includes(v.gateMode as GateMode) &&
    isRecord(v.palette) &&
    Array.isArray(v.tabs) &&
    typeof v.activeTabId === 'string' &&
    typeof v.tiled === 'boolean' &&
    typeof v.isCodingProfile === 'boolean'
  );
}

/**
 * Coerces whatever is on disk into a usable CirceState. A malformed tile is
 * dropped rather than loaded broken — §8.2 says Circe refuses to spawn a tile
 * for a bad profile and leaves the others unaffected, never auto-repairing.
 */
export function migrate(raw: unknown): CirceState {
  if (!isRecord(raw)) return emptyState();
  const tiles: Record<string, TileState> = {};
  if (isRecord(raw.tiles)) {
    for (const [id, tile] of Object.entries(raw.tiles)) {
      if (validTile(tile)) tiles[id] = tile;
    }
  }
  return {
    version: 1,
    onboarded: raw.onboarded === true,
    mainOperatorId: typeof raw.mainOperatorId === 'string' ? raw.mainOperatorId : null,
    tiles,
    wizardScreen: typeof raw.wizardScreen === 'string' ? raw.wizardScreen : null,
  };
}

export class StateStore {
  private state: CirceState = emptyState();
  /** Serialises writes so concurrent saves cannot interleave. */
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load(): Promise<CirceState> {
    try {
      this.state = migrate(JSON.parse(await readFile(this.filePath, 'utf8')));
    } catch {
      this.state = emptyState();
    }
    return this.state;
  }

  get(): CirceState {
    return this.state;
  }

  save(state: CirceState): Promise<void> {
    this.state = state;
    return this.enqueue();
  }

  updateTile(profileId: string, patch: Partial<TileState>): Promise<void> {
    const existing = this.state.tiles[profileId];
    if (!existing) return Promise.resolve();
    this.state.tiles[profileId] = { ...existing, ...patch };
    return this.enqueue();
  }

  removeTile(profileId: string): Promise<void> {
    delete this.state.tiles[profileId];
    return this.enqueue();
  }

  /**
   * Resolves once every queued write has hit disk. Callers that fire a write
   * without awaiting it — `closeTile` persists bounds from a window-close
   * handler — need this to know the state file is durable before quitting.
   */
  whenIdle(): Promise<void> {
    return this.queue;
  }

  private enqueue(): Promise<void> {
    this.queue = this.queue.then(() => this.flush());
    return this.queue;
  }

  /** Write to a temp file and rename — rename is atomic on macOS, so a crash
   *  mid-write can never leave a truncated state file. */
  private async flush(): Promise<void> {
    const tmp = `${this.filePath}.tmp`;
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(tmp, JSON.stringify(this.state, null, 2), 'utf8');
    await rename(tmp, this.filePath);
  }
}
