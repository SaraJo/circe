import type { HermesRuntime } from './hermes/runtime';

/**
 * What Circe remembers about how a profile's tile was arranged. Window facts
 * only, per constraint 10: nothing here says anything about who the agent is —
 * that lives in the profile, and the conversation lives in Hermes. The worst a
 * lost or unreadable record can cost is which conversation reopens, never the
 * conversation itself.
 */
export interface ProfileTileState {
  /** Hermes session ids, in the same order as the visible tab strip. */
  tabs: string[];
  activeIndex: number;
  /** First-prompt labels keyed by Hermes session id. */
  titles?: Record<string, string>;
  /**
   * Fields a later build wrote and this one doesn't understand — the design's
   * `bounds` and `accessMode` are already spec'd (§3). They are carried through
   * parse and serialize untouched: this build reads the same file the next one
   * writes, and stripping them would silently destroy window geometry and
   * access mode the moment an older Circe opened a newer record.
   */
  [key: string]: unknown;
}

export interface TileStateFile {
  version: 1;
  profiles: Record<string, ProfileTileState>;
  /** Unknown top-level fields survive the round trip, same as in a profile. */
  [key: string]: unknown;
}

const RECORD_VERSION = 1;

/** Lives under the Hermes home so `HERMES_HOME` redirects cover Circe's state too. */
export const TILE_STATE_PATH = 'circe/state.json';

/**
 * Frozen because it is a shared singleton returned by identity from every
 * degradation path (absent file, corrupt JSON, future version, unreadable
 * file). One caller mutating what it got back would poison every later reader
 * in the process, and nothing in the type system says not to.
 */
export const EMPTY_STATE: TileStateFile = Object.freeze({
  version: RECORD_VERSION,
  profiles: Object.freeze({}) as Record<string, ProfileTileState>,
});

function parseProfile(raw: unknown): ProfileTileState {
  if (typeof raw !== 'object' || raw === null) return { tabs: [], activeIndex: 0 };
  const r = raw as Partial<ProfileTileState>;
  const tabs = Array.isArray(r.tabs) && r.tabs.every((t) => typeof t === 'string') ? r.tabs : [];
  const index = typeof r.activeIndex === 'number' ? r.activeIndex : 0;
  // An index past the end would resume nothing while still claiming a tab was
  // open; falling back to the first tab is the recoverable reading.
  const activeIndex = Number.isInteger(index) && index >= 0 && index < tabs.length ? index : 0;
  // Spread first so the two fields this build validates always win, and
  // anything else it doesn't know about rides along.
  return { ...r, tabs, activeIndex };
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
  return { ...r, version: RECORD_VERSION, profiles };
}

export function stateFor(file: TileStateFile, profileId: string): ProfileTileState {
  return file.profiles[profileId] ?? { tabs: [], activeIndex: 0 };
}

export function withActiveSession(
  file: TileStateFile,
  profileId: string,
  sessionId: string,
): TileStateFile {
  const current = stateFor(file, profileId);
  const tabs = [...current.tabs];
  const activeIndex = tabs.length === 0 ? 0 : current.activeIndex;
  if (tabs.length === 0) tabs.push(sessionId);
  else tabs[activeIndex] = sessionId;
  return withProfileTabs(file, profileId, tabs, activeIndex);
}

/** Replaces the tab strip while retaining fields owned by later Circe builds. */
export function withProfileTabs(
  file: TileStateFile,
  profileId: string,
  tabs: string[],
  activeIndex: number,
): TileStateFile {
  const safeIndex = tabs.length > 0 && Number.isInteger(activeIndex) && activeIndex >= 0 && activeIndex < tabs.length
    ? activeIndex
    : 0;
  // Both spreads preserve fields this build doesn't know about: the profile's
  // own (a later `bounds`/`accessMode`) and the file's top-level ones. Only the
  // two fields this build owns are overwritten.
  return {
    ...file,
    version: RECORD_VERSION,
    profiles: {
      ...file.profiles,
      [profileId]: { ...file.profiles[profileId], tabs: [...tabs], activeIndex: safeIndex },
    },
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
