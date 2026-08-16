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
    feed(notification('sess-1', { availableCommands: [{ name: 'help' }] }));
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
   * Pins the arrival order observed against a live Hermes 0.14.0 during a
   * `session/load` resume:
   *
   *   1. UPDATE   user_message_chunk
   *   2. UPDATE   agent_message_chunk
   *   3. RESPONSE to session/load
   *   4. UPDATE   available_commands_update
   *   5. UPDATE   usage_update
   *
   * The replayed chat arrives *before* the response that `loadSession()`
   * resolves on; `available_commands_update` and `usage_update` are stragglers
   * that only arrive *after*. This is what makes `src/main/index.ts`'s
   * `circe/replay-start` … `circe/replay-end` bracket (sent synchronously
   * around the `await client.loadSession(...)` call) correct: every chat
   * update lands inside the bracket, and both trailing update kinds are ones
   * `render()` already ignores, so it doesn't matter that they land outside it.
   *
   * If a future Hermes instead trailed a *message* chunk after the
   * `session/load` response — reversing steps 2 and 4/5 relative to a chat
   * update — that chunk would arrive after `circe/replay-end` had already
   * closed the bracket, `replaying` would already be false, and the message
   * would be silently dropped rather than crash anything. This test fails
   * first if that regresses.
   */
  it('pins Hermes 0.14.0’s replay order — chat before the session/load response, non-chat after — so a future Hermes trailing a message chunk instead would come back caught here, not as a silently incomplete transcript', () => {
    const { client, drawn } = harness('sess-1');
    const feed = (client as unknown as WithHandle).handle.bind(client);

    // Steps 1-2: the replayed exchange, inside the bracket.
    drawn.push({ sessionUpdate: 'circe/replay-start' });
    feed(notification('sess-1', {
      sessionUpdate: 'user_message_chunk',
      content: { type: 'text', text: 'who are you?' },
    }));
    feed(notification('sess-1', {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: "I'm Spock." },
    }));

    // Step 3: the session/load response resolves — main/index.ts closes the bracket.
    drawn.push({ sessionUpdate: 'circe/replay-end' });

    // Steps 4-5: the trailing non-chat updates, outside the bracket.
    feed(notification('sess-1', { availableCommands: [{ name: 'help' }] }));
    feed(notification('sess-1', { sessionUpdate: 'usage_update', size: 1_000_000, used: 11_166 }));

    expect(render(drawn)).toEqual([
      { role: 'user', text: 'who are you?' },
      { role: 'agent', text: "I'm Spock." },
    ]);
  });
});
