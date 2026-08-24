# Permission Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tile shows its agent's Hermes approval mode in the header, lets the user cycle it, and asks dangerous-command approvals inside that agent's own window.

**Architecture:** `gate.ts` owns the mode — reading it from the profile's own `config.yaml` and writing it through `hermes config set`, never editing YAML. `acp.ts` forwards every `session/request_permission` it receives to the renderer and holds the JSON-RPC id until an answer comes back; it never checks the mode, because a request only reaches Circe when Hermes has already decided to ask. `TileRegistry` owns the pending map, the 60-second timer, and the deny-on-close rule. The card is a synthetic `circe/permission` session update so it lands in transcript order like every other `circe/` lifecycle event.

**Tech Stack:** TypeScript, Electron 32, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-24-permission-gate-design.md`

## Global Constraints

- **Circe never parses or rewrites `config.yaml`.** Reads extract one value; writes go through `hermes -p <id> config set approvals.mode <value>`. The file is ~500 lines of user-owned settings with comments.
- **Only `HermesRuntime` shells out.** `runtime.ts` says "Everything Circe is allowed to ask of Hermes. Nothing else may shell out." A new capability means a new method on the interface, implemented in `real.ts` and in `test/fake/hermes.ts`.
- **Circe answers only `allow_once`, `allow_session`, `deny`.** Never `allow_always` or `deny_always` — both write `command_allowlist` into `config.yaml`.
- **IPC from a renderer is routed by `profileForSender`,** never by a profile id the renderer supplies (§4.3.1, `index.ts:200`).
- **No em dashes in copy Circe writes** (2026-08-19 ruling). Applies to every user-facing string added here.
- **Deny is the default on every failure path:** expiry, a closed tile, a destroyed window, a malformed request, an unknown option id.
- **Nothing caches the mode.** `accessMode` in `tileState.ts:17` stays unused. The mode lives in the profile.
- **macOS only** (constraint 1).

---

### Task 1: Mode parsing and cycling

Pure functions, no IO. Everything else in the feature depends on these two.

**Files:**
- Create: `src/main/gate.ts`
- Test: `test/gate.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type ApprovalMode = 'manual' | 'smart' | 'off'`, `parseApprovalMode(yaml: string | null): ApprovalMode`, `nextMode(m: ApprovalMode): ApprovalMode`, `MODE_LABEL: Record<ApprovalMode, string>`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { MODE_LABEL, nextMode, parseApprovalMode } from '../src/main/gate';

/**
 * The real file is ~500 lines with an `approvals` block partway down, sitting
 * among other top-level blocks that also have a `mode:` key. Extracting the
 * value therefore has to be scoped to the block, not a bare `mode:` search.
 * Sample copied in shape from a real profile's config.yaml.
 */
const REAL_SHAPE = `
gateway:
  mode: polling
approvals:
  mode: manual
  timeout: 60
  cron_mode: deny
command_allowlist:
- script execution via -e/-c flag
`;

describe('parseApprovalMode', () => {
  it('reads the mode out of the approvals block', () => {
    expect(parseApprovalMode(REAL_SHAPE)).toBe('manual');
  });

  it('is not fooled by a mode key in another block', () => {
    expect(parseApprovalMode('gateway:\n  mode: polling\n')).toBe('manual');
  });

  it('reads smart and off', () => {
    expect(parseApprovalMode('approvals:\n  mode: smart\n')).toBe('smart');
    expect(parseApprovalMode('approvals:\n  mode: off\n')).toBe('off');
  });

  // Hermes' own _normalize_approval_mode has this exact carve-out: YAML parses
  // an unquoted `off` as the boolean false, and Hermes treats that as the
  // string mode rather than falling back. Circe reads the raw text, so it sees
  // whichever the user wrote, and must agree with Hermes on both.
  it('treats a quoted off the same as a bare one', () => {
    expect(parseApprovalMode('approvals:\n  mode: "off"\n')).toBe('off');
    expect(parseApprovalMode("approvals:\n  mode: 'off'\n")).toBe('off');
  });

  it('ignores case and surrounding whitespace', () => {
    expect(parseApprovalMode('approvals:\n  mode:   SMART  \n')).toBe('smart');
  });

  // Hermes' own default. An absent block, an unreadable file, or a value
  // Hermes would not recognise all mean the same thing to the user: the agent
  // will ask. The icon has to say what will happen, not what is written.
  it('falls back to manual for absent, empty, and unrecognised', () => {
    expect(parseApprovalMode(null)).toBe('manual');
    expect(parseApprovalMode('')).toBe('manual');
    expect(parseApprovalMode('approvals:\n  timeout: 60\n')).toBe('manual');
    expect(parseApprovalMode('approvals:\n  mode: banana\n')).toBe('manual');
  });

  it('ignores a commented-out mode', () => {
    expect(parseApprovalMode('approvals:\n  # mode: off\n  timeout: 60\n')).toBe('manual');
  });
});

describe('nextMode', () => {
  it('cycles manual to smart to off and back', () => {
    expect(nextMode('manual')).toBe('smart');
    expect(nextMode('smart')).toBe('off');
    expect(nextMode('off')).toBe('manual');
  });
});

describe('MODE_LABEL', () => {
  it('names every mode', () => {
    expect(Object.keys(MODE_LABEL).sort()).toEqual(['manual', 'off', 'smart']);
  });

  // The 2026-08-19 copy rule, held by a test rather than by anyone remembering.
  it('uses no em dashes', () => {
    for (const label of Object.values(MODE_LABEL)) expect(label).not.toContain('—');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/gate.test.ts`
Expected: FAIL, "Failed to resolve import ... src/main/gate".

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * The approval mode a profile's agent runs under. These are Hermes' own three
 * (`tools/approval.py::_normalize_approval_mode`), not names Circe invented:
 * the control in a tile header means exactly what the same setting means at a
 * terminal, in the TUI, and in Slack.
 *
 * There is deliberately no deny-everything mode. Hermes has none to mirror —
 * its nearest equivalent, `approvals.cron_mode: deny`, covers the
 * no-user-present case rather than a user choosing to refuse in advance.
 */
export type ApprovalMode = 'manual' | 'smart' | 'off';

/** What the header says. Deny is never one of these; see the type above. */
export const MODE_LABEL: Record<ApprovalMode, string> = {
  manual: 'Asks first',
  smart: 'Checks first',
  off: 'Never asks',
};

const MODES = new Set<string>(['manual', 'smart', 'off']);

/**
 * Pulls `approvals.mode` out of a profile's `config.yaml` without parsing it.
 *
 * Scoped to the block on purpose: the real file is ~500 lines and several
 * other top-level blocks carry their own `mode:` key, so a bare search finds
 * the wrong one. Circe reads this file and never writes it (see `setMode`),
 * so a regex over the text is the whole job — pulling in a YAML parser to
 * read one string would be a dependency taken on for nothing.
 *
 * Anything unreadable, absent, or unrecognised answers `manual`, which is
 * Hermes' own default. The icon has to say what will happen, not what is
 * written.
 */
export function parseApprovalMode(yaml: string | null): ApprovalMode {
  if (!yaml) return 'manual';
  // The block runs from `approvals:` at column 0 to the next column-0 key.
  const block = /^approvals:\s*$([\s\S]*?)(?=^\S|\Z)/m.exec(yaml);
  if (!block) return 'manual';
  // Indented, uncommented, and inside that block. The quotes are optional
  // because an unquoted `off` is the boolean false to a YAML parser, and
  // Hermes carries the same carve-out (approval.py:822).
  const m = /^\s+mode:\s*["']?([A-Za-z]+)["']?\s*$/m.exec(block[1]!);
  if (!m) return 'manual';
  const value = m[1]!.toLowerCase();
  return MODES.has(value) ? (value as ApprovalMode) : 'manual';
}

/** One click of the header icon. Matches the order the labels read in. */
export function nextMode(m: ApprovalMode): ApprovalMode {
  return m === 'manual' ? 'smart' : m === 'smart' ? 'off' : 'manual';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/gate.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/gate.ts test/gate.test.ts
git commit -m "feat: the three approval modes are Hermes' own, read from its own file"
```

---

### Task 2: Reading and writing the mode through Hermes

**Files:**
- Modify: `src/main/hermes/runtime.ts` (add `setConfig` to `HermesRuntime`)
- Modify: `src/main/hermes/real.ts` (implement it)
- Modify: `test/fake/hermes.ts` (implement it, recording calls)
- Modify: `src/main/gate.ts` (add `readMode`, `setMode`)
- Test: `test/gate.test.ts`

**Interfaces:**
- Consumes: `parseApprovalMode` from Task 1; `profileFilePath` and `HermesRuntime` from `hermes/runtime.ts`.
- Produces: `readMode(hermes: HermesRuntime, profileId: string): Promise<ApprovalMode>`, `setMode(hermes: HermesRuntime, profileId: string, mode: ApprovalMode): Promise<void>`, and `HermesRuntime.setConfig(profileId: string, key: string, value: string): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Append to `test/gate.test.ts`:

```ts
import { readMode, setMode } from '../src/main/gate';
import { FakeHermes, INSTALLED_WITH_AGENTS } from './fake/hermes';

describe('readMode', () => {
  it('reads the profile\'s own config.yaml, not the home\'s', async () => {
    const hermes = new FakeHermes(INSTALLED_WITH_AGENTS);
    hermes.files.set('config.yaml', 'approvals:\n  mode: off\n');
    hermes.files.set('profiles/ford/config.yaml', 'approvals:\n  mode: smart\n');
    expect(await readMode(hermes, 'ford')).toBe('smart');
  });

  // `default` keeps its files at the home root, exactly as SOUL.md does.
  it('reads the home root for the default profile', async () => {
    const hermes = new FakeHermes(INSTALLED_WITH_AGENTS);
    hermes.files.set('config.yaml', 'approvals:\n  mode: smart\n');
    expect(await readMode(hermes, 'default')).toBe('smart');
  });

  it('answers manual when the profile has no config.yaml', async () => {
    const hermes = new FakeHermes(INSTALLED_WITH_AGENTS);
    expect(await readMode(hermes, 'ford')).toBe('manual');
  });

  // readHomeFile rejects for a file that exists but cannot be read, and that
  // must not take the tile down: the user still gets a truthful icon.
  it('answers manual when the file cannot be read', async () => {
    const hermes = new FakeHermes(INSTALLED_WITH_AGENTS);
    hermes.failRead = 'profiles/ford/config.yaml';
    expect(await readMode(hermes, 'ford')).toBe('manual');
  });
});

describe('setMode', () => {
  it('writes through Hermes rather than touching the file', async () => {
    const hermes = new FakeHermes(INSTALLED_WITH_AGENTS);
    hermes.files.set('profiles/ford/config.yaml', '# hand written\napprovals:\n  mode: manual\n');
    await setMode(hermes, 'ford', 'off');
    expect(hermes.configSets).toEqual([
      { profileId: 'ford', key: 'approvals.mode', value: 'off' },
    ]);
    // The 500-line user-owned file is untouched by Circe.
    expect(hermes.files.get('profiles/ford/config.yaml')).toBe(
      '# hand written\napprovals:\n  mode: manual\n',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/gate.test.ts`
Expected: FAIL — `readMode` is not exported, and `hermes.configSets` / `hermes.failRead` do not exist.

- [ ] **Step 3: Write minimal implementation**

In `src/main/hermes/runtime.ts`, add to the `HermesRuntime` interface, after `writeHomeFileBytes`:

```ts
  /**
   * Sets one key in a profile's own `config.yaml`, through Hermes' own writer
   * (`hermes -p <id> config set <key> <value>`).
   *
   * Circe reads that file directly but must never write it: it is ~500 lines
   * of user-owned settings with comments and ordering that a parse-and-dump
   * would destroy, and Hermes owns its format. This is the one key Circe sets
   * (`approvals.mode`), and the method is narrow on purpose — a general
   * "write config" capability is a bigger door than this feature needs.
   */
  setConfig(profileId: string, key: string, value: string): Promise<void>;
```

In `src/main/hermes/real.ts`, add to `RealHermes` (the `exec` helper already carries `HERMES_ACCEPT_HOOKS` and the resolved bin):

```ts
  async setConfig(profileId: string, key: string, value: string): Promise<void> {
    await this.exec(['-p', profileId, 'config', 'set', key, value]);
  }
```

In `test/fake/hermes.ts`, add to `FakeHermes`:

```ts
  /** Every `setConfig` the code under test made, for assertions. */
  readonly configSets: Array<{ profileId: string; key: string; value: string }> = [];
  /** Path whose read should reject, standing in for a file that exists but cannot be read. */
  failRead: string | null = null;

  async setConfig(profileId: string, key: string, value: string): Promise<void> {
    this.configSets.push({ profileId, key, value });
  }
```

and change the existing `readHomeFile` to honour `failRead`:

```ts
  async readHomeFile(relPath: string): Promise<string | null> {
    if (this.failRead === relPath) throw new Error(`FakeHermes: cannot read ${relPath}`);
    return this.files.get(relPath) ?? null;
  }
```

In `src/main/gate.ts`, add at the top:

```ts
import { profileFilePath, type HermesRuntime } from './hermes/runtime';
```

and at the bottom:

```ts
/**
 * The mode this profile's agent is actually running under.
 *
 * Read fresh every time and never cached. A user can change this at a
 * terminal, and Hermes itself re-stats the file on every dangerous-command
 * check (`hermes_cli/config.py::_load_config_impl` keys its cache on
 * mtime and size), so a copy held here would be the only stale reading of it
 * in the system.
 */
export async function readMode(
  hermes: HermesRuntime,
  profileId: string,
): Promise<ApprovalMode> {
  try {
    return parseApprovalMode(await hermes.readHomeFile(profileFilePath(profileId, 'config.yaml')));
  } catch {
    // `readHomeFile` rejects for a file that exists but cannot be read. The
    // icon still has to say something, and `manual` is both Hermes' default
    // and the safe thing to claim.
    return 'manual';
  }
}

/** Changes it, through Hermes. See `HermesRuntime.setConfig` for why. */
export async function setMode(
  hermes: HermesRuntime,
  profileId: string,
  mode: ApprovalMode,
): Promise<void> {
  await hermes.setConfig(profileId, 'approvals.mode', mode);
}
```

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run && npm run typecheck`
Expected: PASS. The suite is run in full here because `setConfig` is a new member of an interface several fakes and callers implement.

- [ ] **Step 5: Commit**

```bash
git add src/main/gate.ts src/main/hermes/runtime.ts src/main/hermes/real.ts test/fake/hermes.ts test/gate.test.ts
git commit -m "feat: the mode is read from the profile and written by Hermes"
```

---

### Task 3: `acp.ts` forwards the request instead of approving it

**Files:**
- Modify: `src/main/acp.ts` (the `AcpOptions` interface, and the `session/request_permission` branch at `:333`)
- Test: `test/acp.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks. Deliberately: `acp.ts` never sees a mode.
- Produces: `type PermissionChoice = 'allow_once' | 'allow_session' | 'deny'`, `interface PermissionRequest { id: number; description: string; command: string }`, `AcpOptions.onPermission(req: PermissionRequest): Promise<PermissionChoice>`, and `optionIdFor(choice, options)` exported for its own test.

- [ ] **Step 1: Write the failing test**

Append to `test/acp.test.ts`:

```ts
import { optionIdFor } from '../src/main/acp';

/**
 * The option list Hermes actually sends, from
 * `acp_adapter/permissions.py::_build_permission_options`. Order matters: the
 * old code took "the first option whose kind starts with allow", which
 * happened to be allow_once only because of where it sits in this list.
 */
const HERMES_OPTIONS = [
  { optionId: 'allow_once', kind: 'allow_once', name: 'Allow once' },
  { optionId: 'allow_session', kind: 'allow_always', name: 'Allow for session' },
  { optionId: 'allow_always', kind: 'allow_always', name: 'Allow always' },
  { optionId: 'deny', kind: 'reject_once', name: 'Deny' },
  { optionId: 'deny_always', kind: 'reject_always', name: 'Deny always' },
];

describe('optionIdFor', () => {
  it('maps each choice to the option Hermes named', () => {
    expect(optionIdFor('allow_once', HERMES_OPTIONS)).toBe('allow_once');
    expect(optionIdFor('allow_session', HERMES_OPTIONS)).toBe('allow_session');
    expect(optionIdFor('deny', HERMES_OPTIONS)).toBe('deny');
  });

  // `allow_always` writes command_allowlist into config.yaml and `deny_always`
  // does the same in the other direction. Circe offers neither, so nothing
  // should be able to select them — this holds that line at the mapping layer
  // as well as in the UI.
  it('never returns a permanent option', () => {
    for (const choice of ['allow_once', 'allow_session', 'deny'] as const) {
      const id = optionIdFor(choice, HERMES_OPTIONS);
      expect(id).not.toBe('allow_always');
      expect(id).not.toBe('deny_always');
    }
  });

  // `allow_permanent: false` already suppresses allow_always when tirith
  // findings are present, and Hermes probes the installed SDK before offering
  // deny_always. An option Circe expects may simply not be there.
  it('falls back to another allow when the exact one is missing', () => {
    const withoutSession = HERMES_OPTIONS.filter((o) => o.optionId !== 'allow_session');
    expect(optionIdFor('allow_session', withoutSession)).toBe('allow_once');
  });

  it('falls back to deny when no usable option is offered', () => {
    expect(optionIdFor('allow_once', [])).toBe(null);
    expect(optionIdFor('deny', [{ optionId: 'x', kind: 'weird', name: 'x' }])).toBe(null);
  });
});

describe('session/request_permission', () => {
  function clientWith(onPermission: AcpOptions['onPermission']) {
    const sent: unknown[] = [];
    const client = new AcpClient({
      profileId: 'ford',
      onUpdate: () => {},
      onExit: () => {},
      onPermission,
    });
    // Same private-reach idiom as the rest of this file: capture what `send`
    // would have written, without a subprocess.
    (client as unknown as { send(msg: unknown): void }).send = (m) => sent.push(m);
    return { client, sent };
  }

  const REQUEST = {
    jsonrpc: '2.0',
    id: 7,
    method: 'session/request_permission',
    params: {
      sessionId: 's1',
      toolCall: {
        toolCallId: 'perm-check-1',
        title: 'Recursive delete: rm -rf build',
        rawInput: { command: 'rm -rf build', description: 'Recursive delete' },
        status: 'pending',
      },
      options: HERMES_OPTIONS,
    },
  };

  it('asks rather than approving, and answers with the chosen option', async () => {
    const asked: PermissionRequest[] = [];
    const { client, sent } = clientWith(async (r) => {
      asked.push(r);
      return 'allow_session';
    });
    (client as unknown as WithHandle).handle(REQUEST);
    await flush();

    expect(asked).toEqual([{ id: 7, description: 'Recursive delete', command: 'rm -rf build' }]);
    expect(sent).toEqual([
      {
        jsonrpc: '2.0',
        id: 7,
        result: { outcome: { outcome: 'selected', optionId: 'allow_session' } },
      },
    ]);
  });

  // Hermes builds the title as `{description}: {command}` and also sends both
  // separately in rawInput. rawInput is what Circe renders from; the title is
  // only a fallback, because a card that cannot name what it is asking about
  // is not an approval anyone can give.
  it('falls back to the title when rawInput is missing', async () => {
    const asked: PermissionRequest[] = [];
    const { client } = clientWith(async (r) => {
      asked.push(r);
      return 'deny';
    });
    (client as unknown as WithHandle).handle({
      ...REQUEST,
      params: { ...REQUEST.params, toolCall: { title: 'Recursive delete: rm -rf build' } },
    });
    await flush();
    expect(asked[0]!.command).toBe('Recursive delete: rm -rf build');
  });

  it('denies a request it cannot describe at all', async () => {
    let asked = 0;
    const { client, sent } = clientWith(async () => {
      asked++;
      return 'allow_once';
    });
    (client as unknown as WithHandle).handle({
      ...REQUEST,
      params: { ...REQUEST.params, toolCall: {} },
    });
    await flush();
    expect(asked).toBe(0);
    expect(sent).toEqual([
      { jsonrpc: '2.0', id: 7, result: { outcome: { outcome: 'cancelled' } } },
    ]);
  });

  // A rejected handler must not leave Hermes holding a thread for 60 seconds.
  it('denies when the handler throws', async () => {
    const { client, sent } = clientWith(async () => {
      throw new Error('window is gone');
    });
    (client as unknown as WithHandle).handle(REQUEST);
    await flush();
    expect(sent).toEqual([
      { jsonrpc: '2.0', id: 7, result: { outcome: { outcome: 'cancelled' } } },
    ]);
  });
});
```

Add this helper near the top of the file, beside the other private-reach types:

```ts
/** Drains the promise chain `handle` starts for a permission request. */
async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/acp.test.ts`
Expected: FAIL — `optionIdFor` is not exported, and `AcpOptions` has no `onPermission`.

- [ ] **Step 3: Write minimal implementation**

In `src/main/acp.ts`, add above `AcpOptions`:

```ts
/**
 * The three answers Circe is willing to give.
 *
 * Hermes offers five (`acp_adapter/permissions.py`), and the two missing here
 * are missing on purpose: `allow_always` writes `command_allowlist` into the
 * profile's `config.yaml`, and `deny_always` does the same in the other
 * direction. Circe sets exactly one key in that file, `approvals.mode`, and
 * only when the user clicks the header icon.
 */
export type PermissionChoice = 'allow_once' | 'allow_session' | 'deny';

export interface PermissionRequest {
  /** The JSON-RPC id Hermes is waiting on. */
  id: number;
  /** Why Hermes thinks this is dangerous, e.g. "Recursive delete". */
  description: string;
  /** The command itself. */
  command: string;
}

interface PermissionOption {
  optionId?: string;
  kind?: string;
  name?: string;
}

/**
 * Which of Hermes' option ids to send back for a choice.
 *
 * Not a constant map, because the option list is built per request:
 * `allow_permanent: false` suppresses `allow_always` when tirith findings are
 * present, and `deny_always` is only offered when the installed ACP SDK
 * accepts `reject_always`. So the choice has to be matched against what this
 * request actually offered, with a fallback to another option of the same
 * intent, and `null` — meaning cancel — when there is none.
 *
 * The old code here took "the first option whose kind starts with allow",
 * which returned `allow_once` only because of where it happens to sit in
 * Hermes' list. That was luck, and this is the decision.
 */
export function optionIdFor(
  choice: PermissionChoice,
  options: PermissionOption[] = [],
): string | null {
  const ids = new Set(options.map((o) => o.optionId).filter(Boolean));
  // Preference order per choice, never including a permanent option.
  const order: Record<PermissionChoice, string[]> = {
    allow_once: ['allow_once', 'allow_session'],
    allow_session: ['allow_session', 'allow_once'],
    deny: ['deny'],
  };
  return order[choice].find((id) => ids.has(id)) ?? null;
}
```

Add to `AcpOptions`:

```ts
  /**
   * A dangerous command needs an answer. Called only when Hermes asks, which
   * is `approvals.mode: manual` or a `smart` escalation — in `off` Hermes
   * approves internally and this never fires. So there is deliberately no
   * mode check on this path: the mode is Hermes' decision, already made by
   * the time the request arrives, and a second copy of it here would drift.
   */
  onPermission(req: PermissionRequest): Promise<PermissionChoice>;
```

Replace the branch at `acp.ts:333`:

```ts
    // A dangerous command. Hermes is holding an executor thread on this and
    // gives up after 60 seconds (`make_approval_callback`'s default, which
    // `acp_adapter/server.py:1368` does not override), so every path out of
    // here has to answer, and the default answer is no.
    if (msg.method === 'session/request_permission' && typeof msg.id === 'number') {
      const id = msg.id;
      const params = (msg.params ?? {}) as {
        options?: PermissionOption[];
        toolCall?: { title?: unknown; rawInput?: { command?: unknown; description?: unknown } };
      };
      const cancel = () =>
        this.send({ jsonrpc: '2.0', id, result: { outcome: { outcome: 'cancelled' } } });

      const raw = params.toolCall?.rawInput ?? {};
      const command =
        typeof raw.command === 'string' && raw.command
          ? raw.command
          : typeof params.toolCall?.title === 'string'
            ? params.toolCall.title
            : '';
      // A card that cannot name what it is asking about is not an approval
      // anyone could give. Refuse rather than present a blank one.
      if (!command) {
        cancel();
        return;
      }
      const description = typeof raw.description === 'string' ? raw.description : '';

      void this.opts
        .onPermission({ id, description, command })
        .then((choice) => {
          const optionId = optionIdFor(choice, params.options);
          if (optionId === null) {
            cancel();
            return;
          }
          this.send({
            jsonrpc: '2.0',
            id,
            result: { outcome: { outcome: 'selected', optionId } },
          });
        })
        .catch(() => cancel());
    }
```

- [ ] **Step 4: Run the suite**

Run: `npx vitest run && npm run typecheck`
Expected: FAIL in `typecheck` and in `test/tiles.test.ts` — `AcpOptions` now requires `onPermission`, and `TileClientOptions` in `tiles.ts` does not supply it. That is Task 4's job. To keep this task independently green, add `onPermission` to `TileClientOptions` and have `tiles.ts` pass `async () => 'deny'` with a `TODO(Task 4)` comment, then re-run.

- [ ] **Step 5: Commit**

```bash
git add src/main/acp.ts src/main/tiles.ts test/acp.test.ts
git commit -m "feat: a permission request is forwarded, not silently approved"
```

---

### Task 4: The tile asks, times out, and denies on close

**Files:**
- Modify: `src/main/tiles.ts` (`TileDeps`, the `Tile` record, `createClient` wiring, `close`)
- Test: `test/tiles.test.ts`

**Interfaces:**
- Consumes: `PermissionChoice`, `PermissionRequest` from Task 3.
- Produces: `TileDeps.bounce(): () => void`, `TileRegistry.answerPermission(profileId: string, id: number, choice: PermissionChoice): void`, and the two synthetic updates `circe/permission` and `circe/permission-resolved`.

- [ ] **Step 1: Write the failing test**

Append to `test/tiles.test.ts`:

```ts
describe('permission requests', () => {
  const REQ = { id: 7, description: 'Recursive delete', command: 'rm -rf build' };

  it('draws a card in the transcript and waits for the answer', async () => {
    const { registry, deps, clients, sent } = await openTile('ford');
    const answer = clients.get('ford')!.opts.onPermission(REQ);

    expect(sent('ford')).toContainEqual({
      sessionUpdate: 'circe/permission',
      id: 7,
      description: 'Recursive delete',
      command: 'rm -rf build',
    });

    registry.answerPermission('ford', 7, 'allow_session');
    expect(await answer).toBe('allow_session');
    expect(sent('ford')).toContainEqual({
      sessionUpdate: 'circe/permission-resolved',
      id: 7,
      outcome: 'allow_session',
    });
  });

  // Hermes gives up at 60 seconds and answers deny on its own. Circe expiring
  // first, at the same deadline, is what lets the card say "expired" rather
  // than leaving a live-looking card that answers into a void.
  it('expires after 60 seconds, and says expired rather than denied', async () => {
    vi.useFakeTimers();
    const { registry, clients, sent } = await openTile('ford');
    const answer = clients.get('ford')!.opts.onPermission(REQ);
    vi.advanceTimersByTime(60_000);
    expect(await answer).toBe('deny');
    expect(sent('ford')).toContainEqual({
      sessionUpdate: 'circe/permission-resolved',
      id: 7,
      outcome: 'expired',
    });
  });

  it('answers only once when the user beats the timer', async () => {
    vi.useFakeTimers();
    const { registry, clients, sent } = await openTile('ford');
    const answer = clients.get('ford')!.opts.onPermission(REQ);
    registry.answerPermission('ford', 7, 'allow_once');
    vi.advanceTimersByTime(60_000);
    expect(await answer).toBe('allow_once');
    const resolved = sent('ford').filter(
      (u) => (u as { sessionUpdate?: string }).sessionUpdate === 'circe/permission-resolved',
    );
    expect(resolved).toHaveLength(1);
  });

  // Hermes is holding an executor thread. A tile that has gone away must not
  // make it wait out the full 60 seconds for an answer nobody can give.
  it('denies immediately when the tile is closed', async () => {
    const { registry, clients } = await openTile('ford');
    const answer = clients.get('ford')!.opts.onPermission(REQ);
    registry.close('ford');
    expect(await answer).toBe('deny');
  });

  it('ignores an answer for an id it is not holding', async () => {
    const { registry } = await openTile('ford');
    expect(() => registry.answerPermission('ford', 999, 'allow_once')).not.toThrow();
  });

  it('asks the OS for attention once when the tile is not focused', async () => {
    const { deps, clients } = await openTile('ford');
    void clients.get('ford')!.opts.onPermission(REQ);
    expect(deps.bounces).toBe(1);
  });
});
```

`openTile` is a helper this file needs; add it beside the existing fixtures, following the shape the file's other tests already build by hand:

```ts
/**
 * Opens one tile and hands back the pieces these tests assert on: the
 * registry, the fake windows' sent messages, and the client options the
 * registry built, so a test can call `onPermission` exactly as `AcpClient`
 * would when Hermes asks.
 */
async function openTile(profileId: string) {
  const hermes = new FakeHermes(INSTALLED_WITH_AGENTS);
  const windows = new Map<string, { sent: unknown[]; win: TileWindow }>();
  const clients = new Map<string, { opts: TileClientOptions; client: TileClient }>();
  let bounces = 0;
  const deps: TileDeps & { bounces: number } = {
    hermes,
    bounce: () => {
      bounces++;
      return () => {};
    },
    createWindow: (_c, id) => {
      const sent: unknown[] = [];
      const win = fakeWindow(sent);
      windows.set(id, { sent, win });
      return win;
    },
    createClient: (opts) => {
      const client = fakeClient();
      clients.set(opts.profileId, { opts, client });
      return client;
    },
    get bounces() {
      return bounces;
    },
  };
  const registry = new TileRegistry(deps);
  await registry.launch(character(profileId), profileId);
  return {
    registry,
    deps,
    clients,
    sent: (id: string) =>
      windows.get(id)!.sent.filter((m) => (m as { channel?: string }).channel === 'tile:update')
        .map((m) => (m as { payload: unknown }).payload),
  };
}
```

Reuse the file's existing `fakeWindow` and `fakeClient` builders; if they are inline in the current tests, lift them to named helpers first as part of this step.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/tiles.test.ts`
Expected: FAIL — `deps.bounce` is not part of `TileDeps`, and `registry.answerPermission` does not exist.

- [ ] **Step 3: Write minimal implementation**

Add to `TileDeps` in `src/main/tiles.ts`:

```ts
  /**
   * Asks the OS to draw attention to the app, returning a function that stops
   * it. A card has 60 seconds and a tile is one small window among several on
   * a desktop, so a request that lands in an unfocused tile has to be
   * noticeable without being a notification.
   *
   * A dependency rather than a direct `app.dock.bounce` call for the same
   * reason `createWindow` is one: this module imports no Electron.
   */
  bounce(): () => void;
```

Add to the `Tile` interface:

```ts
  /** JSON-RPC ids Hermes is waiting on, and how to answer each. */
  pending: Map<number, (choice: PermissionChoice) => void>;
```

Initialise it to `new Map()` where the other `Tile` fields are set in `launch`.

Add to `TileClientOptions`, replacing the `TODO(Task 4)` stub from Task 3, and wire it where `createClient` is called:

```ts
      onPermission: (req) => this.askPermission(profileId, req),
```

Add the two methods:

```ts
  /**
   * Draws the card, then waits. Every path out of here resolves exactly once:
   * Hermes is holding an executor thread, and a promise that never settles
   * would hold it until its own 60-second timeout with no card to show for it.
   */
  private askPermission(profileId: string, req: PermissionRequest): Promise<PermissionChoice> {
    const tile = this.tiles.get(profileId);
    if (!tile || tile.win.isDestroyed()) return Promise.resolve('deny');

    return new Promise<PermissionChoice>((resolve) => {
      const stopBounce = this.deps.bounce();
      let done = false;
      const finish = (choice: PermissionChoice, outcome: string) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        stopBounce();
        tile.pending.delete(req.id);
        if (!tile.win.isDestroyed()) {
          this.emit(tile.win, { sessionUpdate: RESOLVED, id: req.id, outcome });
        }
        resolve(choice);
      };

      // Circe's deadline is Hermes' deadline: `make_approval_callback`'s
      // 60-second default, which the ACP adapter does not override with
      // `approvals.timeout`. Expiring here rather than waiting to be denied
      // from the other end is what lets the card distinguish "you ran out of
      // time" from "you said no".
      const timer = setTimeout(() => finish('deny', 'expired'), PERMISSION_TIMEOUT_MS);
      tile.pending.set(req.id, (choice) => finish(choice, choice));
      this.emit(tile.win, {
        sessionUpdate: PERMISSION,
        id: req.id,
        description: req.description,
        command: req.command,
      });
    });
  }

  /** The user clicked a button on a card. Routed by sender in `index.ts`. */
  answerPermission(profileId: string, id: number, choice: PermissionChoice): void {
    this.tiles.get(profileId)?.pending.get(id)?.(choice);
  }
```

Add the constants beside `REPLAY_ABANDONED`'s neighbours at the top of the file:

```ts
export const PERMISSION = 'circe/permission';
export const RESOLVED = 'circe/permission-resolved';
/** Hermes' own ceiling; see `askPermission`. */
export const PERMISSION_TIMEOUT_MS = 60_000;
```

In `close`, before the window is closed, settle anything outstanding:

```ts
    // Answer before the window goes, not after: Hermes is holding a thread per
    // request and would otherwise wait out its full timeout for a tile that no
    // longer exists.
    for (const answer of tile.pending.values()) answer('deny');
```

- [ ] **Step 4: Run the suite**

Run: `npx vitest run && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/tiles.ts test/tiles.test.ts
git commit -m "feat: the tile holds the request, and every path out of it answers"
```

---

### Task 5: The card in the transcript

**Files:**
- Create: `src/renderer/tile/permission.ts` (the pure part)
- Create: `test/permission.test.ts`
- Modify: `src/renderer/tile/main.ts` (two cases in the update switch)
- Modify: `src/renderer/tile/tile.css`
- Modify: `src/preload/tile.ts`

**Interfaces:**
- Consumes: `circe/permission` and `circe/permission-resolved` from Task 4.
- Produces: `commandPreview(command: string, maxLines?: number): { lines: string[]; overflow: number }`, `outcomeLabel(outcome: string): string`, and `circe.answerPermission(id, choice)` on the preload bridge.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { commandPreview, outcomeLabel } from '../src/renderer/tile/permission';

/**
 * Hermes' own TUI truncates the command at CMD_PREVIEW_LINES = 10 and notes
 * the remainder (`ui-tui/src/components/prompts.tsx`). Circe mirrors that
 * rather than inventing a second answer to the same question.
 */
describe('commandPreview', () => {
  it('passes a short command through whole', () => {
    expect(commandPreview('rm -rf build')).toEqual({ lines: ['rm -rf build'], overflow: 0 });
  });

  it('truncates at ten lines and counts the rest', () => {
    const command = Array.from({ length: 14 }, (_, i) => `line ${i + 1}`).join('\n');
    const { lines, overflow } = commandPreview(command);
    expect(lines).toHaveLength(10);
    expect(lines[9]).toBe('line 10');
    expect(overflow).toBe(4);
  });

  it('does not count a trailing newline as an extra line', () => {
    expect(commandPreview('rm -rf build\n').overflow).toBe(0);
  });

  it('survives an empty command without throwing', () => {
    expect(commandPreview('')).toEqual({ lines: [''], overflow: 0 });
  });
});

describe('outcomeLabel', () => {
  it('names each outcome the main process can send', () => {
    expect(outcomeLabel('allow_once')).toBe('Allowed once');
    expect(outcomeLabel('allow_session')).toBe('Allowed for this session');
    expect(outcomeLabel('deny')).toBe('Denied');
  });

  // Hermes draws the same distinction (`gateway.approval_expired`). Telling
  // someone they denied a thing they never saw is the failure worth avoiding.
  it('says expired rather than denied when the time ran out', () => {
    expect(outcomeLabel('expired')).toBe('Expired, the agent stopped waiting');
  });

  it('falls back rather than drawing a raw token', () => {
    expect(outcomeLabel('something-new')).toBe('Resolved');
  });

  it('uses no em dashes', () => {
    for (const o of ['allow_once', 'allow_session', 'deny', 'expired', 'x']) {
      expect(outcomeLabel(o)).not.toContain('—');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/permission.test.ts`
Expected: FAIL, "Failed to resolve import ... permission".

- [ ] **Step 3: Write minimal implementation**

`src/renderer/tile/permission.ts`:

```ts
/**
 * The parts of the permission card that are decisions rather than DOM, kept
 * here so a test can reach them — the move `toolLabel.ts` already made for the
 * same reason, on a renderer that otherwise has no coverage.
 */

/** Hermes' TUI shows ten lines and counts the rest; so does this. */
const PREVIEW_LINES = 10;

export function commandPreview(
  command: string,
  maxLines = PREVIEW_LINES,
): { lines: string[]; overflow: number } {
  const all = command.replace(/\n+$/, '').split('\n');
  return { lines: all.slice(0, maxLines), overflow: Math.max(0, all.length - maxLines) };
}

/**
 * What the card says once it is answered. `expired` is deliberately not
 * `Denied`: Hermes stopped waiting, and attributing that to the user is a
 * decision they did not make.
 */
export function outcomeLabel(outcome: string): string {
  switch (outcome) {
    case 'allow_once':
      return 'Allowed once';
    case 'allow_session':
      return 'Allowed for this session';
    case 'deny':
      return 'Denied';
    case 'expired':
      return 'Expired, the agent stopped waiting';
    default:
      return 'Resolved';
  }
}
```

In `src/preload/tile.ts`, add to the bridge:

```ts
  // A card's buttons. The id is Hermes' own JSON-RPC id, round-tripped so the
  // main process can match an answer to the request it is holding.
  answerPermission: (id: number, choice: string) =>
    ipcRenderer.send('tile:permission-answer', { id, choice }),
```

In `src/renderer/tile/main.ts`, add `answerPermission(id: number, choice: string): void;` to `TileApi`, import `commandPreview` and `outcomeLabel`, and add two cases to the update switch beside `circe/turn-end`:

```ts
    case 'circe/permission': {
      const p = update as { id?: number; description?: string; command?: string };
      if (typeof p.id !== 'number' || !p.command) break;
      log.append(permissionCard(p.id, p.description ?? '', p.command));
      break;
    }
    case 'circe/permission-resolved': {
      const p = update as { id?: number; outcome?: string };
      const card = document.querySelector(`[data-permission="${p.id}"]`);
      if (!card) break;
      card.classList.add('resolved');
      card.querySelector('.actions')?.replaceWith(
        Object.assign(document.createElement('div'), {
          className: 'outcome',
          textContent: outcomeLabel(p.outcome ?? ''),
        }),
      );
      break;
    }
```

and the builder, beside the other DOM helpers in that file:

```ts
/**
 * The card, mirroring Hermes' TUI: the danger as the heading, the command
 * below it truncated the same way, then the three answers Circe is willing to
 * give. It carries the tile's own accent rather than a generic warning red,
 * because a fleet of identical red boxes reads as a system dialog rather than
 * as this agent asking.
 */
function permissionCard(id: number, description: string, command: string): HTMLElement {
  const card = document.createElement('div');
  card.className = 'permission';
  card.dataset.permission = String(id);

  const head = document.createElement('div');
  head.className = 'head';
  head.textContent = description || 'Needs your approval';
  card.append(head);

  const { lines, overflow } = commandPreview(command);
  const pre = document.createElement('pre');
  pre.className = 'command';
  // textContent, never innerHTML: this string comes from the agent's own
  // tool call, and this renderer's markdown path does not sanitize.
  pre.textContent = lines.join('\n');
  card.append(pre);

  if (overflow > 0) {
    const more = document.createElement('div');
    more.className = 'more';
    more.textContent = `+${overflow} more line${overflow === 1 ? '' : 's'}`;
    card.append(more);
  }

  const actions = document.createElement('div');
  actions.className = 'actions';
  for (const [choice, label] of [
    ['allow_once', 'Allow once'],
    ['allow_session', 'Allow this session'],
    ['deny', 'Deny'],
  ] as const) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', () => circe.answerPermission(id, choice));
    actions.append(b);
  }
  card.append(actions);
  return card;
}
```

Add to `tile.css`, following the existing custom-property names (`--tile-border`, and the accent the palette sets):

```css
/* The card is the agent asking, so it wears the agent's colours. */
.permission {
  border: 1px solid var(--tile-accent);
  border-radius: 10px;
  padding: 10px 12px;
  margin: 8px 0;
}
.permission .head { font-weight: 600; margin-bottom: 6px; }
.permission .command {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  white-space: pre-wrap;
  /* A single unbroken token must not push the card sideways. */
  overflow-wrap: anywhere;
  margin: 0;
}
.permission .more { font-size: 12px; opacity: 0.7; margin-top: 4px; }
.permission .actions { display: flex; gap: 8px; margin-top: 10px; }
.permission.resolved .command { opacity: 0.7; }
.permission .outcome { font-size: 12px; opacity: 0.8; margin-top: 10px; }
```

- [ ] **Step 4: Run the suite**

Run: `npx vitest run && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/tile/permission.ts src/renderer/tile/main.ts src/renderer/tile/tile.css src/preload/tile.ts test/permission.test.ts
git commit -m "feat: the card asks in the agent's own window, in transcript order"
```

---

### Task 6: The header icon

**Files:**
- Modify: `src/main/index.ts` (two `ipcMain` handlers, and the mode on tile load)
- Modify: `src/main/tiles.ts` (send `tile:mode` when a tile loads; a `cycleMode` entry point)
- Modify: `src/main/windows.ts` (supply `bounce` from `app.dock`)
- Modify: `src/preload/tile.ts`, `src/renderer/tile/index.html`, `src/renderer/tile/main.ts`, `src/renderer/tile/tile.css`
- Test: `test/gate.test.ts`, `test/tiles.test.ts`

**Interfaces:**
- Consumes: `readMode`, `setMode`, `nextMode`, `MODE_LABEL` (Tasks 1-2); `profileForSender` (existing).
- Produces: `circe.onMode(cb)` and `circe.cycleMode()` on the bridge; `tile:mode` and `tile:cycle-mode` channels.

- [ ] **Step 1: Write the failing test**

Append to `test/tiles.test.ts`:

```ts
describe('the mode in the header', () => {
  it('sends the profile\'s mode when the tile loads', async () => {
    const { hermes, sentOn } = await openTileWith('ford', {
      'profiles/ford/config.yaml': 'approvals:\n  mode: smart\n',
    });
    expect(sentOn('ford', 'tile:mode')).toEqual(['smart']);
  });

  it('cycling writes through Hermes and echoes what is now on disk', async () => {
    const { registry, hermes, sentOn } = await openTileWith('ford', {
      'profiles/ford/config.yaml': 'approvals:\n  mode: manual\n',
    });
    // FakeHermes records the call rather than editing the file, so stand in
    // for what `hermes config set` would have written.
    hermes.files.set('profiles/ford/config.yaml', 'approvals:\n  mode: smart\n');
    await registry.cycleMode('ford');
    expect(hermes.configSets).toEqual([
      { profileId: 'ford', key: 'approvals.mode', value: 'smart' },
    ]);
    expect(sentOn('ford', 'tile:mode')).toEqual(['manual', 'smart']);
  });

  // The icon must never show a mode that is not on disk: a failed write with
  // an optimistic icon tells the user their agent will ask when it will not.
  it('leaves the icon alone when the write fails', async () => {
    const { registry, hermes, sentOn } = await openTileWith('ford', {
      'profiles/ford/config.yaml': 'approvals:\n  mode: manual\n',
    });
    hermes.failConfigSet = true;
    await registry.cycleMode('ford');
    expect(sentOn('ford', 'tile:mode')).toEqual(['manual']);
  });
});
```

`openTileWith` is `openTile` from Task 4 with two additions: seed files, and a way to read a named channel rather than only `tile:update`. Replace `openTile` with it and have the Task 4 tests call `openTileWith(profileId, {})`:

```ts
async function openTileWith(profileId: string, files: Record<string, string>) {
  const opened = await openTile(profileId, files);
  return {
    ...opened,
    /** Payloads sent on one channel, in order. */
    sentOn: (id: string, channel: string) =>
      opened.raw(id)
        .filter((m) => (m as { channel: string }).channel === channel)
        .map((m) => (m as { payload: unknown }).payload),
  };
}
```

`openTile` gains a `files` parameter it passes to `new FakeHermes({ ...INSTALLED_WITH_AGENTS, files: { ...INSTALLED_WITH_AGENTS.files, ...files } })`, exposes the seeded `hermes`, and returns `raw(id)` alongside `sent(id)` — the unfiltered list of `{ channel, payload }` the fake window recorded. `sent(id)` stays as Task 4 defined it, in terms of `raw`.

Add `failConfigSet` to `FakeHermes`:

```ts
  /** Makes `setConfig` reject, standing in for a `hermes config set` that failed. */
  failConfigSet = false;
```

and guard the method added in Task 2:

```ts
  async setConfig(profileId: string, key: string, value: string): Promise<void> {
    if (this.failConfigSet) throw new Error('FakeHermes: config set failed');
    this.configSets.push({ profileId, key, value });
  }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/tiles.test.ts`
Expected: FAIL — `registry.cycleMode` does not exist.

- [ ] **Step 3: Write minimal implementation**

In `src/main/tiles.ts`, import `nextMode, readMode, setMode` from `./gate`, send the mode where the tile's other first-load messages go (beside `sendAvatar`):

```ts
    void this.sendMode(tile);
```

and add:

```ts
  /** The icon shows what is on disk. Read, never remembered. */
  private async sendMode(tile: Tile): Promise<void> {
    const mode = await readMode(this.deps.hermes, tile.profileId);
    if (!tile.win.isDestroyed()) tile.win.send('tile:mode', mode);
  }

  /**
   * One click of the header icon.
   *
   * Writes, then re-reads, then sends. Never optimistic: a failed
   * `hermes config set` with an icon that moved anyway would tell the user
   * their agent asks first when it does not, which is the one lie this
   * control must not tell.
   */
  async cycleMode(profileId: string): Promise<void> {
    const tile = this.tiles.get(profileId);
    if (!tile) return;
    try {
      await setMode(
        this.deps.hermes,
        profileId,
        nextMode(await readMode(this.deps.hermes, profileId)),
      );
    } catch (err) {
      console.warn(`Could not change the approval mode for "${profileId}".`, err);
      return;
    }
    await this.sendMode(tile);
  }
```

In `src/main/index.ts`, import `PermissionChoice` from `./acp` and add these beside the other `tile:` handlers. Both route by sender, never by a profile id the renderer supplies, for the reason `tile:prompt` documents just above them:

```ts
  ipcMain.on('tile:permission-answer', (e, msg: { id: number; choice: PermissionChoice }) => {
    const profileId = tiles.profileForSender(e.sender);
    if (profileId === null) return;
    tiles.answerPermission(profileId, msg.id, msg.choice);
  });
  ipcMain.on('tile:cycle-mode', (e) => {
    const profileId = tiles.profileForSender(e.sender);
    if (profileId === null) return;
    void tiles.cycleMode(profileId);
  });
```

In `src/main/windows.ts`, supply `bounce` to the registry's deps:

```ts
/**
 * A card has 60 seconds and a tile is one window among several. `informational`
 * bounces once and settles rather than bouncing until focus, which is the
 * right weight for "someone should look at this" and the wrong weight for a
 * notification.
 */
export function bounceDock(): () => void {
  const id = app.dock?.bounce('informational');
  return () => {
    if (typeof id === 'number') app.dock?.cancelBounce(id);
  };
}
```

In `src/preload/tile.ts`:

```ts
  // The approval mode lives in the profile's own config.yaml, so it can change
  // from a terminal as well as from this button. Main re-reads and sends.
  onMode: (cb: (mode: string) => void) =>
    ipcRenderer.on('tile:mode', (_e, mode: string) => cb(mode)),
  cycleMode: () => ipcRenderer.send('tile:cycle-mode'),
```

In `src/renderer/tile/index.html`, add the button to `#bar` after `#who`:

```html
<button id="gate" type="button" title="Approval mode"></button>
```

In `src/renderer/tile/main.ts`, add `onMode(cb: (mode: string) => void): void;` and `cycleMode(): void;` to `TileApi`, import the labels the same way this file already imports from main (`import { DEFAULT_PALETTE, isPalette, paletteVars } from '../../main/palette'` is the existing precedent):

```ts
import { MODE_LABEL, type ApprovalMode } from '../../main/gate';
```

then wire it:

```ts
const gate = document.getElementById('gate') as HTMLButtonElement;
gate.addEventListener('click', () => circe.cycleMode());
circe.onMode((mode) => {
  // Labels live in main/gate.ts so one list serves the header and any later
  // surface; an unknown value draws nothing rather than a raw token.
  gate.textContent = MODE_LABEL[mode as ApprovalMode] ?? '';
  gate.dataset.mode = mode;
});
```

In `tile.css`, push the icon to the trailing edge of the bar, which since 2026-08-20 is `flex-start` with a gap:

```css
#gate {
  margin-left: auto;
  flex: none;
  font: inherit;
  font-size: 11px;
  color: inherit;
  background: transparent;
  border: 1px solid var(--tile-border);
  border-radius: 999px;
  padding: 3px 9px;
  cursor: pointer;
  opacity: 0.75;
}
#gate:hover { opacity: 1; }
```

- [ ] **Step 4: Run the suite**

Run: `npx vitest run && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: the header says which mode the agent is in, and changes it"
```

---

### Task 7: Verify against the real runtime, and record it

The suite cannot cover the renderer half, and the walkthrough has one question to answer that no test can: whether 60 seconds is enough to notice a card and answer it in a windowed app.

**Files:**
- Modify: `docs/build-decision-record-2026-08-14.md` (a new dated section)
- Modify: `~/Code/circe-oss-spec.md` (§6.4 and §10.4)

- [ ] **Step 1: Run it on a sandboxed `HERMES_HOME`**

Follow `.claude/skills/run-circe`. Record the real home's `SOUL.md` hash and profile list before starting, exactly as every previous walkthrough has.

- [ ] **Step 2: Work through each case by eye**

- The header icon reads the profile's real mode on open, and cycles manual → smart → off → manual, with `hermes -p <id> config show` agreeing after each click.
- A dangerous command in `manual` draws the card. Read it: the description names the danger, the command is legible, a multi-line command truncates with a count.
- Answer it three ways across three runs: Allow once runs the command, Allow this session runs it and the next one of the same shape is not asked about, Deny stops it and the agent says so.
- Leave one unanswered. It reads as expired, not denied, and the agent reports a denial.
- Switch a tile to `off` mid-conversation and confirm the next dangerous command is not asked about, with no restart.
- Trigger a card with the tile unfocused and confirm the dock bounces once.
- Confirm the real `~/.hermes` is byte-identical, and that the sandbox's `config.yaml` kept its comments and key order after Circe wrote to it.

- [ ] **Step 3: Amend the spec**

§6.4 loses Locked, Ask and Unlocked in favour of `manual`, `smart`, `off`, with a note that Hermes has no deny-everything state to mirror. §10.4 becomes a mode-change liveness test. Mark both as amended 2026-08-24, matching how §6.5 and §5.5's earlier amendments are marked.

- [ ] **Step 4: Write the decision record entry**

A dated section covering: that the modes are Hermes' and why that reverses the 2026-08-16 no-writing-config ruling; that the ACP adapter ignores `approvals.timeout` and every Circe card therefore has 60 seconds; what the walkthrough showed, including whatever 60 seconds felt like in practice; and anything seen but not judged.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: what the permission gate walkthrough showed"
```

---

## Self-Review

**Spec coverage.** Every section of the design maps to a task: the modes and their labels to Task 1; reading and writing to Task 2; the ACP forwarding, the three-choice restriction and the option fallback to Task 3; the pending map, expiry, deny-on-close and the dock bounce to Task 4; the card to Task 5; the icon to Task 6; the walkthrough, the spec amendments and the decision record to Task 7. The design's "mode changed while a card is pending leaves the card standing" needs no code: nothing in Task 4 or Task 6 touches `pending` on a mode change, which is the behaviour by construction rather than by a branch.

**Deliberately not covered.** §5.5's coding-profile designation, and the upstream report about `approvals.timeout`, both marked out of scope in the design.

**Known gap carried forward.** The renderer's update switch and `index.ts` still have no suite coverage, so Tasks 5 and 6 are verified by eye in Task 7. Two walkthroughs have flagged this; this branch does not close it and Task 7's entry should say so rather than imply the feature is covered.
