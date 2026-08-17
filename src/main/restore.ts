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
 *
 * It carries a `held` array of the messages the user typed while the tile was
 * starting. Those were drawn locally by the renderer's input handler, so the
 * clear wipes them too — and they are about to be sent to the fresh session,
 * which would answer a question no longer on screen. The renderer redraws them
 * after the clear so every reply stays attached to a visible question.
 */
export const REPLAY_ABANDONED = 'circe/replay-abandoned';

/**
 * The slice of `AcpClient` the restore decision actually uses. Narrowed to an
 * interface so the decision can be tested against a fake without a subprocess,
 * an Electron window, or the protocol.
 */
export interface SessionClient {
  readonly canLoadSession: boolean;
  readonly canListSessions: boolean;
  loadSession(sessionId: string): Promise<boolean>;
  /** The agent's own session ids, or `null` when the answer is unknown. */
  listSessions(): Promise<string[] | null>;
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

  /**
   * What is waiting to be sent, without consuming it. The renderer drew these
   * as the user's own bubbles when they were typed, so anything that clears the
   * log has to put them back — see `REPLAY_ABANDONED`. Read-only on purpose:
   * `openSession`/`failLaunch` remain the only ways to take the messages out,
   * so nothing can drain the pen by looking at it.
   */
  get heldMessages(): readonly string[] {
    return this.held;
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
  /**
   * Sends a message that was held during the launch window, resolving when that
   * turn is over. The returned promise is what makes serial delivery possible
   * (see `deliver`), so an implementation that reports failures itself should
   * resolve rather than reject — a rejection here is not a launch failure.
   */
  sendPrompt(sessionId: string, text: string): Promise<void>;
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
 * The saved id is checked against `session/list` first, because a *successful*
 * load is not evidence the conversation exists — Hermes 0.14.0 answers `{}` for
 * an id it has never seen, which made the "failed load" path above unreachable
 * for the commonest reason a saved id goes bad. See `savedSessionIsGone`.
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

  if (!isCurrent()) return;
  // The staleness check runs before anything is drawn, so a saved id the agent
  // no longer has costs nothing on screen: no replay bracket, no abandoned
  // notice, just a fresh session and a healed `state.json`.
  if (prior && client.canLoadSession && !(await savedSessionIsGone(client, prior))) {
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
        emit({ sessionUpdate: REPLAY_ABANDONED, held: [...session.heldMessages] });
      }
      throw err;
    }
    if (!isCurrent()) return;
    emit({ sessionUpdate: REPLAY_END });
    if (resumed) {
      await deliver(deps, prior, session.openSession(prior));
      return;
    }
    emit({ sessionUpdate: REPLAY_ABANDONED, held: [...session.heldMessages] });
  }

  if (!isCurrent()) return;
  const sessionId = await client.newSession();
  if (!isCurrent()) return;
  // Taken from the holding pen before the write, so the launch window closes
  // the instant a session exists — exactly as it did when this was one call.
  const held = session.openSession(sessionId);
  // Persisted before the messages go out, not after: `deliver` now waits for
  // each turn to finish, and a turn can legitimately run for minutes. Leaving
  // the write behind it would mean a cold start that crashed or was quit
  // mid-answer forgot the session it had just created.
  await writeTileState(hermes, withActiveSession(file, profileId, sessionId));
  await deliver(deps, sessionId, held);
}

/**
 * Whether the agent's own session list says this id is gone.
 *
 * `session/load` cannot answer this: Hermes 0.14.0 returns success for an id it
 * has never seen, which is what let a dead id survive in `circe/state.json`
 * forever. Listing is the only thing that actually knows.
 *
 * Two ways of not knowing, both answered "not gone" so the caller attempts the
 * load exactly as it did before listing existed: the agent does not advertise
 * `session/list` at all, and the request failed. Neither is evidence the
 * conversation is missing, and acting as if it were would throw away a live
 * session id — the file is rewritten with the fresh one on that path, so a
 * single failed request would permanently lose the conversation it was meant to
 * protect. The defect this guards against is recoverable on the next launch;
 * that one would not be.
 */
async function savedSessionIsGone(client: SessionClient, sessionId: string): Promise<boolean> {
  if (!client.canListSessions) return false;
  const ids = await client.listSessions();
  if (ids === null) return false;
  return !ids.includes(sessionId);
}

/**
 * Sends the held messages, one at a time, waiting for each turn to finish.
 *
 * Not a loop of unawaited calls: two `session/prompt` requests in flight against
 * one session interleave their replies into the renderer's single streaming
 * bubble, and each resolution fires its own `circe/turn-end`, so the second
 * reply lands inside the first one's bubble and the turn ends before it is
 * finished. Two messages typed during the launch window is all it takes.
 *
 * `isCurrent` is re-checked between messages because each `await` here is a
 * whole agent turn long — easily enough time for the tile to be closed and
 * reopened, which stops this launch's client. Anything still queued belongs to
 * a launch that no longer owns the tile.
 */
async function deliver(deps: RestoreDeps, sessionId: string, held: string[]): Promise<void> {
  for (const text of held) {
    if (!deps.isCurrent()) return;
    try {
      await deps.sendPrompt(sessionId, text);
    } catch (err) {
      // A failed send is the sender's business to report — it is the only thing
      // that knows why — and it is not a failed launch. Letting it out of here
      // would reach `launchTile`'s catch, which tells the user the tile could
      // not reach its agent and tears down a session that is running fine.
      console.warn(`Could not send a message held during launch of ${sessionId}.`, err);
    }
  }
}
