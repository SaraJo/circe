import type { HermesRuntime } from './hermes/runtime';

/**
 * What Circe remembers about how a profile's tile was arranged. Window facts
 * only, per constraint 10: nothing here says anything about who the agent is —
 * that lives in the profile, and the conversation lives in Hermes. The worst a
 * lost or unreadable record can cost is which conversation reopens, never the
 * conversation itself.
 */
export interface ProfileTileState {
  /** Session ids, in tab-strip order. Phase 1 keeps at most one. */
  tabs: string[];
  activeIndex: number;
}

export interface TileStateFile {
  version: 1;
  profiles: Record<string, ProfileTileState>;
}

const RECORD_VERSION = 1;

/** Lives under the Hermes home so `HERMES_HOME` redirects cover Circe's state too. */
export const TILE_STATE_PATH = 'circe/state.json';

export const EMPTY_STATE: TileStateFile = { version: RECORD_VERSION, profiles: {} };

function parseProfile(raw: unknown): ProfileTileState {
  if (typeof raw !== 'object' || raw === null) return { tabs: [], activeIndex: 0 };
  const r = raw as Partial<ProfileTileState>;
  const tabs = Array.isArray(r.tabs) && r.tabs.every((t) => typeof t === 'string') ? r.tabs : [];
  const index = typeof r.activeIndex === 'number' ? r.activeIndex : 0;
  // An index past the end would resume nothing while still claiming a tab was
  // open; falling back to the first tab is the recoverable reading.
  const activeIndex = Number.isInteger(index) && index >= 0 && index < tabs.length ? index : 0;
  return { tabs, activeIndex };
}

export function parseTileState(json: string | null): TileStateFile {
  if (json === null) return EMPTY_STATE;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return EMPTY_STATE;
  }
  if (typeof parsed !== 'object' || parsed === null) return EMPTY_STATE;
  const r = parsed as Partial<TileStateFile>;
  if (r.version !== RECORD_VERSION) return EMPTY_STATE;
  if (typeof r.profiles !== 'object' || r.profiles === null) return EMPTY_STATE;
  const profiles: Record<string, ProfileTileState> = {};
  for (const [id, raw] of Object.entries(r.profiles)) profiles[id] = parseProfile(raw);
  return { version: RECORD_VERSION, profiles };
}

export function stateFor(file: TileStateFile, profileId: string): ProfileTileState {
  return file.profiles[profileId] ?? { tabs: [], activeIndex: 0 };
}

export function withActiveSession(
  file: TileStateFile,
  profileId: string,
  sessionId: string,
): TileStateFile {
  return {
    version: RECORD_VERSION,
    profiles: { ...file.profiles, [profileId]: { tabs: [sessionId], activeIndex: 0 } },
  };
}

export function serializeTileState(file: TileStateFile): string {
  return JSON.stringify(file, null, 2);
}

/** Any read failure resolves to empty state: a tile must still open. */
export async function readTileState(hermes: HermesRuntime): Promise<TileStateFile> {
  try {
    return parseTileState(await hermes.readHomeFile(TILE_STATE_PATH));
  } catch (err) {
    console.warn(`Could not read ${TILE_STATE_PATH}; starting with no remembered tabs.`, err);
    return EMPTY_STATE;
  }
}

/**
 * Deliberately swallows failures. This file only decides which conversation
 * reopens next time; failing a launch over it would trade a working agent for a
 * bookmark.
 */
export async function writeTileState(hermes: HermesRuntime, file: TileStateFile): Promise<void> {
  try {
    await hermes.writeHomeFile(TILE_STATE_PATH, serializeTileState(file));
  } catch (err) {
    console.warn(`Could not record tile state (${TILE_STATE_PATH}):`, err);
  }
}
