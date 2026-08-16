import { describe, expect, it } from 'vitest';
import { AcpClient } from '../src/main/acp';

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
