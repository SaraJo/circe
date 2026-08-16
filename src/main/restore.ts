import type { HermesRuntime } from './hermes/runtime';
import { readTileState, stateFor, withActiveSession, writeTileState } from './tileState';

/**
 * Circe's own lifecycle events, namespaced under `circe/` so they can never
 * collide with a protocol `sessionUpdate` kind (real ACP discriminators are
 * snake_case and carry no `/`). They ride the same channel as real updates.
 */
export const REPLAY_START = 'circe/replay-start';
export const REPLAY_END = 'circe/replay-end';
/**
 * A replay drew part of a conversation and then the load failed. Hermes emits
 * history *before* it answers `session/load` (spec §2), so by the time we learn
 * the resume failed the bubbles are already on screen — belonging to a session
 * the live agent has no memory of. The renderer clears the log on this.
 */
export const REPLAY_ABANDONED = 'circe/replay-abandoned';

/**
 * The slice of `AcpClient` the restore decision actually uses. Narrowed to an
 * interface so the decision can be tested against a fake without a subprocess,
 * an Electron window, or the protocol.
 */
export interface SessionClient {
  readonly canLoadSession: boolean;
  loadSession(sessionId: string): Promise<boolean>;
  newSession(): Promise<string>;
}

/** Where a prompt typed by the user should go right now. */
export type PromptRoute =
  | { kind: 'send'; sessionId: string }
  | { kind: 'held' }
  | { kind: 'no-session' };

/**
 * Which session the tile is showing, and what to do with a message typed
 * before there is one.
 *
 * The launch window — from the moment the tile appears to the moment a session
 * is live — spans a file read, up to 30s for `session/load` and up to another
 * 30s for `session/new`. The tile is on screen with an enabled input for all of
 * it. Dropping what the user types in that window (the old
 * `if (!client || !sessionId) return;`) turned a visible failure into silence,
 * so it is held here instead and sent the moment a session exists.
 *
 * Note that `expectReplay` deliberately does *not* close the window: the id is
 * set before `session/load` so the replay's updates route to this tile, but the
 * connection has not finished loading that session. A live turn sent into that
 * gap would interleave with the replay while the renderer's `replaying` flag is
 * still true, and the user's own message would be drawn twice.
 */
export class TileSession {
  private active: string | null = null;
  private launching = false;
  private held: string[] = [];

  /** The session whose updates this tile draws. Updates for any other are dropped. */
  get activeSessionId(): string | null {
    return this.active;
  }

  /** A tile is opening. Anything typed from here on is held, never dropped. */
  beginLaunch(): void {
    this.active = null;
    this.launching = true;
    this.held = [];
  }

  /** The id the replay's updates will carry. Does not end the launch window. */
  expectReplay(sessionId: string): void {
    this.active = sessionId;
  }

  /** A session is live. Returns whatever was held during the launch window. */
  openSession(sessionId: string): string[] {
    this.active = sessionId;
    this.launching = false;
    return this.held.splice(0);
  }

  /** The launch failed. Returns the messages that were never sent. */
  failLaunch(): string[] {
    this.launching = false;
    return this.held.splice(0);
  }

  /** The tile closed, or its launch was superseded. */
  reset(): void {
    this.active = null;
    this.launching = false;
    this.held = [];
  }

  /** Classifies a prompt, holding it when there is nowhere to send it yet. */
  route(text: string): PromptRoute {
    if (this.launching) {
      this.held.push(text);
      return { kind: 'held' };
    }
    if (this.active === null) return { kind: 'no-session' };
    return { kind: 'send', sessionId: this.active };
  }
}

export interface RestoreDeps {
  hermes: HermesRuntime;
  client: SessionClient;
  profileId: string;
  session: TileSession;
  /** Sends a synthetic `circe/*` update to the tile. */
  emit(update: Record<string, unknown>): void;
  /** Resolves when the renderer has registered its listeners. */
  tileReady: Promise<void>;
  /**
   * False once a later launch has superseded this one. Every `await` below is
   * long enough for the tile to be closed and reopened from the dock, which
   * spins up a second launch with its own client; a superseded launch must
   * never write over the launch that replaced it.
   */
  isCurrent(): boolean;
  /** Sends a message that was held during the launch window. */
  sendPrompt(sessionId: string, text: string): void;
}

/**
 * Resumes the conversation this profile's tile was last on, or begins a new one.
 *
 * Hermes owns the conversation: `session/load` asks it to rehydrate from its own
 * store, and it replays the history back as updates. Circe uploads nothing and
 * keeps no copy — the id in `circe/state.json` is the whole of what it remembers.
 *
 * Every failure lands on the same answer, a fresh session, because a tile that
 * refuses to open because last week's conversation went missing is worse than
 * one that opens empty. The one thing that must not happen is a fresh session
 * sitting under a transcript from the session that failed to load, so the
 * fallback path tells the renderer to clear what the replay already drew.
 *
 * Lives outside `index.ts` and takes its collaborators as parameters so it can
 * be tested for real: the previous shape reached for module-level state and
 * could only be checked by a test that reimplemented it.
 */
export async function restoreOrCreateSession(deps: RestoreDeps): Promise<void> {
  const { hermes, client, profileId, session, emit, isCurrent } = deps;
  const file = await readTileState(hermes);
  const saved = stateFor(file, profileId);
  const prior = saved.tabs[saved.activeIndex] ?? null;

  if (prior && client.canLoadSession) {
    if (!isCurrent()) return;
    session.expectReplay(prior); // set first: the replay's updates carry this id
    await deps.tileReady;
    if (!isCurrent()) return;
    emit({ sessionUpdate: REPLAY_START });
    let resumed: boolean;
    try {
      resumed = await client.loadSession(prior);
    } catch (err) {
      // A dead client throws rather than answering false. The history it
      // already replayed is just as orphaned as on the false path, so it is
      // cleared the same way before the error travels on to the launcher.
      if (isCurrent()) {
        emit({ sessionUpdate: REPLAY_END });
        emit({ sessionUpdate: REPLAY_ABANDONED });
      }
      throw err;
    }
    if (!isCurrent()) return;
    emit({ sessionUpdate: REPLAY_END });
    if (resumed) {
      flush(deps, prior);
      return;
    }
    emit({ sessionUpdate: REPLAY_ABANDONED });
  }

  if (!isCurrent()) return;
  const sessionId = await client.newSession();
  if (!isCurrent()) return;
  flush(deps, sessionId);
  await writeTileState(hermes, withActiveSession(file, profileId, sessionId));
}

/** Opens the session for routing and sends anything typed while it was starting. */
function flush(deps: RestoreDeps, sessionId: string): void {
  for (const text of deps.session.openSession(sessionId)) deps.sendPrompt(sessionId, text);
}
