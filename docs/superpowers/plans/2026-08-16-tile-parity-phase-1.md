# Tile Parity Phase 1 — Session Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A cold start reopens the orchestrator's tile onto the conversation it already had, instead of an empty transcript.

**Architecture:** `AcpClient` stops owning exactly one implicit session and becomes a multiplexer with an explicit session lifecycle (`newSession`, `loadSession`, `prompt(sessionId, …)`), routing every `session/update` by the notification's outer `sessionId`. Circe remembers which session a profile's tile was last on in `HERMES_HOME/circe/state.json`, and on launch asks Hermes to resume it. The transcript is rebuilt from Hermes' own replay — Circe stores no message text.

**Tech Stack:** TypeScript, Electron 32, electron-vite, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-16-tile-parity-design.md`

## Global Constraints

Copied from `~/Code/circe-oss-spec.md`; every task's requirements implicitly include these.

- **Constraint 3 — ACP JSON-RPC over stdio is the only transport to a profile.** Do not invent a second transport.
- **Constraint 7 — Circe reimplements nothing Hermes ships.** Conversations, titles, and context accounting are Hermes'.
- **Constraint 10 — a profile describes itself; Circe stores no agent facts.** Circe's state file holds window facts only. This plan's state file therefore holds session ids and nothing about who the agent is.
- **Constraint 4 — no telemetry.** Circe's own process makes zero network calls.
- **Constraint 1 — macOS only.** Do not add platform abstractions for later.
- **Copy rule (§1.4):** UI text is plain and honest; it never claims something happened that did not.
- **Verified protocol facts** (spec §2, captured from Hermes 0.14.0 — do not re-derive from assumption): `initialize` returns `agentCapabilities.loadSession: true`; `session/load` takes `{cwd, sessionId, mcpServers}` and replays history outbound as `session/update` notifications; notification params are `{sessionId, update:{sessionUpdate, …}}` with the discriminator on the **inner** object.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/main/acp.ts` (modify) | ACP transport. Gains explicit session lifecycle and sessionId-routed updates. |
| `src/main/tileState.ts` (create) | Pure read/parse/serialize of `circe/state.json`. No Electron, no I/O policy. |
| `src/main/index.ts` (modify) | Wiring: restore-or-create a session on tile launch, persist it, route prompts. |
| `src/renderer/tile/main.ts` (modify) | Renders replayed user messages; closes a bubble between replayed turns. |
| `test/acp.test.ts` (modify) | Session lifecycle and routing. |
| `test/tileState.test.ts` (create) | State round-trip and degradation. |
| `test/restore.test.ts` (create) | Boundary test: fake ACP → replay → rendered transcript. |

---

### Task 1: ACP session lifecycle and routed updates

**Files:**
- Modify: `src/main/acp.ts:13-18` (options), `:45` (field), `:68-108` (`doStart`), `:116-122` (`prompt`), `:134-142` (`stop`), `:170-175` (update dispatch)
- Test: `test/acp.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `AcpOptions.onUpdate(sessionId: string, update: AcpUpdate): void`; `AcpClient.canLoadSession: boolean`; `AcpClient.newSession(): Promise<string>`; `AcpClient.loadSession(sessionId: string): Promise<boolean>`; `AcpClient.prompt(sessionId: string, text: string): Promise<void>`.

**Why the shape changes:** `doStart` currently creates a session as part of the handshake, which makes "resume the old one instead" impossible to express. Splitting the handshake from session creation is what lets Task 4 decide.

- [ ] **Step 1: Write the failing tests**

Add to `test/acp.test.ts`:

```ts
// Same private-reach idiom as the rest of this file: no subprocess, no faked
// protocol traffic. `handshake` is the half of startup that does not spawn.
type WithHandshake = { handshake(): Promise<void> };
type WithSessionUpdate = { onUpdate(sessionId: string, update: Record<string, unknown>): void };

describe('AcpClient session lifecycle', () => {
  function client(): AcpClient {
    return new AcpClient({ profileId: 'test', onUpdate: () => {}, onExit: () => {} });
  }

  it('records that the agent supports loadSession', async () => {
    const c = client();
    vi.spyOn(c as unknown as WithRequest, 'request').mockResolvedValue({
      agentCapabilities: { loadSession: true },
    });

    await (c as unknown as WithHandshake).handshake();

    expect(c.canLoadSession).toBe(true);
  });

  it('treats a missing capability block as no loadSession support', async () => {
    const c = client();
    vi.spyOn(c as unknown as WithRequest, 'request').mockResolvedValue({});

    await (c as unknown as WithHandshake).handshake();

    expect(c.canLoadSession).toBe(false);
  });

  it('refuses to load a session when the agent never advertised support', async () => {
    const c = client();
    const request = vi.spyOn(c as unknown as WithRequest, 'request');

    await expect(c.loadSession('sess-1')).resolves.toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it('reports a failed load as false rather than throwing, so launch can fall back', async () => {
    const c = client();
    vi.spyOn(c as unknown as WithRequest, 'request').mockImplementation(async (method) => {
      if (method === 'initialize') return { agentCapabilities: { loadSession: true } };
      throw new Error('no such session');
    });
    await (c as unknown as WithHandshake).handshake();

    await expect(c.loadSession('gone')).resolves.toBe(false);
  });

  it('returns the id from session/new', async () => {
    const c = client();
    vi.spyOn(c as unknown as WithRequest, 'request').mockResolvedValue({ sessionId: 'sess-9' });

    await expect(c.newSession()).resolves.toBe('sess-9');
  });

  it('prompts the session it was given, not an implicit one', async () => {
    const c = client();
    const request = vi
      .spyOn(c as unknown as WithRequest, 'request')
      .mockResolvedValue({ stopReason: 'end_turn' });

    await c.prompt('sess-3', 'hello');

    expect(request).toHaveBeenCalledWith('session/prompt', {
      sessionId: 'sess-3',
      prompt: [{ type: 'text', text: 'hello' }],
    });
  });
});

describe('session/update routing', () => {
  it('forwards the outer sessionId alongside the inner update', () => {
    const seen: Array<{ id: string; u: Record<string, unknown> }> = [];
    const c = new AcpClient({
      profileId: 'test',
      onUpdate: (id, u) => seen.push({ id, u: u as Record<string, unknown> }),
      onExit: () => {},
    });

    (c as unknown as WithHandle).handle({
      method: 'session/update',
      params: {
        sessionId: 'sess-B',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } },
      },
    });

    expect(seen).toEqual([
      {
        id: 'sess-B',
        u: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } },
      },
    ]);
  });

  it('drops a notification carrying no sessionId, since it cannot be routed', () => {
    const seen: string[] = [];
    const c = new AcpClient({
      profileId: 'test',
      onUpdate: (id) => seen.push(id),
      onExit: () => {},
    });

    (c as unknown as WithHandle).handle({
      method: 'session/update',
      params: { update: { sessionUpdate: 'agent_message_chunk' } },
    });

    expect(seen).toEqual([]);
  });
});
```

Update the three existing `session/update forwarding` tests in this file to the two-argument callback: `onUpdate: (_id, u) => seen.push(u as Record<string, unknown>)`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/acp.test.ts`
Expected: FAIL — `handshake is not a function`, `canLoadSession` undefined, `loadSession is not a function`.

- [ ] **Step 3: Implement**

In `src/main/acp.ts`, change the options interface:

```ts
export interface AcpOptions {
  profileId: string;
  cwd?: string;
  /**
   * `sessionId` is the *outer* `params.sessionId` of the notification; `update`
   * is the inner object carrying `sessionUpdate`. One client serves several
   * sessions, so the id is the only thing that says which tab an update belongs
   * to — forwarding the update alone would land a replayed history in whatever
   * tab happened to be active.
   */
  onUpdate(sessionId: string, update: AcpUpdate): void;
  onExit(code: number | null): void;
}
```

Replace the `sessionId` field (`:45`) with:

```ts
  private loadSessionSupported = false;
```

Split the handshake out of `doStart` so startup no longer implies a session:

```ts
  private async doStart(): Promise<void> {
    const { bin } = hermesPaths();
    // …spawn block unchanged, through the `child.on('exit', …)` handler…
    await this.handshake();
  }

  /**
   * The half of startup that talks protocol rather than spawning. Separate so
   * it can be tested without a subprocess, and so `doStart` no longer creates a
   * session: whether to resume an existing conversation or begin a new one is a
   * decision for the caller, made after the handshake tells us whether resuming
   * is possible at all.
   */
  private async handshake(): Promise<void> {
    const init = (await this.request(
      'initialize',
      {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
      },
      HANDSHAKE_TIMEOUT_MS,
    )) as { agentCapabilities?: { loadSession?: unknown } } | null;
    this.loadSessionSupported = init?.agentCapabilities?.loadSession === true;
  }

  /** Whether this agent can resume a prior conversation (Hermes 0.14.0: yes). */
  get canLoadSession(): boolean {
    return this.loadSessionSupported;
  }

  async newSession(): Promise<string> {
    const session = (await this.request(
      'session/new',
      { cwd: this.opts.cwd ?? homedir(), mcpServers: [] },
      HANDSHAKE_TIMEOUT_MS,
    )) as { sessionId: string };
    return session.sessionId;
  }

  /**
   * Resumes a prior conversation. Hermes rehydrates it from its own store and
   * replays the history outbound as `session/update` notifications — Circe
   * uploads nothing.
   *
   * Returns false rather than throwing on every failure path, because every
   * failure has the same sane answer: open a fresh session. A session id can
   * legitimately go stale (the profile was deleted, the store was cleared), and
   * a tile that refuses to open because last week's conversation is gone would
   * be worse than one that starts empty.
   */
  async loadSession(sessionId: string): Promise<boolean> {
    if (!this.loadSessionSupported) return false;
    try {
      await this.request(
        'session/load',
        { cwd: this.opts.cwd ?? homedir(), sessionId, mcpServers: [] },
        HANDSHAKE_TIMEOUT_MS,
      );
      return true;
    } catch (err) {
      console.warn(`Could not resume ACP session ${sessionId}; starting a new one.`, err);
      return false;
    }
  }

  async prompt(sessionId: string, text: string): Promise<void> {
    await this.request('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text }],
    });
  }
```

In `stop()` (`:134`), replace `this.sessionId = null;` with `this.loadSessionSupported = false;`.

In the `session/update` branch (`:170`), route by id:

```ts
    if (msg.method === 'session/update') {
      const params = (msg.params ?? {}) as { sessionId?: unknown; update?: unknown };
      const { sessionId, update } = params;
      if (typeof sessionId === 'string' && update && typeof update === 'object') {
        this.opts.onUpdate(sessionId, update as AcpUpdate);
      }
      return;
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/acp.test.ts && npm run typecheck`
Expected: acp tests PASS. Typecheck FAILS in `src/main/index.ts` (its `onUpdate` and `prompt` calls no longer match) — that is Task 4's job and is expected here.

- [ ] **Step 5: Commit**

```bash
git add src/main/acp.ts test/acp.test.ts
git commit -m "refactor: give the acp client an explicit session lifecycle"
```

---

### Task 2: The tile state store

**Files:**
- Create: `src/main/tileState.ts`
- Test: `test/tileState.test.ts`

**Interfaces:**
- Consumes: `HermesRuntime` from `src/main/hermes/runtime.ts` (`readHomeFile`, `writeHomeFile`).
- Produces: `TILE_STATE_PATH`; `ProfileTileState { tabs: string[]; activeIndex: number }`; `TileStateFile { version: 1; profiles: Record<string, ProfileTileState> }`; `parseTileState(json: string | null): TileStateFile`; `stateFor(file: TileStateFile, profileId: string): ProfileTileState`; `withActiveSession(file, profileId, sessionId): TileStateFile`; `serializeTileState(file): string`; `readTileState(hermes): Promise<TileStateFile>`; `writeTileState(hermes, file): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `test/tileState.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  EMPTY_STATE,
  parseTileState,
  serializeTileState,
  stateFor,
  withActiveSession,
} from '../src/main/tileState';

describe('parseTileState', () => {
  it('reads a well-formed record', () => {
    const file = parseTileState(
      JSON.stringify({ version: 1, profiles: { default: { tabs: ['s1'], activeIndex: 0 } } }),
    );
    expect(stateFor(file, 'default')).toEqual({ tabs: ['s1'], activeIndex: 0 });
  });

  it('treats an absent file as empty rather than failing', () => {
    expect(parseTileState(null)).toEqual(EMPTY_STATE);
  });

  it('treats corrupt JSON as empty', () => {
    expect(parseTileState('{not json')).toEqual(EMPTY_STATE);
  });

  // Same rule as startup.ts: a record written by a later Circe may hold fields
  // this build would half-read. Losing which tab was open costs a scroll-back;
  // acting on a shape we don't understand costs correctness.
  it('ignores a record written by a future version', () => {
    const file = parseTileState(JSON.stringify({ version: 2, profiles: { default: { tabs: ['s1'], activeIndex: 0 } } }));
    expect(file).toEqual(EMPTY_STATE);
  });

  it('drops a profile whose tabs are not strings', () => {
    const file = parseTileState(
      JSON.stringify({ version: 1, profiles: { default: { tabs: [7], activeIndex: 0 } } }),
    );
    expect(stateFor(file, 'default')).toEqual({ tabs: [], activeIndex: 0 });
  });

  it('clamps an activeIndex that points past the end', () => {
    const file = parseTileState(
      JSON.stringify({ version: 1, profiles: { default: { tabs: ['s1'], activeIndex: 4 } } }),
    );
    expect(stateFor(file, 'default').activeIndex).toBe(0);
  });
});

describe('stateFor', () => {
  it('returns an empty state for a profile with no record', () => {
    expect(stateFor(EMPTY_STATE, 'ford')).toEqual({ tabs: [], activeIndex: 0 });
  });
});

describe('withActiveSession', () => {
  it('records the session as the profile’s only tab', () => {
    const next = withActiveSession(EMPTY_STATE, 'default', 's1');
    expect(stateFor(next, 'default')).toEqual({ tabs: ['s1'], activeIndex: 0 });
  });

  it('leaves other profiles untouched', () => {
    const first = withActiveSession(EMPTY_STATE, 'default', 's1');
    const second = withActiveSession(first, 'ford', 's2');
    expect(stateFor(second, 'default').tabs).toEqual(['s1']);
    expect(stateFor(second, 'ford').tabs).toEqual(['s2']);
  });

  it('round-trips through serialize and parse', () => {
    const next = withActiveSession(EMPTY_STATE, 'default', 's1');
    expect(parseTileState(serializeTileState(next))).toEqual(next);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/tileState.test.ts`
Expected: FAIL — cannot find module `../src/main/tileState`.

- [ ] **Step 3: Implement**

Create `src/main/tileState.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/tileState.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/tileState.ts test/tileState.test.ts
git commit -m "feat: remember which conversation a tile was on"
```

---

### Task 3: Render a replayed conversation

**Files:**
- Modify: `src/renderer/tile/main.ts:133-170` (the update switch)
- Test: covered by Task 5's boundary test (this renderer module has no unit test harness today; do not invent one here)

**Interfaces:**
- Consumes: `circe/replay-start` and `circe/replay-end` synthetic updates produced by Task 4.
- Produces: rendering behaviour Task 5 asserts against.

**Why a replay flag:** the tile prints the user's own message locally the moment they hit Enter. If Hermes also echoes `user_message_chunk` during a live turn, rendering those unconditionally would double every message the user sends. Rendering them only while replaying is correct whether or not Hermes echoes, so it does not depend on a behaviour we have not verified.

- [ ] **Step 1: Implement**

In `src/renderer/tile/main.ts`, add beside the other module-level state (`:52-54`):

```ts
/**
 * True between `circe/replay-start` and `circe/replay-end`, while Hermes is
 * replaying a resumed conversation. Two things differ during a replay: the
 * user's own messages have to be drawn (nothing typed them into this window),
 * and each message ends a turn, because a replay has no `session/prompt` to
 * resolve and would otherwise concatenate every agent reply in the history into
 * one bubble.
 */
let replaying = false;
```

Add these cases to the `circe.onUpdate` switch, before `case 'circe/turn-end'`:

```ts
    case 'user_message_chunk': {
      if (!replaying) return; // live turns are drawn by the input handler
      const piece = extractText(u.content);
      if (!piece) return;
      endTurn();
      appendText('user', piece);
      return;
    }
    case 'circe/replay-start':
      replaying = true;
      return;
    case 'circe/replay-end':
      replaying = false;
      // Closes the last replayed agent message, which has no turn-end of its own.
      endTurn();
      return;
```

And make an agent chunk close a previous replayed turn — replace the `agent_message_chunk` case body's first lines:

```ts
    case 'agent_message_chunk': {
      const piece = extractText(u.content);
      if (!piece) return;
      // During a replay each agent message is its own turn; without this the
      // second and later replies append to the first reply's bubble.
      if (replaying && !streaming) endTurn();
      if (!streaming) streaming = appendText('agent', '');
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: still fails only in `src/main/index.ts` (Task 4). No new renderer errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/tile/main.ts
git commit -m "feat: draw a replayed conversation in the tile"
```

---

### Task 4: Restore or create a session on launch

**Files:**
- Modify: `src/main/index.ts:53-80` (tile-ready plumbing), `:102-158` (`launchTile`), `:205-220` (`tile:prompt`)
- Test: Task 5 covers the behaviour end to end.

**Interfaces:**
- Consumes: Task 1's `AcpClient` API; Task 2's `readTileState`/`writeTileState`/`stateFor`/`withActiveSession`.
- Produces: module-level `activeSessionId: string | null`; `circe/replay-start` / `circe/replay-end` updates consumed by Task 3.

- [ ] **Step 1: Implement the tile-ready promise**

`sendTileUpdate` drops anything sent before `did-finish-load`, and a replay is a burst of updates immediately after `session/load`. Replace the `tileLoaded`/`tileQueue` block (`:53-54`) with:

```ts
let tileLoaded = false;
let tileQueue: string[] = [];
/**
 * Resolves when the tile's renderer has registered its listeners. A replay is a
 * burst of `session/update` notifications arriving the moment `session/load`
 * is answered, and `sendTileUpdate` has no queue — so the load must not be
 * issued until there is something on the other end to draw it.
 */
let tileReady: Promise<void> = Promise.resolve();
/** The session the tile is currently showing. Updates for any other are dropped. */
let activeSessionId: string | null = null;
```

In `launchTile`, replace the `did-finish-load` wiring (`:112-121`) with:

```ts
  tileLoaded = false;
  tileQueue = greeting === null ? [] : [greeting];
  tileReady = new Promise<void>((resolve) => {
    tileWin!.webContents.once('did-finish-load', () => {
      tileLoaded = true;
      for (const text of tileQueue.splice(0)) tileWin?.webContents.send('tile:opening', text);
      resolve();
    });
  });
```

- [ ] **Step 2: Route updates by session**

Replace the `AcpClient` construction (`:123-127`):

```ts
  acp = new AcpClient({
    profileId,
    onUpdate: (sessionId, u) => {
      // One client can serve several sessions; only the one on screen is drawn.
      if (sessionId !== activeSessionId) return;
      sendTileUpdate(u as Record<string, unknown>);
    },
    onExit: (code) => sendTileUpdate({ sessionUpdate: 'circe/exited', code }),
  });
```

Add to the `closed` handler (`:138`), alongside `acp = null`:

```ts
    activeSessionId = null;
```

- [ ] **Step 3: Restore or create after the handshake**

Add above `launchTile`:

```ts
/**
 * Resumes the conversation this profile's tile was last on, or begins a new one.
 *
 * Hermes owns the conversation: `session/load` asks it to rehydrate from its own
 * store, and it replays the history back as updates. Circe uploads nothing and
 * keeps no copy — the id in `circe/state.json` is the whole of what it remembers.
 *
 * Every failure lands on the same answer, a fresh session, because a tile that
 * refuses to open because last week's conversation went missing is worse than
 * one that opens empty.
 */
async function restoreOrCreateSession(client: AcpClient, profileId: string): Promise<void> {
  const saved = stateFor(await readTileState(hermes), profileId);
  const prior = saved.tabs[saved.activeIndex] ?? null;

  if (prior && client.canLoadSession) {
    activeSessionId = prior; // set first: the replay's updates carry this id
    await tileReady;
    sendTileUpdate({ sessionUpdate: 'circe/replay-start' });
    const resumed = await client.loadSession(prior);
    sendTileUpdate({ sessionUpdate: 'circe/replay-end' });
    if (resumed) return;
  }

  activeSessionId = await client.newSession();
  await writeTileState(hermes, withActiveSession(await readTileState(hermes), profileId, activeSessionId));
}
```

Replace the `try`/`catch` around `acp.start()` (`:144-154`):

```ts
  try {
    await acp.start();
    await restoreOrCreateSession(acp, profileId);
  } catch (err) {
    acp.stop();
    const message = err instanceof Error ? err.message : String(err);
    sendToTile(
      "I couldn't reach the Hermes agent behind this tile, so I can't respond yet. " +
        'Check that Hermes is installed and set up (`hermes setup` in a terminal), ' +
        `then close this tile and start over.\n\n(${message})`,
    );
  }
```

Add the imports at the top of the file:

```ts
import { readTileState, stateFor, withActiveSession, writeTileState } from './tileState';
```

- [ ] **Step 4: Route the prompt**

In `registerIpc`'s `tile:prompt` handler (`:205`), replace `client.prompt(text)`:

```ts
  ipcMain.on('tile:prompt', (_e, text: string) => {
    const client = acp;
    const sessionId = activeSessionId;
    if (!client || !sessionId) return;
    void client.prompt(sessionId, text).then(
```

- [ ] **Step 5: Verify the whole suite and the typecheck**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all existing tests plus Tasks 1–2's new ones PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: reopen a tile onto the conversation it was having"
```

---

### Task 5: Boundary test — load to rendered transcript

**Files:**
- Create: `test/restore.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing later tasks depend on.

**Why this task exists:** twelve clean per-task reviews once shipped a product whose tile could never display a reply, because no test crossed the transport→renderer boundary. This is that test. It drives the real `AcpClient` frame handler with the exact notification shapes captured in spec §2 and asserts what the renderer would draw.

- [ ] **Step 1: Write the failing test**

Create `test/restore.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run test/restore.test.ts`
Expected: PASS. If any case fails, the defect is real — fix the source, not the test.

- [ ] **Step 3: Full suite**

Run: `npm run typecheck && npm test`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add test/restore.test.ts
git commit -m "test: cross the transport-to-renderer boundary on resume"
```

---

### Task 6: Walk it through on the real runtime

**Files:** none — this task produces evidence, not code.

Automated tests cannot see what the last build shipped broken. Follow `.claude/skills/run-circe/SKILL.md`, which sandboxes `HERMES_HOME` so the operator's real `~/.hermes/SOUL.md` and profiles are untouched.

- [ ] **Step 1: Build and launch against a fresh sandbox**

```bash
rm -rf "${TMPDIR}circe-hermes-home"
npm run build
```
Then launch via the driver and complete onboarding with any fandom.

- [ ] **Step 2: Have a real exchange**

Send a message, wait for the reply to render.

- [ ] **Step 3: Quit and cold-start**

`quit`, then relaunch. **Expected:** the tile opens directly on the agent, and the previous exchange is drawn — user message and agent reply in separate bubbles, Markdown formatted, no repeated onboarding greeting.

- [ ] **Step 4: Confirm the record and the real home**

```bash
cat "${TMPDIR}circe-hermes-home/circe/state.json"     # one session id
shasum ~/.hermes/SOUL.md                               # must be unchanged
```

- [ ] **Step 5: Record what you saw**

Append to `docs/build-decision-record-2026-08-14.md`: what was observed by eye, and anything that could not be verified. Say plainly what was not checked.

- [ ] **Step 6: Commit**

```bash
git add docs/build-decision-record-2026-08-14.md
git commit -m "docs: record the phase 1 walkthrough"
```

---

## Self-Review

**Spec coverage (phase 1 scope):** §4.1 ACP multiplexer → Task 1. §4.2 transcript restore, replay rendering, failed-load fallback, capability gate → Tasks 1, 3, 4. §3 state file location and shape → Task 2 (`bounds` and `accessMode` arrive in Phases 4–5; the parser ignores unknown keys rather than rejecting, so those records stay readable). §6 testing → Tasks 1, 2, 5, 6. Deliberately out of phase 1: tabs UI, fleet tiles, the palette move, the gate, chrome.

**Placeholder scan:** every code step carries real code; no "handle errors appropriately", no "similar to Task N".

**Type consistency:** `onUpdate(sessionId, update)` is used with two arguments in Tasks 1, 4, 5. `loadSession` returns `Promise<boolean>` everywhere. `stateFor`/`withActiveSession`/`readTileState`/`writeTileState` names match between Tasks 2 and 4. `circe/replay-start` and `circe/replay-end` are spelled identically in Tasks 3, 4, 5.

**One known gap, deliberately left:** whether Hermes echoes `user_message_chunk` during a *live* turn is unverified. Task 3's replay flag makes the tile correct either way, which is why this plan does not block on finding out.
