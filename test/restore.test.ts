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
 */
type Bubble = { role: 'user' | 'agent'; text: string };

function render(updates: Array<Record<string, unknown>>): Bubble[] {
  const out: Bubble[] = [];
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
    let current = true;
    const deps: RestoreDeps = {
      hermes,
      client,
      profileId: 'default',
      session,
      emit: (u) => void steps.push(String(u.sessionUpdate)),
      tileReady: Promise.resolve(),
      isCurrent: () => current,
      sendPrompt: (sessionId, text) => void sent.push({ sessionId, text }),
    };
    return {
      hermes,
      client,
      session,
      steps,
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

    expect(h.steps).toEqual([REPLAY_START, 'load:sess-prior', REPLAY_END]);
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

    expect(h.steps).toEqual([REPLAY_START, 'load:sess-prior', REPLAY_END, REPLAY_ABANDONED, 'new']);
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

    expect(h.steps).toEqual([REPLAY_START, 'load:sess-prior', REPLAY_END, REPLAY_ABANDONED]);
    expect(h.client.newSessionCalls).toBe(0);
  });

  it('does not claim a replay was abandoned when none was ever started', async () => {
    const h = harness();

    await restoreOrCreateSession(h.deps);

    expect(h.steps).toEqual(['new']);
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
