# The Permission Gate — Design

**Status:** approved 2026-08-24, ready for an implementation plan.
**Spec:** `~/Code/circe-oss-spec.md` — §6.3.1 (the header), §6.4 (the gate), §10.4 (liveness),
§10.5 (state survival), constraint 10.
**Amends:** §6.4 and §10.4 of the spec, and the 2026-08-16 ruling in
`docs/build-decision-record-2026-08-14.md` that Circe must never write `config.yaml`. Both changes
are recorded below under "What this reverses, and why".

## Goal

A tile shows which approval mode its agent is in, and lets the user change it from the header. When
the agent tries to run something Hermes considers dangerous, the question is asked in that agent's
own window and answered there.

Today `acp.ts` answers every such question with a silent yes.

## Scope

**In.** The header icon and its three modes, reading and writing the mode, the inline permission
card, the answer path back to Hermes, expiry, and the unfocused-tile signal.

**Out, deliberately.**

- **The coding-profile designation (§5.5).** Every profile opens in whatever mode its `config.yaml`
  already says, which for a profile Hermes created is `manual`. §5.5's explicit opt-in, and the
  persona inference behind it, are their own piece of work. Nothing here blocks them.
- **Any Circe-side auto-approval.** See "Why there is no quiet card".
- **Edit approvals as a separate surface.** Hermes' `edit_approval.py` reaches Circe through the same
  `session/request_permission` method, so it is handled by the same card with no second path. It is
  not separately designed here because there is nothing separate to design.

## Evidence: how Hermes actually does this

Read on 2026-08-24 from `~/.hermes/hermes-agent` at the installed version. This section is the
reason most of the design below is not a choice.

### The modes are Hermes', and there are three

`tools/approval.py` reads `approvals.mode` from `config.yaml` and normalises it to one of `manual`,
`smart`, `off`, defaulting to `manual`.

- **`manual`** prompts the user on every dangerous command that has not already been approved for
  the session.
- **`smart`** asks an auxiliary LLM first (`_smart_approve`), which returns `approve`, `deny`, or
  `escalate`. Only `escalate` reaches the user. An LLM approval also grants session scope for that
  pattern.
- **`off`** returns approved before any prompt path is reached, equivalent to `--yolo`.

There is **no deny-everything mode**. The closest thing Hermes has is `approvals.cron_mode: deny`,
which covers the no-user-present case and denies with a message telling the agent to find another
approach rather than a bare refusal.

### Every surface offers the same four choices

| Surface | Where | Choices |
|---|---|---|
| CLI | `locales/en.yaml`, `approval.choose_long` | `[o]nce \| [s]ession \| [a]lways \| [d]eny` |
| TUI | `ui-tui/src/components/prompts.tsx` | Allow once, Allow this session, Always allow, Deny |
| Slack / Discord | gateway queue, `/approve` and `/deny` | the same set |

Deny is the default everywhere: the CLI prompt reads `Choice [o/s/a/D]`, Esc denies in the TUI, an
unrecognised keystroke denies, a timeout denies, and a failed notify denies.

The four are not equivalent in cost. `once` and `session` are in-memory only — `approve_session`
keyed by session key, gone when the agent stops. **`always` writes to `command_allowlist` in
`config.yaml`.** That distinction is what decides which three Circe offers.

### The TUI card is the shape to copy

`prompts.tsx` renders a bordered box in the theme's warn colour: `⚠ approval required ·
{description}`, then the command truncated to `CMD_PREVIEW_LINES = 10` with a `… +N more lines`
overflow note, then the options.

### What Hermes sends over ACP

`acp_adapter/permissions.py` builds the request. Option ids are `allow_once`, `allow_session`,
`allow_always`, `deny`, `deny_always`, mapped back to Hermes' `once` / `session` / `always` / `deny`.
The payload is a `ToolCallUpdate` with id `perm-check-N`, kind `execute`, status `pending`, a title
of `{description}: {command}`, and `raw_input` carrying `command` and `description` separately. The
separate `raw_input` fields are what Circe renders from; the title is a convenience string.

### The ACP timeout is 60 seconds and is not configurable

`make_approval_callback` takes `timeout: float = 60.0`. `acp_adapter/server.py:1368` calls it as
`make_approval_callback(conn.request_permission, loop, session_id)` — with no timeout argument. So
the ACP path **ignores `approvals.timeout`**, which the CLI path does read, and it does not use
`approvals.gateway_timeout` (300s) either, despite Circe resembling the gateway far more than the
CLI. On expiry the callback returns `deny`.

This looks like a gap on the Hermes side rather than a decision. It is filed as a question for
upstream and this design does not wait on it. See "Open, and deliberately not solved here".

### A config change reaches a running agent without a restart

`hermes_cli/config.py::_load_config_impl` caches on `(st_mtime_ns, st_size)` and re-stats the file on
every call. `_get_approval_mode()` calls `load_config()` per dangerous-command check. So writing
`approvals.mode` while `hermes acp` is mid-response changes how the very next command is treated.

**This is the mechanism that makes §10.4 true.** Liveness is not something Circe implements; it is
something Circe must avoid breaking by caching the mode itself.

### Each profile carries its own `config.yaml`

Verified across all seven profiles in the real `~/.hermes`: each has an `approvals` block, currently
`mode: manual`, `timeout: 60`, `cron_mode: deny`. `get_config_path()` is `get_hermes_home() /
"config.yaml"`, and `hermes -p <id>` redirects the home, so the file a mode change must land in is
the profile's own. The files are around 500 lines of user-owned settings with comments.

## What this reverses, and why

**The 2026-08-16 ruling said Circe must not write `config.yaml`.** That ruling came from applying the
mirror-Hermes rule to profile replacement: `hermes profile update` preserves `config.yaml` as
user-owned, so Circe treats approval policy as Hermes' business and only answers the requests it
surfaces.

The product owner's decision on 2026-08-24 is that the header icon should carry **Hermes' own modes**
rather than a Circe-local three-state of its own. That requires writing `approvals.mode`.

The ruling is superseded rather than contradicted, and the same rule produced both: mirroring Hermes
means the control in Circe's header should mean exactly what the same setting means at a terminal, in
the TUI, and in Slack. A Circe-local mode would have been a fourth vocabulary for a thing Hermes had
already named three times. The boundary that survives is narrower and still real: **Circe writes one
key, through Hermes' own writer, and never parses or rewrites the file.**

**§6.4 of the spec is amended.** Locked, Ask, Unlocked become `off`, `manual`, `smart` — and Locked
disappears, because Hermes has no deny-everything state to mirror. The spec's "locked still renders a
card showing what was denied, so the user can see the agent tried" goes with it.

**§10.4 of the spec is amended.** "Set a tile to Locked mid-response, assert the next tool call is
auto-denied" becomes "change a tile's mode mid-response, assert the next dangerous command is treated
under the new mode". The property being tested — no session or turn boundary required — is unchanged.

## Architecture

### `src/main/gate.ts` (new)

Owns the mode: reading it, writing it, and cycling it. It exists as its own module rather than inside
`AcpClient` because
`acp.ts` is transport, and this project's decision record already carries two entries about rules
that outlived the shape they were written for, both caused by policy living where it was convenient.
A separate module is also testable without spawning a subprocess.

```ts
export type ApprovalMode = 'manual' | 'smart' | 'off';

/** Reads the profile's own config.yaml. Never caches: see liveness. */
export function readMode(runtime: HermesRuntime, profileId: string): Promise<ApprovalMode>;

/** Writes through Hermes' own writer. Never edits the YAML. */
export function writeMode(runtime, profileId, mode: ApprovalMode): Promise<void>;

export function nextMode(m: ApprovalMode): ApprovalMode; // manual → smart → off → manual
```

**Reading** parses only the `approvals.mode` line out of the profile's `config.yaml`. Circe already
reads files it does not own (`SOUL.md`, `circe.json`); reading was never the part the ruling
restricted. An unreadable or absent file degrades to `manual`, which is Hermes' own default, so the
icon tells the truth about what will happen rather than about what is written.

**Writing** shells out: `hermes -p <id> config set approvals.mode <value>`, with `HERMES_HOME`
propagated the way every other spawn in `real.ts` already does. This is the same pattern the
orchestrator skill uses for `hermes profile create`, and it means a 500-line user-owned YAML is
written by the tool that owns its format, keeping comments and key order intact.

**No caching, deliberately.** The icon reads the mode when the tile opens and after a write. It does
not hold a copy that a terminal-side change could make stale.

### `src/main/acp.ts` (changed)

The block at `acp.ts:333` currently finds the first allow-shaped option and answers it. It becomes:

1. Read `command` and `description` from `params.toolCall.rawInput`, falling back to the title.
2. Forward to the renderer and hold the JSON-RPC id.
3. When the renderer answers, reply with the matching option id.

**There is no mode check on this path, and that is the point of mirroring Hermes.** A request only
reaches Circe when Hermes has already decided to ask: `manual`, or a `smart` escalation. In `off`
nothing arrives. So `acp.ts` never branches on the mode, and `gate.ts` owns the mode for the icon's
sake alone. A mode check here would be a second copy of a decision Hermes has already made, and the
two would drift.

**Circe only ever sends `allow_once`, `allow_session`, or `deny`.** Never `allow_always`, because
that writes `command_allowlist`; never `deny_always`, for the same reason in the other direction. If
Hermes did not offer the id the user picked — `allow_permanent: false` suppresses `allow_always` when
tirith findings are present, and could suppress others later — Circe falls back to the nearest option
Hermes did send, and to `deny` if there is none.

A request whose tile has closed, or whose window is gone, is answered `deny` immediately rather than
left to expire. Hermes is holding a thread for it.

### IPC

Three channels out, two in, following the existing `tile:` convention (`tile:character`, `tile:prompt`,
`tile:close`):

| Channel | Direction | Payload |
|---|---|---|
| `tile:permission` | main → renderer | `{ id, description, command }` |
| `tile:permission-resolved` | main → renderer | `{ id, outcome }` — for expiry and for cancellation |
| `tile:permission-answer` | renderer → main | `{ id, choice }` |
| `tile:mode` | main → renderer | the current `ApprovalMode` |
| `tile:cycle-mode` | renderer → main | no payload; main writes and echoes back `tile:mode` |

The renderer never decides anything. It draws what it is told and reports what was clicked, which is
the same division `applyCharacter` already uses and the reason a bad update there costs colours
rather than identity.

### The renderer

**The icon** joins `#bar`, which since 2026-08-20 is `justify-content: flex-start` with a 34px avatar
and the name. The icon sits at the trailing edge. Its exact placement, size, and glyph are decided by
rendering real options in the running tile and picking by eye, the way the 34px avatar was — not
specified here. What is fixed: it names the current mode, one click cycles, and it is legible against
every profile palette rather than only the ones tested.

**The card** renders inline in `#log`, in transcript order, mirroring the TUI's structure: the
description as the heading, the command below it truncated at 10 lines with a `+N more lines` note,
then three buttons. It carries the tile's accent colour rather than a generic warning red, because a
tile's identity is per-profile and a fleet of red cards would look like a system dialog rather than
like this agent asking.

After it is answered the card stays in the transcript recording what happened, so scrolling back
shows the decision alongside the command it applied to.

**Expiry.** The card is live for 60 seconds. The main process owns the timer, because Hermes' clock
is what actually matters and a renderer timer could drift or be suspended with the window. On expiry
main sends `tile:permission-resolved` with `expired` and the card says so.

**Expired is not denied.** Hermes makes the same distinction: `gateway.approval_expired` reads
"Approval expired (agent is no longer waiting). Ask the agent to try again." Telling a user they
denied something they never saw is the failure worth avoiding.

### The unfocused tile

Tiles are independent windows scattered across a desktop, and a card has 60 seconds. When one arrives
in a tile that is not focused, main asks the OS for attention once: `app.dock.bounce('informational')`
on macOS, cancelled when the card is answered or expires. No notification, no popup, no sound.

## Why there is no quiet card

An earlier draft recorded auto-approvals in the transcript as a low-contrast card, on the reasoning
that a user in the permissive mode should still be able to see what was waved through.

**It is not buildable under this design, and the reason is worth keeping.** With `mode: off`,
`check_dangerous_command` returns at `tools/approval.py:1086` before any interactive path is reached.
Circe is never contacted, receives no command text, and has no event to draw a card about. The same
is true of the low-risk commands `smart` approves on its own: Circe sees only escalations.

Keeping the card would have meant not passing `off` down to Hermes at all — leaving Hermes in
`manual` and having Circe answer yes silently — which makes the icon describe a Circe behaviour in
one position and a Hermes setting in the other two. The product owner's call is that the transcript
stays quiet and the modes mean what Hermes means.

The command is still visible. An auto-approved command still produces its ordinary tool bubble,
`⚙ terminal: …`, from the tool-call updates. What is not visible is that Hermes classified it as
dangerous.

## Failure handling

| Case | Behaviour |
|---|---|
| `config.yaml` unreadable or absent | Icon shows `manual`, Hermes' own default. No write attempted until the user clicks. |
| `hermes config set` fails | The icon does not move. The mode shown is always the mode on disk, never an optimistic one. |
| Tile closed with a card pending | Answered `deny` immediately. Hermes is holding a thread. |
| Window destroyed mid-request | Same. |
| Mode changed while a card is pending | The card stands. It is a question Hermes already asked and is still waiting on; cancelling it would strand the agent for the remaining timeout. This differs from §6.4's "resolve pending cards as cancelled", which existed because Circe owned the modes; now Hermes does. |
| Malformed request (no command, no title) | Denied, and logged. Circe will not present an approval it cannot describe. |
| Two requests at once | Each gets its own card and its own id. `perm-check-N` is already unique per request, and parallel subagents can produce concurrent requests. |

## Testing

**Unit, in the suite.** `gate.ts` against a fake runtime: mode parsing including a missing block and
a malformed file, `nextMode` cycling, and that `writeMode` shells to `hermes config set` with the
profile and `HERMES_HOME` rather than touching the file. `acp.ts` against a scripted peer: that a
request is forwarded, that the answer maps to the right option id, that `allow_always` and
`deny_always` are never sent, that a suppressed option falls back correctly, and that a closed tile
denies.

**§10.4, rewritten.** Change mode mid-response against a scripted peer, assert the next request is
treated under the new mode with no session or turn boundary. The property is that nothing caches the
mode.

**By eye, on a sandboxed `HERMES_HOME`.** The card, the icon, the cycle, and a real dangerous command
answered three ways, against real Hermes. The renderer remains the file with no suite coverage, which
two walkthroughs have now flagged; this branch does not close that hole and should not pretend to.

**The question the walkthrough has to answer:** whether 60 seconds is enough to notice a card and
answer it in practice, or whether `manual` feels broken in a windowed app. That finding decides
whether the upstream timeout question matters or is academic.

## Open, and deliberately not solved here

- **The ACP timeout ignores `approvals.timeout`.** Worth reporting upstream. A user who raises that
  setting will find it changes the CLI and not Circe. Circe builds to 60 seconds either way.
- **§5.5's coding-profile designation.** Out of scope by decision; see Scope.
- **Session-scoped approvals are invisible.** If the user picks "Allow this session", Hermes
  remembers the pattern and stops asking. Nothing in the tile says so, and nothing lets the user take
  it back short of restarting the agent. Recorded because it follows from offering the option, not
  because it was judged.

## What this does not touch

The wizard, derivation, avatars, the fleet watch, tile launch and restore, `circe.json`, or
`circe/state.json`. The `accessMode` field reserved in `tileState.ts:17` stays unused and unwritten:
the mode lives in the profile, which is constraint 10 working as intended, and §10.5's "restore each
tile's gate mode" is satisfied without Circe storing anything.
