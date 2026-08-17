import { describe, expect, it } from 'vitest';
import { AcpClient } from '../src/main/acp';
import {
  REPLAY_ABANDONED,
  REPLAY_END,
  REPLAY_START,
  restoreOrCreateSession,
  TileSession,
  type RestoreDeps,
  type SessionClient,
} from '../src/main/restore';
import { TILE_STATE_PATH } from '../src/main/tileState';
import { FakeHermes, INSTALLED_EMPTY } from './fake/hermes';

type WithHandle = { handle(msg: Record<string, unknown>): void };

/**
 * The renderer's drawing rules, extracted as a pure reducer so the transport can
 * be driven against them without an Electron window. It mirrors
 * `src/renderer/tile/main.ts`'s switch: user messages only while replaying, an
 * agent chunk after a replayed message starts a new bubble, replay-end closes
 * the last one.
 *
 * `onScreen` is what the log already holds when this stream starts — the tile's
 * log is not cleared between turns, and one thing it can hold is a bubble the
 * *input handler* drew locally, which no update stream will ever describe. The
 * abandoned-replay case below is the one that has to know about those.
 */
type Bubble = { role: 'user' | 'agent'; text: string };

const ABANDONED_NOTICE = "Couldn't reopen the previous conversation — starting a new one.";

function render(updates: Array<Record<string, unknown>>, onScreen: Bubble[] = []): Bubble[] {
  const out: Bubble[] = [...onScreen];
  let replaying = false;
  let streaming: Bubble | null = null;
  for (const u of updates) {
    switch (u.sessionUpdate) {
      case 'circe/replay-start':
        replaying = true;
        break;
      case 'circe/replay-end':
        replaying = false;
        streaming = null;
        break;
      case 'user_message_chunk': {
        if (!replaying) break;
        streaming = null;
        out.push({ role: 'user', text: (u.content as { text: string }).text });
        break;
      }
      case 'agent_message_chunk': {
        const piece = (u.content as { text: string }).text;
        if (!streaming) {
          streaming = { role: 'agent', text: '' };
          out.push(streaming);
        }
        streaming.text += piece;
        break;
      }
      // The orphaned transcript goes, the notice replaces it — and the messages
      // the user typed while the tile was starting are redrawn, because the
      // clear took those too and the fresh session is about to answer them.
      case 'circe/replay-abandoned': {
        replaying = false;
        streaming = null;
        out.length = 0;
        out.push({ role: 'agent', text: ABANDONED_NOTICE });
        for (const text of (u.held as string[] | undefined) ?? []) {
          out.push({ role: 'user', text });
        }
        break;
      }
    }
  }
  return out;
}

/** The exact wire shape captured from Hermes 0.14.0 — see spec §2. */
function notification(sessionId: string, update: Record<string, unknown>) {
  return { jsonrpc: '2.0', method: 'session/update', params: { sessionId, update } };
}

describe('resuming a conversation', () => {
  function harness(active: string) {
    const drawn: Array<Record<string, unknown>> = [];
    const client = new AcpClient({
      profileId: 'test',
      onUpdate: (sessionId, u) => {
        if (sessionId !== active) return;
        drawn.push(u as Record<string, unknown>);
      },
      onExit: () => {},
    });
    return { client, drawn };
  }

  it('renders a replayed exchange as separate user and agent bubbles', () => {
    const { client, drawn } = harness('sess-1');
    const feed = (client as unknown as WithHandle).handle.bind(client);

    drawn.push({ sessionUpdate: 'circe/replay-start' });
    feed(notification('sess-1', {
      sessionUpdate: 'user_message_chunk',
      content: { type: 'text', text: 'who are you?' },
    }));
    feed(notification('sess-1', {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: "I'm Spock." },
    }));
    drawn.push({ sessionUpdate: 'circe/replay-end' });

    expect(render(drawn)).toEqual([
      { role: 'user', text: 'who are you?' },
      { role: 'agent', text: "I'm Spock." },
    ]);
  });

  it('keeps each replayed turn in its own bubble', () => {
    const { client, drawn } = harness('sess-1');
    const feed = (client as unknown as WithHandle).handle.bind(client);

    drawn.push({ sessionUpdate: 'circe/replay-start' });
    for (const [user, agent] of [['one', 'first'], ['two', 'second']]) {
      feed(notification('sess-1', { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: user } }));
      feed(notification('sess-1', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: agent } }));
    }
    drawn.push({ sessionUpdate: 'circe/replay-end' });

    expect(render(drawn)).toEqual([
      { role: 'user', text: 'one' },
      { role: 'agent', text: 'first' },
      { role: 'user', text: 'two' },
      { role: 'agent', text: 'second' },
    ]);
  });

  it('never draws another session’s replay into this tile', () => {
    const { client, drawn } = harness('sess-1');
    const feed = (client as unknown as WithHandle).handle.bind(client);

    feed(notification('sess-OTHER', {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'not for this tab' },
    }));

    expect(drawn).toEqual([]);
  });

  it('ignores the non-chat updates a replay also emits', () => {
    const { client, drawn } = harness('sess-1');
    const feed = (client as unknown as WithHandle).handle.bind(client);

    drawn.push({ sessionUpdate: 'circe/replay-start' });
    feed(notification('sess-1', { sessionUpdate: 'usage_update', size: 1_000_000, used: 11_166 }));
    feed(notification('sess-1', {
      sessionUpdate: 'available_commands_update',
      availableCommands: [{ name: 'help' }],
    }));
    feed(notification('sess-1', {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'hello' },
    }));
    drawn.push({ sessionUpdate: 'circe/replay-end' });

    expect(render(drawn)).toEqual([{ role: 'agent', text: 'hello' }]);
  });

  it('does not draw a live user echo twice', () => {
    const { client, drawn } = harness('sess-1');
    const feed = (client as unknown as WithHandle).handle.bind(client);

    // No replay in progress: the input handler already drew this one.
    feed(notification('sess-1', {
      sessionUpdate: 'user_message_chunk',
      content: { type: 'text', text: 'hello' },
    }));

    expect(render(drawn)).toEqual([]);
  });

  /**
   * Verified against a live Hermes 0.14.0 `session/load` resume: the replayed
   * chat content (`user_message_chunk`, `agent_message_chunk`) arrives on the
   * wire *before* the `session/load` response, and only non-chat kinds
   * (`available_commands_update`, `usage_update`) arrive after it. That order
   * is what makes `src/main/index.ts`'s `circe/replay-start` …
   * `circe/replay-end` bracket — sent synchronously around the
   * `await client.loadSession(...)` call — correct: every chat update lands
   * inside the bracket, where `replaying` is true and `user_message_chunk` is
   * drawn.
   *
   * This test does not observe the live wire itself — it pins the
   * *consequence* if that order ever stopped holding. `render()`'s
   * `user_message_chunk` case only draws while `replaying` is true, and
   * `circe/replay-end` clears that flag, so anything arriving after the
   * bracket closes is invisible. A trailing `user_message_chunk` fed here
   * after `circe/replay-end` is asserted absent from the rendered transcript:
   * if a future Hermes ever trailed a genuine chat chunk behind the
   * `session/load` response instead of only non-chat kinds, the tile would
   * come back with an incomplete transcript and nothing would crash to say
   * so.
   */
  it('a chat update trailing the replay bracket is silently dropped from the transcript, not crashed', () => {
    const { client, drawn } = harness('sess-1');
    const feed = (client as unknown as WithHandle).handle.bind(client);

    // The replayed exchange, inside the bracket — this is the real shape.
    drawn.push({ sessionUpdate: 'circe/replay-start' });
    feed(notification('sess-1', {
      sessionUpdate: 'user_message_chunk',
      content: { type: 'text', text: 'who are you?' },
    }));
    feed(notification('sess-1', {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: "I'm Spock." },
    }));
    drawn.push({ sessionUpdate: 'circe/replay-end' });

    // A genuine chat update arriving after the bracket closes — what a
    // future Hermes trailing a message chunk behind the session/load
    // response would look like.
    feed(notification('sess-1', {
      sessionUpdate: 'user_message_chunk',
      content: { type: 'text', text: 'anyone home?' },
    }));

    expect(render(drawn)).toEqual([
      { role: 'user', text: 'who are you?' },
      { role: 'agent', text: "I'm Spock." },
    ]);
  });

  /**
   * The end state R2 is about. The abandoned-replay clear is indiscriminate:
   * it wipes the whole log, including the bubble the *input handler* drew for a
   * message typed while the tile was starting. That message was held, not
   * dropped, so the fresh session answers it moments later — and the answer
   * arrived under a question that had just been erased, which is the same
   * misleading transcript the notice exists to prevent.
   *
   * The three things that must be true afterwards: the notice is visible, the
   * user's own words are visible, and the reply is attached to a visible
   * question.
   */
  it('keeps the user’s own words when an abandoned replay clears the log', () => {
    const onScreen: Bubble[] = [
      // Replayed by Hermes before the load failed — orphaned, and must go.
      { role: 'user', text: 'who are you?' },
      { role: 'agent', text: "I'm Spock." },
      // Typed into the tile while it was starting; drawn by the input handler,
      // held by `TileSession`, and about to be sent to the fresh session.
      { role: 'user', text: 'are you there?' },
    ];

    const end = render(
      [
        { sessionUpdate: 'circe/replay-abandoned', held: ['are you there?'] },
        { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'I am now.' } },
      ],
      onScreen,
    );

    expect(end).toEqual([
      { role: 'agent', text: ABANDONED_NOTICE },
      { role: 'user', text: 'are you there?' },
      { role: 'agent', text: 'I am now.' },
    ]);
  });
});

/**
 * The main-process half of the same boundary. The suite above drives the real
 * `AcpClient` frame dispatcher; this drives the real restore decision — the
 * thing that emits the `circe/replay-*` bracket those tests depend on. Before
 * `restoreOrCreateSession` moved out of `index.ts` it reached for module-level
 * state and could not be called at all, so the bracket above was hand-pushed
 * into the expected array and deleting either emit in `index.ts` left the whole
 * suite green. It no longer does.
 *
 * No Electron here, by design: the decision takes its collaborators as
 * parameters, so a fake client and a fake Hermes are the whole harness.
 */
describe('restoreOrCreateSession', () => {
  /** Lets the microtask queue drain past the state read and `tileReady`. */
  async function settle(): Promise<void> {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  }

  class FakeClient implements SessionClient {
    canLoadSession = true;
    /**
     * Hermes 0.14.0 advertises `session/list` (spec §2), so that is the default
     * here: the ordinary path this decision runs on checks the saved id before
     * resuming it. Tests for an agent without listing set this false.
     */
    canListSessions = true;
    /**
     * What `session/list` answers. `null` is the "could not tell" reply —
     * listing failed, or the response wasn't the documented shape — and is
     * deliberately distinct from `[]`, which is a real agent with no sessions
     * at all. The default holds the id `SAVED` names, i.e. a live conversation.
     */
    sessionIds: string[] | null = ['sess-prior'];
    listCalls = 0;
    loadResult: boolean | Error = true;
    newSessionId = 'sess-new';
    newSessionCalls = 0;
    loadedIds: string[] = [];
    /** When set, `loadSession` blocks on it — the launch window, held open. */
    gate: Promise<void> | null = null;
    /** Runs inside `loadSession`, before it answers. */
    onLoad: (() => void) | null = null;

    /** Records the order of everything the decision did, emits included. */
    constructor(private steps: string[]) {}

    async listSessions(): Promise<string[] | null> {
      this.listCalls += 1;
      this.steps.push('list');
      return this.sessionIds;
    }

    async loadSession(sessionId: string): Promise<boolean> {
      this.loadedIds.push(sessionId);
      this.steps.push(`load:${sessionId}`);
      this.onLoad?.();
      if (this.gate) await this.gate;
      if (this.loadResult instanceof Error) throw this.loadResult;
      return this.loadResult;
    }

    async newSession(): Promise<string> {
      this.newSessionCalls += 1;
      this.steps.push('new');
      return this.newSessionId;
    }
  }

  function harness(saved?: { tabs: string[]; activeIndex: number }) {
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    if (saved) {
      hermes.files.set(
        TILE_STATE_PATH,
        JSON.stringify({ version: 1, profiles: { default: saved } }),
      );
    }
    const steps: string[] = [];
    const client = new FakeClient(steps);
    const session = new TileSession();
    // Exactly what `launchTile` does before the window exists: the holding pen
    // is open for the whole of this call.
    session.beginLaunch();
    const sent: Array<{ sessionId: string; text: string }> = [];
    /** Every synthetic update in full, not just its kind — see `steps`. */
    const emitted: Array<Record<string, unknown>> = [];
    let current = true;
    const deps: RestoreDeps = {
      hermes,
      client,
      profileId: 'default',
      session,
      emit: (u) => {
        emitted.push(u);
        steps.push(String(u.sessionUpdate));
      },
      tileReady: Promise.resolve(),
      isCurrent: () => current,
      sendPrompt: async (sessionId, text) => void sent.push({ sessionId, text }),
    };
    return {
      hermes,
      client,
      session,
      steps,
      emitted,
      sent,
      deps,
      supersede: () => {
        current = false;
      },
      /** What actually landed in `circe/state.json`. */
      async persisted() {
        const raw = await hermes.readHomeFile(TILE_STATE_PATH);
        return raw === null ? null : (JSON.parse(raw) as Record<string, unknown>);
      },
    };
  }

  const SAVED = { tabs: ['sess-prior'], activeIndex: 0 };

  it('brackets the load with replay-start before it and replay-end after it', async () => {
    const h = harness(SAVED);

    await restoreOrCreateSession(h.deps);

    // 'list' comes first: the saved id is checked against the agent's own
    // session list before anything is drawn, because a successful
    // `session/load` is not evidence the conversation exists (Hermes 0.14.0
    // answers `{}` for an id it has never seen).
    expect(h.steps).toEqual(['list', REPLAY_START, 'load:sess-prior', REPLAY_END]);
    expect(h.client.newSessionCalls).toBe(0);
    expect(h.session.activeSessionId).toBe('sess-prior');
  });

  // The replay's updates carry the prior id and arrive *while* `session/load`
  // is still in flight, so the id has to be routable before the call, not after
  // it answers — otherwise every replayed bubble is dropped by the session
  // filter and the tile comes back empty.
  it('routes the replay by setting the session id before the load, not after', async () => {
    const h = harness(SAVED);
    let idDuringLoad: string | null = 'not-observed';
    h.client.onLoad = () => {
      idDuringLoad = h.session.activeSessionId;
    };

    await restoreOrCreateSession(h.deps);

    expect(idDuringLoad).toBe('sess-prior');
  });

  it('clears the orphaned transcript when a replay is abandoned', async () => {
    const h = harness(SAVED);
    h.client.loadResult = false;

    await restoreOrCreateSession(h.deps);

    expect(h.steps).toEqual([
      'list',
      REPLAY_START,
      'load:sess-prior',
      REPLAY_END,
      REPLAY_ABANDONED,
      'new',
    ]);
    expect(await h.persisted()).toEqual({
      version: 1,
      profiles: { default: { tabs: ['sess-new'], activeIndex: 0 } },
    });
  });

  // A dead client throws out of `loadSession` rather than answering false. The
  // bubbles it already drew are just as orphaned, so they are cleared the same
  // way before the error travels on to the launcher's error notice.
  it('clears the transcript and rethrows when the load throws mid-replay', async () => {
    const h = harness(SAVED);
    h.client.loadResult = new Error('ACP client is not running');

    await expect(restoreOrCreateSession(h.deps)).rejects.toThrow('ACP client is not running');

    expect(h.steps).toEqual(['list', REPLAY_START, 'load:sess-prior', REPLAY_END, REPLAY_ABANDONED]);
    expect(h.client.newSessionCalls).toBe(0);
  });

  it('does not claim a replay was abandoned when none was ever started', async () => {
    const h = harness();

    await restoreOrCreateSession(h.deps);

    expect(h.steps).toEqual(['new']);
  });

  /**
   * R3. `session/load` is not a existence check: probed against Hermes 0.14.0,
   * a fabricated session id answers `{}` — success, no error. So the design's
   * "the load fails and we fall back" never happened for the commonest reason a
   * saved id goes bad. What happened instead: the tile opened empty with no
   * explanation, `loadSession` returned true so the fallback never ran, and the
   * dead id stayed in `circe/state.json` *permanently*, retried on every later
   * cold start. The agent's own session list is the only thing that knows.
   */
  describe('checking the saved id against the agent’s session list', () => {
    const RECORD = { version: 1, profiles: { default: { tabs: ['sess-new'], activeIndex: 0 } } };

    it('resumes the saved session when the agent still lists it', async () => {
      const h = harness(SAVED);
      h.client.sessionIds = ['sess-other', 'sess-prior'];

      await restoreOrCreateSession(h.deps);

      expect(h.client.listCalls).toBe(1);
      expect(h.client.loadedIds).toEqual(['sess-prior']);
      expect(h.steps).toEqual(['list', REPLAY_START, 'load:sess-prior', REPLAY_END]);
      expect(h.session.activeSessionId).toBe('sess-prior');
    });

    // The defect, closed: no load at all, so nothing is drawn and nothing has
    // to be un-drawn — and the file heals, which is what stops the next cold
    // start from retrying the same corpse.
    it('never loads a saved id the agent no longer has, and heals the record', async () => {
      const h = harness(SAVED);
      h.client.sessionIds = ['sess-somebody-else'];

      await restoreOrCreateSession(h.deps);

      expect(h.client.loadedIds).toEqual([]);
      expect(h.client.newSessionCalls).toBe(1);
      expect(h.steps).toEqual(['list', 'new']);
      expect(h.session.activeSessionId).toBe('sess-new');
      expect(await h.persisted()).toEqual(RECORD);
    });

    // An agent that has been reset has no sessions at all. `[]` is a real
    // answer — the saved id is definitely gone — and reading it as "could not
    // tell" would re-open the defect for its likeliest cause.
    it('treats an empty session list as an answer, not as a failure to answer', async () => {
      const h = harness(SAVED);
      h.client.sessionIds = [];

      await restoreOrCreateSession(h.deps);

      expect(h.client.loadedIds).toEqual([]);
      expect(h.steps).toEqual(['list', 'new']);
      expect(await h.persisted()).toEqual(RECORD);
    });

    // Listing is not a hard requirement: an agent that cannot list is left on
    // exactly the behaviour every build before this one had.
    it('attempts the load anyway when the agent cannot list sessions', async () => {
      const h = harness(SAVED);
      h.client.canListSessions = false;

      await restoreOrCreateSession(h.deps);

      expect(h.client.listCalls).toBe(0);
      expect(h.client.loadedIds).toEqual(['sess-prior']);
      expect(h.steps).toEqual([REPLAY_START, 'load:sess-prior', REPLAY_END]);
    });

    /**
     * The judgement call. A *failed* list is not evidence the conversation is
     * missing, and the fresh-session path rewrites `state.json` with the new
     * id — so treating a failed request as "gone" would permanently discard a
     * live conversation because one request went wrong. The defect this check
     * closes costs an empty tile that heals on the next launch; getting it
     * wrong this way costs the conversation itself. So a failure falls through
     * to attempting the load, exactly as if listing were unsupported.
     */
    it('attempts the load anyway when listing fails, rather than discarding a live id', async () => {
      const h = harness(SAVED);
      h.client.sessionIds = null; // "could not tell"

      await restoreOrCreateSession(h.deps);

      expect(h.client.listCalls).toBe(1);
      expect(h.client.loadedIds).toEqual(['sess-prior']);
      expect(h.steps).toEqual(['list', REPLAY_START, 'load:sess-prior', REPLAY_END]);
      expect(h.session.activeSessionId).toBe('sess-prior');
      // And the record still names the conversation it was protecting.
      expect(await h.persisted()).toEqual({ version: 1, profiles: { default: SAVED } });
    });

    it('does not list when there is nothing saved to check', async () => {
      const h = harness();

      await restoreOrCreateSession(h.deps);

      expect(h.client.listCalls).toBe(0);
      expect(h.steps).toEqual(['new']);
    });

    it('does not list when the agent cannot resume a conversation at all', async () => {
      const h = harness(SAVED);
      h.client.canLoadSession = false;

      await restoreOrCreateSession(h.deps);

      expect(h.client.listCalls).toBe(0);
      expect(h.steps).toEqual(['new']);
    });
  });

  describe('every fresh-session case', () => {
    const RECORD = { version: 1, profiles: { default: { tabs: ['sess-new'], activeIndex: 0 } } };

    it('starts one when nothing was remembered', async () => {
      const h = harness();
      await restoreOrCreateSession(h.deps);
      expect(h.client.newSessionCalls).toBe(1);
      expect(h.client.loadedIds).toEqual([]);
      expect(await h.persisted()).toEqual(RECORD);
    });

    it('starts one when the agent cannot load sessions at all', async () => {
      const h = harness(SAVED);
      h.client.canLoadSession = false;
      await restoreOrCreateSession(h.deps);
      expect(h.client.newSessionCalls).toBe(1);
      expect(h.client.loadedIds).toEqual([]);
      expect(h.steps).toEqual(['new']);
      expect(await h.persisted()).toEqual(RECORD);
    });

    it('starts one when the remembered session will not load', async () => {
      const h = harness(SAVED);
      h.client.loadResult = false;
      await restoreOrCreateSession(h.deps);
      expect(h.client.newSessionCalls).toBe(1);
      expect(h.session.activeSessionId).toBe('sess-new');
      expect(await h.persisted()).toEqual(RECORD);
    });
  });

  /**
   * The regression this branch introduced and this wave closed: the tile is on
   * screen with an enabled input for the whole of this function — a file read
   * plus up to 30s of `session/load` plus up to another 30s of `session/new`.
   * The old `tile:prompt` handler returned silently when there was no session
   * yet, so the user's bubble sat unanswered forever.
   */
  describe('a message typed during the launch window', () => {
    it('is not routed into the session being replayed', async () => {
      const h = harness(SAVED);
      let open!: () => void;
      h.client.gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      const running = restoreOrCreateSession(h.deps);
      await settle();

      // Mid-replay: the id is set so the replay routes, but a live turn here
      // would interleave with the replay while the renderer is still drawing it.
      expect(h.client.loadedIds).toEqual(['sess-prior']);
      expect(h.session.activeSessionId).toBe('sess-prior');
      expect(h.session.route('are you there?')).toEqual({ kind: 'held' });
      expect(h.sent).toEqual([]);

      open();
      await running;

      expect(h.sent).toEqual([{ sessionId: 'sess-prior', text: 'are you there?' }]);
    });

    it('is sent against the fresh session when the resume falls back', async () => {
      const h = harness(SAVED);
      h.client.loadResult = false;
      let open!: () => void;
      h.client.gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      const running = restoreOrCreateSession(h.deps);
      await settle();

      expect(h.session.route('hello')).toEqual({ kind: 'held' });
      open();
      await running;

      expect(h.sent).toEqual([{ sessionId: 'sess-new', text: 'hello' }]);
    });

    it('is held in order and released once, not replayed on a later prompt', async () => {
      const h = harness();
      h.session.route('first');
      h.session.route('second');

      await restoreOrCreateSession(h.deps);

      expect(h.sent).toEqual([
        { sessionId: 'sess-new', text: 'first' },
        { sessionId: 'sess-new', text: 'second' },
      ]);
      // The window is closed now: the next message goes straight out.
      expect(h.session.route('third')).toEqual({ kind: 'send', sessionId: 'sess-new' });
    });

    /**
     * R1. `sendPrompt` is fire-and-forget, so a loop of un-awaited calls put
     * two `session/prompt` requests in flight against one session at once. The
     * tile has a single streaming bubble and each resolution fires its own
     * `circe/turn-end`, so the two replies concatenate into one bubble and the
     * turn ends before the second one has finished. Two messages typed during
     * the launch window was the whole cost of entry.
     *
     * The fake below is asynchronous on purpose: the harness's default records
     * synchronously and could not tell a serial send from a concurrent one.
     */
    it('sends held messages one at a time, never with two prompts in flight', async () => {
      const h = harness();
      h.session.route('first');
      h.session.route('second');

      const order: string[] = [];
      let inFlight = 0;
      let maxInFlight = 0;
      h.deps.sendPrompt = async (_sessionId, text) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        order.push(`start:${text}`);
        // A turn is not over when the request is issued; it is over when the
        // agent answers. Anything that only awaits the send would still overlap.
        await new Promise((resolve) => setTimeout(resolve, 0));
        order.push(`end:${text}`);
        inFlight -= 1;
      };

      await restoreOrCreateSession(h.deps);

      expect(maxInFlight).toBe(1);
      expect(order).toEqual(['start:first', 'end:first', 'start:second', 'end:second']);
    });

    // Each await in that chain is a whole agent turn long — long enough for the
    // tile to be closed and reopened, which stops this launch's client. What is
    // still queued belongs to a launch that no longer owns the tile.
    it('stops sending held messages once its launch has been superseded', async () => {
      const h = harness();
      h.session.route('first');
      h.session.route('second');

      const sent: string[] = [];
      h.deps.sendPrompt = async (_sessionId, text) => {
        sent.push(text);
        h.supersede(); // the tile was closed and reopened while this turn ran
        await Promise.resolve();
      };

      await restoreOrCreateSession(h.deps);

      expect(sent).toEqual(['first']);
    });

    // A send that fails is the sender's business to report, and it is not a
    // failed launch: letting it out of here reaches `launchTile`'s catch, which
    // tells the user the tile can't reach its agent and tears down a session
    // that is running fine.
    it('keeps going, and does not fail the launch, when one send rejects', async () => {
      const h = harness();
      h.session.route('first');
      h.session.route('second');

      const sent: string[] = [];
      h.deps.sendPrompt = async (_sessionId, text) => {
        sent.push(text);
        if (text === 'first') throw new Error('hermes acp exited (1)');
      };

      await expect(restoreOrCreateSession(h.deps)).resolves.toBeUndefined();

      expect(sent).toEqual(['first', 'second']);
      expect(await h.persisted()).toEqual({
        version: 1,
        profiles: { default: { tabs: ['sess-new'], activeIndex: 0 } },
      });
    });

    /**
     * R2. The abandoned-replay path clears the log before the held messages are
     * sent, so the clear wipes the user's own bubble and the fresh session then
     * answers a question no longer on screen. The main process is the only
     * thing that knows what was held, so it says so — the renderer redraws
     * them after the clear (see the mirror test at the top of this file).
     */
    it('tells the renderer what the user had already typed when it clears the log', async () => {
      const h = harness(SAVED);
      h.client.loadResult = false;
      let open!: () => void;
      h.client.gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      const running = restoreOrCreateSession(h.deps);
      await settle();

      // Typed while the replay was still on screen; drawn locally by the input
      // handler, which is why the clear would otherwise take it.
      expect(h.session.route('are you there?')).toEqual({ kind: 'held' });
      open();
      await running;

      expect(h.emitted).toContainEqual({
        sessionUpdate: REPLAY_ABANDONED,
        held: ['are you there?'],
      });
      // And it is the same message the fresh session is answering.
      expect(h.sent).toEqual([{ sessionId: 'sess-new', text: 'are you there?' }]);
    });

    // The same clear happens when the load throws mid-replay. There the launch
    // fails and `launchTile` reports the messages as unsent — but they are
    // still the user's own words, and still on screen underneath that notice.
    it('carries the held messages on the abandoned clear when the load throws too', async () => {
      const h = harness(SAVED);
      h.client.loadResult = new Error('ACP client is not running');
      h.client.onLoad = () => void h.session.route('are you there?');

      await expect(restoreOrCreateSession(h.deps)).rejects.toThrow('ACP client is not running');

      expect(h.emitted).toContainEqual({
        sessionUpdate: REPLAY_ABANDONED,
        held: ['are you there?'],
      });
      // Still held: the launch failed, so `launchTile` collects them and says
      // they weren't sent rather than this path silently eating them.
      expect(h.session.heldMessages).toEqual(['are you there?']);
    });

    it('is reported as unsent, never silently dropped, when the launch fails', () => {
      const session = new TileSession();
      session.beginLaunch();
      expect(session.route('typed while starting')).toEqual({ kind: 'held' });

      expect(session.failLaunch()).toEqual(['typed while starting']);
      // And once the window is shut, a later message is refused out loud
      // rather than held for a session that is never coming.
      expect(session.route('and another')).toEqual({ kind: 'no-session' });
    });
  });

  it('leaves the launch that replaced it alone once superseded', async () => {
    const h = harness(SAVED);
    h.supersede();

    await restoreOrCreateSession(h.deps);

    expect(h.steps).toEqual([]);
    expect(h.client.newSessionCalls).toBe(0);
    expect(h.session.activeSessionId).toBeNull();
    // The record still names the session the superseded launch was resuming —
    // nothing it did was written over the launch that replaced it.
    expect(await h.persisted()).toEqual({ version: 1, profiles: { default: SAVED } });
  });
});
