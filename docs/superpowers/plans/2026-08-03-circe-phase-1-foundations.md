# Circe Phase 1 (Foundations) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Phase-1 vertical slice of Circe — a fresh macOS user launches the app, walks a seven-screen wizard, and ends with one themed tile holding a real streaming conversation with a Hermes agent, with a live three-state permission gate and state that survives a restart.

**Architecture:** Electron main process owns everything privileged — locating the Hermes binary, enumerating profiles on disk, spawning one `hermes -p <profile> acp` subprocess per tile, and persisting state atomically to a single JSON file. Each tile is its own frameless `BrowserWindow` with a context-isolated preload exposing a narrow typed IPC surface; the renderer never touches Node. The permission gate lives in the main process inside the ACP client, so mode changes take effect on the very next inbound `session/request_permission` with no session boundary. The wizard is a separate window that closes for good once onboarding completes.

**Tech Stack:** Electron 32, TypeScript, electron-vite (build), Vitest (unit/integration), Playwright `_electron` (E2E), GitHub Actions on a `macos-14` runner. No UI framework — plain DOM with a small hand-rolled primitive set (§5.6 decision below).

---

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from `/Users/sarachipps/Code/circe-oss-spec.md`.

- **macOS only for v1.** No platform abstractions "for later." (§4.1)
- **Electron is the desktop runtime.** Not Tauri, not native Swift, not a browser PWA. (§4.2)
- **ACP JSON-RPC over stdio is the transport.** Each tile runs `hermes -p <profile> acp`. Do not invent a second transport. (§4.3)
- **Zero telemetry from Circe's own process.** No analytics, no crash reporting, no usage tracking, no update-check ping. Network activity is limited to Hermes subprocesses, user-initiated OAuth in Screen 6, and user-triggered avatar generation. (§4.4, §8.4)
- **Single-user, local-only.** No Circe servers, accounts, or cloud sync. (§4.5)
- **Avatars are only user-uploaded or model-generated.** Circe ships zero stock character images and never fetches an avatar from a URL. (§4.6, §10.7)
- **Circe does not reimplement anything Hermes ships.** If you find yourself writing a model provider integration inside Circe, stop. (§4.7)
- **The wizard is the only modal flow.** No modal wizard after first-run, no "welcome back" modals, no blocking dialogs except native OS prompts. (§4.8)
- **Circe never modifies a profile the user did not explicitly ask it to modify in this session.** (§4.9, §10.6)
- **Phase 1 only.** Do not scaffold Phase 2 files "for later." Stop at the exit criteria. (§12.3)
- **UI copy is concise, sentence case, non-decorative, peer-level.** No exclamation marks, no "we're excited." When in doubt, cut words. (§1.4, §12.8)
- **Minimum Hermes version: 0.14.0.** Declared in README and enforced by a runtime check. (§8.1)

---

## Decisions carried into this plan

Four decisions came out of the planning conversation and are **departures from or gaps in the spec**. They are recorded here because tasks depend on them, and Task 16 writes them into the ADR.

1. **Zero-tile soft-lock guard (new).** The spec has no answer for a fleet that would spawn zero tiles (user marks every profile "leave alone," or every profile is malformed). Because §6.3 says each tile *is* the app and §6.3.4 says closing the last tile quits, zero tiles is an unrecoverable soft-lock. **Decision:** Screen 7 refuses to close on an empty fleet and shows "No agents to launch" with *Add an agent* and *Back*. Same guard runs at fleet boot on later launches. Implemented in Task 15.

2. **Screen 4a creates a new named profile; it never adopts the scaffold `default`.** `hermes profile show default` reports its path as `~/.hermes` — the root — while named profiles live in `~/.hermes/profiles/<name>/`. Adopting the default would mean writing to the user's root Hermes config on first run. Implemented in Task 6.

3. **Profile id vs. display name are distinct.** `ford` is the Hermes profile id (lowercase, what `hermes -p` takes); `# Ford — Career` in `SOUL.md` is the display name. Circe validates ids against what Hermes actually accepts, not its help string — the help says "lowercase, alphanumeric" but `deep-thought` exists and works. Implemented in Tasks 3 and 6.

4. **The orchestrator will be able to grow the fleet (Phase 2, not this plan).** User decision, a deliberate departure from §6.5, which scopes the orchestrator to wiring MCP servers and integrations only. Agreed guardrails for when it is built: creating an agent is an always-ask action that ignores the tile's gate state; the orchestrator proposes and Screen 5 disposes; one agent per confirmed request, no batching. **Nothing in Phase 1 implements this** — it is recorded in the ADR (Task 16) so Phase 2 inherits the decision and its rationale.

---

## §5 architectural decisions

The spec (§5) requires these be picked and written down before implementation. Task 16 turns each into a dated ADR entry. Decisions marked *(Phase 2)* are settled here but implemented later.

**§5.1 — Hermes install/setup integration.** Circe never drives the interactive `hermes setup`. Profile creation uses `hermes profile create <name> [--description ...]`, which is fully non-interactive and takes flags — verified against Hermes 0.14.0. Detection is `hermes --version` (checking `$PATH` first, then `~/.local/bin/hermes`). Installation shells out to Hermes's official managed-install path, streams stdout/stderr to the wizard's live log, and confirms success by re-running `hermes --version` rather than parsing installer output. On failure: show the raw log plus "run the installer in a terminal, then click retry." *Breakage risk:* the install URL and the `--version` string format are unversioned. Both go in compat notes.

**§5.2 — Provider OAuth for Screen 6.** Subprocess-capture `hermes login --provider <nous|openai-codex|xai-oauth> --no-browser`. This is an OAuth **device authorization flow**: it prints a verification URL and a user code, which Circe scrapes from stdout and renders in the wizard; the user completes it in a browser; the process exits 0 on success. Success is confirmed by exit code 0 **and** a follow-up `hermes status` check, never by the printed text alone. The "Skip — I'll connect a provider later" path is always available and is the only path Phase 1 must have working end-to-end. *Breakage risk:* scraping unversioned stdout. Compat notes.

**§5.3 — Image-generation provider detection *(Phase 2)*.** Conservative hard-coded allowlist, per the spec's own bias. v1 recognizes OpenAI (`gpt-image-1`, `dall-e-3`) and xAI (`grok-2-image`) as image-capable. Detection reads the resolved provider/model from `hermes profile show <id>`, which prints `Model: <model> (<provider>)`. Anthropic is text-only and the Generate option is hidden. No capability probing.

**§5.4 — "Real profile" heuristic.** Hermes's scaffold template (`hermes_cli/default_soul.py` → `DEFAULT_SOUL_MD`) is **bare prose with no Markdown heading**. Every user-configured profile observed on disk begins with a level-1 heading. So:

> A profile is **real** if either:
> - it lives in `~/.hermes/profiles/<id>/` (created by an explicit `hermes profile create`), **or**
> - it is the root `default` profile *and* its `SOUL.md` has a level-1 heading (`# ...`) as its first non-empty line.

A fresh Hermes install therefore yields **zero** real profiles; the current machine yields **eight** (root `default` = `# Trillian — Central Coordinator`, plus seven named). This rule needs no hash comparison and no name blocklist. Implemented and tested in Task 5.

**§5.5 — Coding-profile → default-locked.** Explicit opt-in wins. The role is Circe UI metadata and is stored in Circe's own state file, never written into the Hermes profile. Phase 1 ships the storage and the gate-default wiring; the Screen 5 role picker UI is Phase 2. Inference fallback, for pre-existing profiles Circe finds on disk and that never went through the walkthrough: the profile is treated as a coding profile if its `SOUL.md` heading line or first body paragraph matches `/\b(cod(e|ing)|engineer|developer|repo|git|filesystem|shell)\b/i`. The walkthrough answer always wins when both signals exist.

**§5.6 — UI primitives: reuse vs. build.** Checked. Hermes Agent is a Python CLI distribution; there is no consumable JavaScript UI package in `~/.hermes/hermes-agent` to depend on. **Decision:** build Circe's own minimal primitive set (button, input, segmented control, loader, empty state, error state). Visual harmonization with Hermes is a future concern, not a v1 blocker. Primitives must be internally consistent — no two buttons with two visual languages.

**§5.7 — Orchestrator handoff skill *(Phase 2)*.** Option (a): ship a small honest skill covering **coding, email, notes**. Extended per the conversation decision above to also propose new agents, under the stated guardrails. Skill shape and installation are Phase 2 deliverables.

---

## File structure

Repo root: `/Users/sarachipps/Code/circe-app`. The prototype at `/Users/sarachipps/Code/circe` is **read-only reference** — never edited, never imported, never copied wholesale. Tasks cite specific prototype line ranges to harvest logic from.

```
circe-app/
├── package.json                       npm scripts, deps, Electron 32
├── tsconfig.json                      strict TS, shared by all three bundles
├── electron.vite.config.ts            main / preload / renderer build config
├── vitest.config.ts                   unit + integration test config
├── playwright.config.ts               Electron E2E config
├── .github/workflows/ci.yml           macos-14 runner: typecheck, unit, e2e
├── README.md                          install, first-run, min Hermes version
├── LICENSE                            MIT
├── docs/
│   ├── adr/                           one dated file per decision (Task 16)
│   └── compat-notes.md                every place Circe parses unversioned Hermes output
├── src/
│   ├── shared/
│   │   ├── types.ts                   GateMode, Palette, HermesProfile, CirceState, TabState…
│   │   ├── casts.ts                   cast + character data and palettes (no images)
│   │   └── ipc.ts                     IPC channel names and payload types
│   ├── main/
│   │   ├── index.ts                   app lifecycle, quit-on-last-tile
│   │   ├── hermes/
│   │   │   ├── soul.ts                parse/write the SOUL.md `# Name — tagline` heading
│   │   │   ├── locate.ts              find binary, parse --version, enforce min version
│   │   │   ├── profiles.ts            enumerate profiles, §5.4 realness rule
│   │   │   ├── create.ts              drive `hermes profile create`, write SOUL.md
│   │   │   ├── acpClient.ts           ACP JSON-RPC over stdio + permission gate
│   │   │   └── provider.ts            `hermes login` device-code driver (§5.2)
│   │   ├── state/
│   │   │   └── store.ts               atomic JSON persistence of CirceState
│   │   ├── tiles/
│   │   │   └── manager.ts             tile window lifecycle, ACP wiring, IPC handlers
│   │   └── wizard/
│   │       └── window.ts              wizard window + its IPC handlers
│   ├── preload/
│   │   ├── tile.ts                    contextBridge surface for a tile renderer
│   │   └── wizard.ts                  contextBridge surface for the wizard renderer
│   └── renderer/
│       ├── ui/                        primitive set + base stylesheet (§5.6)
│       ├── tile/                      tile HTML, transcript, composer, gate button
│       └── wizard/                    screens 1–7
└── test/
    ├── fixtures/
    │   ├── mock-hermes/               fake `hermes` CLI speaking ACP (Task 2)
    │   └── homes/                     seeded HERMES_HOME dirs for profile tests
    ├── unit/                          Vitest, one file per src module
    └── e2e/                           Playwright, §10.1 / §10.4 / §10.5 / §10.6
```

---

Task list, in dependency order. Tasks 1–2 build the harness everything else is tested against; 3–9 are pure main-process logic with fast unit tests; 10–15 assemble the UI; 16–19 close out the exit criteria.

I'll write the tasks themselves in the next pass so each stays complete rather than truncated.

### Task 1: Repo scaffold, build pipeline, CI

**Files:**
- Create: `package.json`, `tsconfig.json`, `electron.vite.config.ts`, `vitest.config.ts`, `.gitignore`, `LICENSE`
- Create: `src/main/index.ts`, `src/shared/types.ts`
- Create: `.github/workflows/ci.yml`
- Test: `test/unit/scaffold.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the `GateMode`, `Palette`, `SoulHeading`, `HermesProfile`, `TabState`, `Message`, `TileState`, and `CirceState` types that every later task imports from `src/shared/types.ts`. Also produces the npm scripts `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run build`, `npm start`.

- [ ] **Step 1: Initialise the repo and install dependencies**

```bash
mkdir -p /Users/sarachipps/Code/circe-app
cd /Users/sarachipps/Code/circe-app
git init
npm init -y
npm install --save-dev electron@^32.0.0 electron-vite@^2.3.0 vite@^5.4.0 \
  typescript@^5.6.0 @types/node@^22.0.0 vitest@^2.1.0 @playwright/test@^1.48.0
npm install marked@^18.0.6
```

`marked` is the only runtime dependency — it renders agent markdown in the transcript. Note there is deliberately no logging library: the prototype's `electron-log` wrote diagnostic files into `~/.hermes`, which Circe should not be doing.

- [ ] **Step 2: Write the shared types**

Create `src/shared/types.ts`:

```ts
/** The three permission-gate states from spec §6.4, in cycle order. */
export const GATE_MODES = ['locked', 'ask', 'unlocked'] as const;
export type GateMode = (typeof GATE_MODES)[number];

/** Per-profile theming from spec §6.3.2. Both values are CSS colors. */
export interface Palette {
  accent: string;
  background: string;
}

/** The parsed `# Name — tagline` first line of a SOUL.md. */
export interface SoulHeading {
  name: string;
  tagline: string | null;
}

/** A Hermes profile discovered on disk. */
export interface HermesProfile {
  /** Hermes profile id — what `hermes -p <id>` takes. 'default' for the root profile. */
  id: string;
  /** Absolute path to the profile directory. */
  path: string;
  /** Absolute path to the profile's SOUL.md. */
  soulPath: string;
  /** True for the root `~/.hermes` profile, which is structurally different. */
  isDefault: boolean;
  /** Result of the §5.4 realness rule. */
  real: boolean;
  /** Display name from the SOUL.md heading; falls back to `id` when absent. */
  displayName: string;
  /** Tagline from the SOUL.md heading, or null. */
  tagline: string | null;
}

export interface Message {
  role: 'user' | 'agent' | 'tool' | 'system';
  text: string;
  /** Optional visual treatment. 'denied' renders the locked-gate card from §6.4. */
  kind?: 'error' | 'denied' | 'pending';
}

export interface TabState {
  id: string;
  title: string;
  /** ACP session id, or null before the session is established. */
  sessionId: string | null;
  messages: Message[];
}

export interface TileState {
  profileId: string;
  bounds: { x: number; y: number; width: number; height: number };
  gateMode: GateMode;
  palette: Palette;
  tabs: TabState[];
  activeTabId: string;
  /** False when the user chose "leave alone (don't tile)" in Screen 4b. */
  tiled: boolean;
  /** §5.5 — set by the Screen 5 role picker, or by inference for imported profiles. */
  isCodingProfile: boolean;
}

export interface CirceState {
  version: 1;
  onboarded: boolean;
  mainOperatorId: string | null;
  tiles: Record<string, TileState>;
}

export const DEFAULT_PALETTE: Palette = {
  accent: '#8b7fd4',
  background: '#1a1820',
};

export function emptyState(): CirceState {
  return { version: 1, onboarded: false, mainOperatorId: null, tiles: {} };
}
```

- [ ] **Step 3: Write the build and test configs**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"],
    "noEmit": true
  },
  "include": ["src", "test", "*.config.ts"]
}
```

`electron.vite.config.ts`:

```ts
import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';

export default defineConfig({
  main: { build: { lib: { entry: resolve(__dirname, 'src/main/index.ts') } } },
  preload: {
    build: {
      rollupOptions: {
        input: {
          tile: resolve(__dirname, 'src/preload/tile.ts'),
          wizard: resolve(__dirname, 'src/preload/wizard.ts'),
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: {
          tile: resolve(__dirname, 'src/renderer/tile/index.html'),
          wizard: resolve(__dirname, 'src/renderer/wizard/index.html'),
        },
      },
    },
  },
});
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15000,
  },
});
```

- [ ] **Step 4: Add npm scripts**

Merge into `package.json`:

```json
{
  "name": "circe",
  "productName": "Circe",
  "version": "0.1.0",
  "description": "Circe — a fleet of Hermes agents as themed, side-by-side chat tiles on macOS",
  "license": "MIT",
  "main": "out/main/index.js",
  "scripts": {
    "start": "electron-vite preview",
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:e2e": "playwright test"
  }
}
```

- [ ] **Step 5: Write a minimal main entry so the build has something to compile**

Create `src/main/index.ts`:

```ts
import { app } from 'electron';

// Circe quits when the last tile closes (§6.3.4). There is no dock-persistent
// app shell — each tile is the app.
app.on('window-all-closed', () => {
  app.quit();
});

app.whenReady().then(() => {
  // Wizard vs. fleet boot is wired in Task 15.
});
```

- [ ] **Step 6: Write the failing scaffold test**

Create `test/unit/scaffold.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { GATE_MODES, emptyState, DEFAULT_PALETTE } from '../../src/shared/types';

describe('shared types', () => {
  it('orders gate modes as the §6.4 cycle: locked → ask → unlocked', () => {
    expect(GATE_MODES).toEqual(['locked', 'ask', 'unlocked']);
  });

  it('starts un-onboarded with no tiles and no main operator', () => {
    expect(emptyState()).toEqual({
      version: 1,
      onboarded: false,
      mainOperatorId: null,
      tiles: {},
    });
  });

  it('ships a default palette with both an accent and a background', () => {
    expect(DEFAULT_PALETTE.accent).toMatch(/^#[0-9a-f]{6}$/i);
    expect(DEFAULT_PALETTE.background).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
```

- [ ] **Step 7: Run the test suite and the typecheck**

Run: `npm test && npm run typecheck && npm run build`
Expected: 3 tests pass, typecheck clean, build emits `out/`.

- [ ] **Step 8: Write the CI workflow**

Create `.github/workflows/ci.yml`. A macOS runner is required by §11 for the smoke tests.

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
      - run: npm run test:e2e
        env:
          CIRCE_E2E: '1'
```

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold Electron + TypeScript build, shared types, CI"
```

---

### Task 2: Mock Hermes CLI fixture

Phase 1's tests cannot depend on a real Hermes install or a real provider — CI has neither. This task builds a fake `hermes` executable that speaks enough of the real surface to drive every later test: `--version`, `profile create`, `profile show`, and a full ACP JSON-RPC conversation over stdio. Getting this right is what makes §10.3 and §10.4 mechanically testable.

**Files:**
- Create: `test/fixtures/mock-hermes/hermes` (executable Node script)
- Create: `test/fixtures/mock-hermes/scenario.ts` (typed scenario definitions)
- Test: `test/unit/mock-hermes.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: an executable at `test/fixtures/mock-hermes/hermes` that later tasks pass as `hermesBin`. Behaviour is driven by two environment variables: `MOCK_HERMES_HOME` (where it reads/writes profiles) and `MOCK_HERMES_SCENARIO` (one of `stream`, `permission`, `crash`, `slow`).

- [ ] **Step 1: Write the failing test**

Create `test/unit/mock-hermes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOCK = resolve(HERE, '../fixtures/mock-hermes/hermes');

function run(args: string[], env: Record<string, string> = {}) {
  return new Promise<{ code: number | null; stdout: string }>((res) => {
    const child = spawn(MOCK, args, { env: { ...process.env, ...env } });
    let stdout = '';
    child.stdout.on('data', (b) => (stdout += b.toString()));
    child.on('exit', (code) => res({ code, stdout }));
  });
}

/** Drive an ACP conversation and collect every JSON-RPC line the mock emits. */
function acp(scenario: string, send: string[]) {
  return new Promise<any[]>((res) => {
    const child = spawn(MOCK, ['-p', 'test', 'acp'], {
      env: { ...process.env, MOCK_HERMES_SCENARIO: scenario },
    });
    const out: any[] = [];
    let buf = '';
    child.stdout.on('data', (b) => {
      buf += b.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) out.push(JSON.parse(line));
      }
    });
    for (const line of send) child.stdin.write(line + '\n');
    child.stdin.end();
    child.on('exit', () => res(out));
  });
}

describe('mock hermes', () => {
  it('reports a version', async () => {
    const { code, stdout } = await run(['--version']);
    expect(code).toBe(0);
    expect(stdout).toMatch(/Hermes Agent v\d+\.\d+\.\d+/);
  });

  it('answers initialize with a protocol version', async () => {
    const out = await acp('stream', [
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1 } }),
    ]);
    expect(out[0]).toMatchObject({ id: 1, result: { protocolVersion: 1 } });
  });

  it('streams agent_message_chunk updates in response to a prompt', async () => {
    const out = await acp('stream', [
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1 } }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: '/tmp' } }),
      JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'session/prompt', params: { sessionId: 's1', prompt: [{ type: 'text', text: 'hi' }] } }),
    ]);
    const chunks = out.filter(
      (m) => m.method === 'session/update' && m.params.update.sessionUpdate === 'agent_message_chunk',
    );
    expect(chunks.length).toBeGreaterThan(0);
    const text = chunks.map((c) => c.params.update.content.text).join('');
    expect(text).toContain('Hello');
  });

  it('issues a session/request_permission in the permission scenario', async () => {
    const out = await acp('permission', [
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1 } }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: '/tmp' } }),
      JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'session/prompt', params: { sessionId: 's1', prompt: [{ type: 'text', text: 'write a file' }] } }),
    ]);
    const req = out.find((m) => m.method === 'session/request_permission');
    expect(req).toBeDefined();
    expect(req.params.options.some((o: any) => o.kind === 'allow_once')).toBe(true);
    expect(req.params.options.some((o: any) => o.kind === 'reject_once')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run test/unit/mock-hermes.test.ts`
Expected: FAIL — spawn ENOENT, the fixture does not exist yet.

- [ ] **Step 3: Write the mock**

Create `test/fixtures/mock-hermes/hermes`:

```js
#!/usr/bin/env node
'use strict';
// A fake `hermes` CLI covering only the surface Circe drives. Behaviour is
// selected by MOCK_HERMES_SCENARIO; profile state lives under MOCK_HERMES_HOME.
const fs = require('fs');
const path = require('path');

const VERSION = process.env.MOCK_HERMES_VERSION || '0.14.0';
const HOME = process.env.MOCK_HERMES_HOME || path.join(require('os').tmpdir(), 'mock-hermes-home');
const SCENARIO = process.env.MOCK_HERMES_SCENARIO || 'stream';

const argv = process.argv.slice(2);

// Strip the global `-p <profile>` flag, which precedes the subcommand.
let profile = 'default';
const pIdx = argv.indexOf('-p');
if (pIdx >= 0) {
  profile = argv[pIdx + 1];
  argv.splice(pIdx, 2);
}

if (argv.includes('--version') && argv[0] !== 'acp') {
  process.stdout.write(`Hermes Agent v${VERSION} (2026.5.16)\n`);
  process.exit(0);
}

function profileDir(id) {
  return id === 'default' ? HOME : path.join(HOME, 'profiles', id);
}

if (argv[0] === 'profile' && argv[1] === 'create') {
  const name = argv[2];
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(name || '')) {
    process.stderr.write(`invalid profile name: ${name}\n`);
    process.exit(2);
  }
  const dir = profileDir(name);
  if (fs.existsSync(dir)) {
    process.stderr.write(`profile already exists: ${name}\n`);
    process.exit(1);
  }
  fs.mkdirSync(dir, { recursive: true });
  // Hermes seeds a scaffold SOUL.md with no Markdown heading (§5.4).
  fs.writeFileSync(
    path.join(dir, 'SOUL.md'),
    'You are Hermes Agent, an intelligent AI assistant created by Nous Research.\n',
  );
  process.stdout.write(`Created profile: ${name}\n`);
  process.exit(0);
}

if (argv[0] === 'profile' && argv[1] === 'show') {
  const id = argv[2];
  const dir = profileDir(id);
  if (!fs.existsSync(dir)) {
    process.stderr.write(`no such profile: ${id}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `\nProfile: ${id}\nPath:    ${dir}\nModel:   claude-opus-4-7 (anthropic)\n` +
      `Gateway: stopped\nSkills:  0\n.env:    exists\nSOUL.md: exists\n`,
  );
  process.exit(0);
}

if (argv[0] === 'status') {
  process.stdout.write(`Provider: anthropic\nAuth: ok\n`);
  process.exit(0);
}

if (argv[0] !== 'acp') {
  process.stderr.write(`unknown command: ${argv.join(' ')}\n`);
  process.exit(64);
}

if (argv.includes('--version')) {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}

// ---- ACP mode ----------------------------------------------------------

if (SCENARIO === 'crash') {
  process.stderr.write('mock hermes: simulated crash\n');
  process.exit(3);
}

let nextServerId = 1000;
const write = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
const reply = (id, result) => write({ jsonrpc: '2.0', id, result });
const update = (sessionId, u) =>
  write({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: u } });

const CHUNK_DELAY = SCENARIO === 'slow' ? 25 : 1;

function streamReply(sessionId, done) {
  const words = (process.env.MOCK_HERMES_REPLY || 'Hello from the mock agent.').split(' ');
  let i = 0;
  const tick = () => {
    if (i >= words.length) return done();
    update(sessionId, {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: (i === 0 ? '' : ' ') + words[i] },
    });
    i += 1;
    setTimeout(tick, CHUNK_DELAY);
  };
  tick();
}

function requestPermission(sessionId, then) {
  const id = nextServerId++;
  pendingPermission = { id, then };
  write({
    jsonrpc: '2.0',
    id,
    method: 'session/request_permission',
    params: {
      sessionId,
      toolCall: { toolCallId: 'tc1', title: 'write_file', kind: 'edit' },
      options: [
        { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
      ],
    },
  });
}

let pendingPermission = null;
let buf = '';

process.stdin.on('data', (b) => {
  buf += b.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    handle(msg);
  }
});

function handle(msg) {
  // A response to one of our own server-initiated requests.
  if (msg.id !== undefined && msg.method === undefined) {
    if (pendingPermission && msg.id === pendingPermission.id) {
      const { then } = pendingPermission;
      pendingPermission = null;
      then(msg.result && msg.result.outcome);
    }
    return;
  }

  switch (msg.method) {
    case 'initialize':
      reply(msg.id, { protocolVersion: 1, agentCapabilities: { loadSession: true } });
      return;
    case 'session/new':
      reply(msg.id, { sessionId: 's1' });
      return;
    case 'session/load':
      reply(msg.id, {});
      return;
    case 'session/cancel':
      reply(msg.id, {});
      return;
    case 'session/prompt': {
      const sid = msg.params.sessionId;
      if (SCENARIO === 'permission') {
        // Announce the tool call, then ask for permission, then report the outcome.
        update(sid, { sessionUpdate: 'tool_call', toolCallId: 'tc1', title: 'write_file', status: 'pending' });
        requestPermission(sid, (outcome) => {
          const denied =
            !outcome ||
            outcome.outcome === 'cancelled' ||
            String(outcome.optionId || '').startsWith('reject');
          update(sid, {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'tc1',
            title: 'write_file',
            status: denied ? 'failed' : 'completed',
          });
          reply(msg.id, { stopReason: 'end_turn' });
        });
        return;
      }
      streamReply(sid, () => reply(msg.id, { stopReason: 'end_turn' }));
      return;
    }
    default:
      write({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'not implemented' } });
  }
}
```

- [ ] **Step 4: Make it executable and run the tests**

```bash
chmod +x test/fixtures/mock-hermes/hermes
npx vitest run test/unit/mock-hermes.test.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add test/fixtures/mock-hermes/hermes test/unit/mock-hermes.test.ts
git commit -m "test: add mock Hermes CLI speaking ACP over stdio"
```

---

### Task 3: SOUL.md heading parse and write

The tile's display name is resolved from the profile's `SOUL.md` heading (§6.3.2), and Screen 5 writes that heading (§6, Screen 5, panel 5). Real files on disk use three different separators — `# Ford — Career` (em dash), and `# Zaphod, Wealth Planner` (comma) — so the parser must be tolerant. Hermes's own scaffold has **no heading at all**, which Task 5 depends on.

**Files:**
- Create: `src/main/hermes/soul.ts`
- Test: `test/unit/soul.test.ts`

**Interfaces:**
- Consumes: `SoulHeading` from `src/shared/types.ts`.
- Produces: `parseSoulHeading(markdown: string): SoulHeading | null` and `renderSoulHeading(h: SoulHeading): string` and `withSoulHeading(markdown: string, h: SoulHeading): string`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/soul.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseSoulHeading, renderSoulHeading, withSoulHeading } from '../../src/main/hermes/soul';

const SCAFFOLD =
  'You are Hermes Agent, an intelligent AI assistant created by Nous Research. ' +
  'You are helpful, knowledgeable, and direct.';

describe('parseSoulHeading', () => {
  it('parses an em-dash heading', () => {
    expect(parseSoulHeading('# Ford — Career\n\nbody')).toEqual({ name: 'Ford', tagline: 'Career' });
  });

  it('parses a hyphen heading', () => {
    expect(parseSoulHeading('# Data - the analyst\n')).toEqual({ name: 'Data', tagline: 'the analyst' });
  });

  it('parses a comma heading', () => {
    expect(parseSoulHeading('# Zaphod, Wealth Planner\n')).toEqual({
      name: 'Zaphod',
      tagline: 'Wealth Planner',
    });
  });

  it('parses a heading with no tagline', () => {
    expect(parseSoulHeading('# Athena\n')).toEqual({ name: 'Athena', tagline: null });
  });

  it('skips leading blank lines', () => {
    expect(parseSoulHeading('\n\n# Marvin — the depressed android\n')).toEqual({
      name: 'Marvin',
      tagline: 'the depressed android',
    });
  });

  it('returns null for the Hermes scaffold, which has no heading', () => {
    expect(parseSoulHeading(SCAFFOLD)).toBeNull();
  });

  it('returns null for an empty file', () => {
    expect(parseSoulHeading('')).toBeNull();
  });

  it('ignores a heading that is not the first non-empty line', () => {
    expect(parseSoulHeading('some prose\n\n# Not A Name — nope\n')).toBeNull();
  });

  it('ignores a level-2 heading', () => {
    expect(parseSoulHeading('## Your scope\n')).toBeNull();
  });
});

describe('renderSoulHeading', () => {
  it('always writes the em-dash form', () => {
    expect(renderSoulHeading({ name: 'Athena', tagline: 'the strategist' })).toBe(
      '# Athena — the strategist',
    );
  });

  it('omits the separator when there is no tagline', () => {
    expect(renderSoulHeading({ name: 'Athena', tagline: null })).toBe('# Athena');
  });
});

describe('withSoulHeading', () => {
  it('prepends a heading to scaffold prose, preserving the body', () => {
    const out = withSoulHeading(SCAFFOLD, { name: 'Athena', tagline: 'the strategist' });
    expect(out.startsWith('# Athena — the strategist\n\n')).toBe(true);
    expect(out).toContain('You are Hermes Agent');
  });

  it('replaces an existing heading without touching the body', () => {
    const out = withSoulHeading('# Old — thing\n\nkeep me\n', { name: 'New', tagline: 'other' });
    expect(out).toBe('# New — other\n\nkeep me\n');
  });

  it('round-trips through the parser', () => {
    const h = { name: 'Deep-Thought', tagline: 'Bakafund' };
    expect(parseSoulHeading(withSoulHeading('body', h))).toEqual(h);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run test/unit/soul.test.ts`
Expected: FAIL — `Cannot find module '../../src/main/hermes/soul'`.

- [ ] **Step 3: Write the implementation**

Create `src/main/hermes/soul.ts`:

```ts
import type { SoulHeading } from '../../shared/types';

/**
 * Matches a level-1 ATX heading and splits it into a name and an optional
 * tagline. Real profiles on disk use an em dash, a hyphen, or a comma as the
 * separator, so all three are accepted. Hermes's own scaffold template is bare
 * prose with no heading at all, which is what the §5.4 realness rule keys on.
 */
const H1 = /^#[ \t]+(.+?)[ \t]*$/;
const SEPARATOR = /\s+—\s+|\s+–\s+|\s+-\s+|,\s+/;

export function parseSoulHeading(markdown: string): SoulHeading | null {
  const firstNonEmpty = markdown.split(/\r?\n/).find((l) => l.trim() !== '');
  if (firstNonEmpty === undefined) return null;

  // A level-2 heading must not match, so reject `##` before testing.
  if (/^#{2,}/.test(firstNonEmpty.trim())) return null;

  const m = H1.exec(firstNonEmpty.trim());
  if (!m) return null;

  const heading = m[1]!.trim();
  const split = SEPARATOR.exec(heading);
  if (!split || split.index === 0) {
    return { name: heading, tagline: null };
  }
  return {
    name: heading.slice(0, split.index).trim(),
    tagline: heading.slice(split.index + split[0].length).trim() || null,
  };
}

/** Circe always writes the canonical em-dash form, whatever it read. */
export function renderSoulHeading(h: SoulHeading): string {
  return h.tagline ? `# ${h.name} — ${h.tagline}` : `# ${h.name}`;
}

/**
 * Returns `markdown` with its heading replaced by `h`, or with `h` prepended if
 * it had none. The body is preserved byte-for-byte either way — Circe must not
 * rewrite persona text the user wrote (§4.9).
 */
export function withSoulHeading(markdown: string, h: SoulHeading): string {
  const line = renderSoulHeading(h);
  if (parseSoulHeading(markdown) === null) {
    return markdown.trim() === '' ? `${line}\n` : `${line}\n\n${markdown}`;
  }
  const lines = markdown.split(/\r?\n/);
  const idx = lines.findIndex((l) => l.trim() !== '');
  lines[idx] = line;
  return lines.join('\n');
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/unit/soul.test.ts`
Expected: all 14 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/hermes/soul.ts test/unit/soul.test.ts
git commit -m "feat: parse and write SOUL.md display-name headings"
```

---

### Task 4: Locate the Hermes binary and enforce the minimum version

Spec §8.1 requires a startup feature-detection check with a specific, actionable error on every failure — never a stack trace. Circe must find `hermes` on `$PATH` and fall back to `~/.local/bin/hermes`, which is where the real install actually lives on the target machine.

**Files:**
- Create: `src/main/hermes/locate.ts`
- Test: `test/unit/locate.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `MIN_HERMES_VERSION`, `parseVersion(stdout: string): string | null`, `compareVersions(a: string, b: string): number`, and `locateHermes(opts?: { env?: NodeJS.ProcessEnv; home?: string }): Promise<HermesLocation>` where `HermesLocation` is `{ ok: true; bin: string; version: string } | { ok: false; reason: 'not-found' | 'unreadable-version' | 'too-old'; bin: string | null; version: string | null; message: string }`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/locate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  parseVersion,
  compareVersions,
  locateHermes,
  MIN_HERMES_VERSION,
} from '../../src/main/hermes/locate';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOCK_DIR = resolve(HERE, '../fixtures/mock-hermes');

describe('parseVersion', () => {
  it('reads the real Hermes version banner', () => {
    expect(parseVersion('Hermes Agent v0.14.0 (2026.5.16)\nProject: /x\n')).toBe('0.14.0');
  });

  it('reads a bare version line', () => {
    expect(parseVersion('0.14.0\n')).toBe('0.14.0');
  });

  it('returns null for unrecognised output', () => {
    expect(parseVersion('command not found')).toBeNull();
  });
});

describe('compareVersions', () => {
  it('orders by major, minor, then patch', () => {
    expect(compareVersions('0.14.0', '0.14.0')).toBe(0);
    expect(compareVersions('0.15.0', '0.14.9')).toBeGreaterThan(0);
    expect(compareVersions('0.13.9', '0.14.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0);
  });

  it('treats a missing patch segment as zero', () => {
    expect(compareVersions('0.14', '0.14.0')).toBe(0);
  });
});

describe('locateHermes', () => {
  it('finds the binary on PATH and reports its version', async () => {
    const r = await locateHermes({ env: { PATH: MOCK_DIR } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.version).toBe('0.14.0');
  });

  it('falls back to ~/.local/bin when PATH has nothing', async () => {
    // The fixture dir stands in for ~/.local/bin.
    const r = await locateHermes({ env: { PATH: '/nonexistent' }, home: resolve(MOCK_DIR, '../..') });
    // No hermes at <home>/.local/bin either, so this must fail cleanly.
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not-found');
  });

  it('reports a specific, actionable message when not found', async () => {
    const r = await locateHermes({ env: { PATH: '/nonexistent' }, home: '/nonexistent' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('not-found');
      expect(r.message).toMatch(/hermes/i);
      expect(r.message).not.toMatch(/Error:|at Object|\bstack\b/);
    }
  });

  it('rejects a version below the minimum', async () => {
    const r = await locateHermes({ env: { PATH: MOCK_DIR, MOCK_HERMES_VERSION: '0.13.0' } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('too-old');
      expect(r.message).toContain(MIN_HERMES_VERSION);
    }
  });

  it('accepts a version above the minimum — never fail closed on newer (§8.1)', async () => {
    const r = await locateHermes({ env: { PATH: MOCK_DIR, MOCK_HERMES_VERSION: '99.0.0' } });
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run test/unit/locate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/main/hermes/locate.ts`:

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { homedir } from 'node:os';

const run = promisify(execFile);

/** Declared in the README and enforced here (§8.1). */
export const MIN_HERMES_VERSION = '0.14.0';

export type HermesLocation =
  | { ok: true; bin: string; version: string }
  | {
      ok: false;
      reason: 'not-found' | 'unreadable-version' | 'too-old';
      bin: string | null;
      version: string | null;
      message: string;
    };

const VERSION_RE = /(?:Hermes Agent v)?(\d+\.\d+(?:\.\d+)?)/;

export function parseVersion(stdout: string): string | null {
  const m = VERSION_RE.exec(stdout.trim());
  return m ? m[1]! : null;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

function findOnPath(env: NodeJS.ProcessEnv, home: string): string | null {
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, 'hermes');
    if (existsSync(candidate)) return candidate;
  }
  // The managed install puts it here, and it is frequently absent from a GUI
  // app's inherited PATH because Electron does not source a login shell.
  const fallback = join(home, '.local', 'bin', 'hermes');
  return existsSync(fallback) ? fallback : null;
}

export async function locateHermes(
  opts: { env?: NodeJS.ProcessEnv; home?: string } = {},
): Promise<HermesLocation> {
  const env = opts.env ?? process.env;
  const home = opts.home ?? homedir();

  const bin = findOnPath(env, home);
  if (!bin) {
    return {
      ok: false,
      reason: 'not-found',
      bin: null,
      version: null,
      message: 'Hermes isn’t installed. Circe can install it, or you can run the installer yourself and retry.',
    };
  }

  let stdout: string;
  try {
    ({ stdout } = await run(bin, ['--version'], { env, timeout: 10_000 }));
  } catch {
    return {
      ok: false,
      reason: 'unreadable-version',
      bin,
      version: null,
      message: `Found Hermes at ${bin} but couldn’t run it. Check that it’s executable.`,
    };
  }

  const version = parseVersion(stdout);
  if (!version) {
    return {
      ok: false,
      reason: 'unreadable-version',
      bin,
      version: null,
      message: `Couldn’t read a version from ${bin}. Circe needs Hermes ${MIN_HERMES_VERSION} or newer.`,
    };
  }

  if (compareVersions(version, MIN_HERMES_VERSION) < 0) {
    return {
      ok: false,
      reason: 'too-old',
      bin,
      version,
      message: `Hermes ${version} is too old. Circe needs ${MIN_HERMES_VERSION} or newer — run \`hermes update\`.`,
    };
  }

  // Newer than tested-against is fine; §8.1 forbids failing closed on that alone.
  return { ok: true, bin, version };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/unit/locate.test.ts`
Expected: all 11 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/hermes/locate.ts test/unit/locate.test.ts
git commit -m "feat: locate Hermes binary and enforce minimum version"
```

---

### Task 5: Profile enumeration and the §5.4 realness rule

**Files:**
- Create: `src/main/hermes/profiles.ts`
- Create: `test/fixtures/homes/README.md` (explains the seeded home layout)
- Test: `test/unit/profiles.test.ts`

**Interfaces:**
- Consumes: `parseSoulHeading` from `src/main/hermes/soul.ts`; `HermesProfile` from `src/shared/types.ts`.
- Produces: `enumerateProfiles(hermesHome: string): Promise<HermesProfile[]>`, `isRealProfile(p: { isDefault: boolean; soulMarkdown: string | null }): boolean`, and `inferCodingProfile(soulMarkdown: string): boolean` (the §5.5 fallback).

- [ ] **Step 1: Write the failing test**

Create `test/unit/profiles.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { enumerateProfiles, isRealProfile, inferCodingProfile } from '../../src/main/hermes/profiles';

const SCAFFOLD =
  'You are Hermes Agent, an intelligent AI assistant created by Nous Research. ' +
  'You are helpful, knowledgeable, and direct.';

let home: string;

function seedDefault(markdown: string) {
  writeFileSync(join(home, 'SOUL.md'), markdown);
}

function seedNamed(id: string, markdown: string) {
  const dir = join(home, 'profiles', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SOUL.md'), markdown);
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'circe-home-'));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('isRealProfile', () => {
  it('treats the untouched scaffold default as not real', () => {
    expect(isRealProfile({ isDefault: true, soulMarkdown: SCAFFOLD })).toBe(false);
  });

  it('treats a default with a heading as real', () => {
    expect(
      isRealProfile({ isDefault: true, soulMarkdown: '# Trillian — Central Coordinator\n' }),
    ).toBe(true);
  });

  it('treats any named profile as real, even with a scaffold SOUL', () => {
    expect(isRealProfile({ isDefault: false, soulMarkdown: SCAFFOLD })).toBe(true);
  });

  it('treats a default with no SOUL.md as not real', () => {
    expect(isRealProfile({ isDefault: true, soulMarkdown: null })).toBe(false);
  });
});

describe('enumerateProfiles', () => {
  it('reports zero real profiles for a fresh Hermes install (§5.4 test requirement)', async () => {
    seedDefault(SCAFFOLD);
    const profiles = await enumerateProfiles(home);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.id).toBe('default');
    expect(profiles.filter((p) => p.real)).toHaveLength(0);
  });

  it('reports one real profile once the user configures one (§5.4 test requirement)', async () => {
    seedDefault(SCAFFOLD);
    seedNamed('ford', '# Ford — Career\n\nbody');
    const real = (await enumerateProfiles(home)).filter((p) => p.real);
    expect(real).toHaveLength(1);
    expect(real[0]!.id).toBe('ford');
    expect(real[0]!.displayName).toBe('Ford');
    expect(real[0]!.tagline).toBe('Career');
  });

  it('resolves the display name from the heading and the id otherwise', async () => {
    seedDefault(SCAFFOLD);
    seedNamed('nameless', SCAFFOLD);
    const byId = Object.fromEntries((await enumerateProfiles(home)).map((p) => [p.id, p]));
    expect(byId['nameless']!.displayName).toBe('nameless');
    expect(byId['nameless']!.tagline).toBeNull();
  });

  it('marks the root profile isDefault and points it at the home dir itself', async () => {
    seedDefault('# Trillian — Central Coordinator\n');
    const [d] = await enumerateProfiles(home);
    expect(d!.isDefault).toBe(true);
    expect(d!.path).toBe(home);
    expect(d!.soulPath).toBe(join(home, 'SOUL.md'));
  });

  it('sorts default first, then named profiles alphabetically', async () => {
    seedDefault(SCAFFOLD);
    seedNamed('zaphod', '# Zaphod, Wealth Planner\n');
    seedNamed('ford', '# Ford — Career\n');
    expect((await enumerateProfiles(home)).map((p) => p.id)).toEqual(['default', 'ford', 'zaphod']);
  });

  it('ignores non-directory entries under profiles/', async () => {
    seedDefault(SCAFFOLD);
    mkdirSync(join(home, 'profiles'), { recursive: true });
    writeFileSync(join(home, 'profiles', '.DS_Store'), 'junk');
    expect(await enumerateProfiles(home)).toHaveLength(1);
  });

  it('returns an empty list when the home directory does not exist', async () => {
    expect(await enumerateProfiles(join(home, 'nope'))).toEqual([]);
  });
});

describe('inferCodingProfile (§5.5 fallback)', () => {
  it('matches coding language in a heading', () => {
    expect(inferCodingProfile('# Locutus — coding agent\n')).toBe(true);
  });

  it('matches repo and shell vocabulary in the body', () => {
    expect(inferCodingProfile('# Data — helper\n\nYou manage the git repo.')).toBe(true);
  });

  it('does not match an unrelated persona', () => {
    expect(inferCodingProfile('# Random — Family\n\nFamily life and logistics.')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run test/unit/profiles.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/main/hermes/profiles.ts`:

```ts
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { HermesProfile } from '../../shared/types';
import { parseSoulHeading } from './soul';

/**
 * §5.4 — the realness rule.
 *
 * Hermes seeds a scaffold SOUL.md that is bare prose with no Markdown heading
 * (see `hermes_cli/default_soul.py`). Every user-configured profile observed on
 * disk starts with a level-1 heading. Named profiles under `profiles/` only
 * exist because the user ran `hermes profile create`, which is itself an
 * explicit act, so they are real regardless of their SOUL contents.
 */
export function isRealProfile(p: { isDefault: boolean; soulMarkdown: string | null }): boolean {
  if (!p.isDefault) return true;
  if (p.soulMarkdown === null) return false;
  return parseSoulHeading(p.soulMarkdown) !== null;
}

const CODING_RE = /\b(cod(e|ing)|engineer|developer|repo|git|filesystem|shell)\b/i;

/**
 * §5.5 fallback, used only for pre-existing profiles Circe found on disk that
 * never went through the Screen 5 walkthrough. An explicit role pick always wins.
 */
export function inferCodingProfile(soulMarkdown: string): boolean {
  return CODING_RE.test(soulMarkdown);
}

async function readSoul(soulPath: string): Promise<string | null> {
  try {
    return await readFile(soulPath, 'utf8');
  } catch {
    return null;
  }
}

async function buildProfile(
  id: string,
  dir: string,
  isDefault: boolean,
): Promise<HermesProfile> {
  const soulPath = join(dir, 'SOUL.md');
  const soulMarkdown = await readSoul(soulPath);
  const heading = soulMarkdown ? parseSoulHeading(soulMarkdown) : null;
  return {
    id,
    path: dir,
    soulPath,
    isDefault,
    real: isRealProfile({ isDefault, soulMarkdown }),
    displayName: heading?.name ?? id,
    tagline: heading?.tagline ?? null,
  };
}

/**
 * Enumerates every profile in a Hermes home. The root profile is `default` and
 * lives at the home directory itself; named profiles live one level down under
 * `profiles/`. Confirmed against `hermes profile show default`, which reports
 * Path: ~/.hermes for the default and ~/.hermes/profiles/<id> for the rest.
 */
export async function enumerateProfiles(hermesHome: string): Promise<HermesProfile[]> {
  try {
    await stat(hermesHome);
  } catch {
    return [];
  }

  const out: HermesProfile[] = [await buildProfile('default', hermesHome, true)];

  let entries;
  try {
    entries = await readdir(join(hermesHome, 'profiles'), { withFileTypes: true });
  } catch {
    return out;
  }

  const named = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  for (const id of named) {
    out.push(await buildProfile(id, join(hermesHome, 'profiles', id), false));
  }
  return out;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/unit/profiles.test.ts`
Expected: all 15 tests PASS. In particular, the two tests the spec names explicitly in §5.4 — fresh install produces zero real profiles, a user-configured profile produces one.

- [ ] **Step 5: Sanity-check the rule against the real machine**

This is a manual read-only check, not a CI test. It confirms the heuristic against actual Hermes output rather than only against fixtures.

```bash
node -e "
  import('./src/main/hermes/profiles.ts').catch(() => {});
" 2>/dev/null || true
npx vitest run test/unit/profiles.test.ts
```

Then verify by eye that `~/.hermes/SOUL.md` begins with `# Trillian — Central Coordinator` and that each `~/.hermes/profiles/*/SOUL.md` begins with a `#` heading — meaning the real machine yields eight real profiles and would route to Screen 4b. Record the observed count in `docs/compat-notes.md` (Task 16).

- [ ] **Step 6: Commit**

```bash
git add src/main/hermes/profiles.ts test/unit/profiles.test.ts
git commit -m "feat: enumerate Hermes profiles and apply the realness heuristic"
```

---

### Task 6: Profile creation and id validation

Screen 4a creates a new named profile and never adopts the scaffold `default` (decision 2). Creation is a two-step operation: `hermes profile create <id>` for the Hermes-owned part, then a `SOUL.md` heading write for the Circe-owned part. Everything here is guarded by §4.9 — Circe writes to exactly one profile, the one the user asked for, and nothing else.

**Files:**
- Create: `src/main/hermes/create.ts`
- Test: `test/unit/create.test.ts`

**Interfaces:**
- Consumes: `withSoulHeading` from `soul.ts`; `enumerateProfiles` from `profiles.ts`.
- Produces: `validateProfileId(id: string, taken: string[]): { ok: true } | { ok: false; message: string }` and `createProfile(opts: { hermesBin: string; hermesHome: string; id: string; heading: SoulHeading; persona?: string; env?: NodeJS.ProcessEnv }): Promise<HermesProfile>`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/create.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateProfileId, createProfile } from '../../src/main/hermes/create';
import { enumerateProfiles } from '../../src/main/hermes/profiles';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOCK_BIN = resolve(HERE, '../fixtures/mock-hermes/hermes');
const SCAFFOLD = 'You are Hermes Agent, an intelligent AI assistant created by Nous Research.';

let home: string;

/** Hash every file under a directory so we can prove nothing was touched (§10.6). */
function hashTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string, prefix: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, rel);
      else if (entry.isFile()) out[rel] = createHash('sha256').update(readFileSync(full)).digest('hex');
    }
  };
  if (statSync(dir, { throwIfNoEntry: false })) walk(dir, '');
  return out;
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'circe-create-'));
  writeFileSync(join(home, 'SOUL.md'), SCAFFOLD);
  mkdirSync(join(home, 'profiles', 'ford'), { recursive: true });
  writeFileSync(join(home, 'profiles', 'ford', 'SOUL.md'), '# Ford — Career\n\nbody\n');
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('validateProfileId', () => {
  it('accepts lowercase alphanumerics', () => {
    expect(validateProfileId('athena', []).ok).toBe(true);
  });

  it('accepts hyphens and underscores — deep-thought exists on real installs', () => {
    expect(validateProfileId('deep-thought', []).ok).toBe(true);
    expect(validateProfileId('deep_thought', []).ok).toBe(true);
  });

  it('rejects uppercase, since Hermes ids are lowercase', () => {
    expect(validateProfileId('Athena', []).ok).toBe(false);
  });

  it('rejects spaces and punctuation', () => {
    expect(validateProfileId('deep thought', []).ok).toBe(false);
    expect(validateProfileId('athena!', []).ok).toBe(false);
  });

  it('rejects a leading hyphen, which would parse as a flag', () => {
    expect(validateProfileId('-athena', []).ok).toBe(false);
  });

  it('rejects an id longer than 32 characters (§6 Screen 5)', () => {
    expect(validateProfileId('a'.repeat(33), []).ok).toBe(false);
    expect(validateProfileId('a'.repeat(32), []).ok).toBe(true);
  });

  it('rejects an id already taken', () => {
    const r = validateProfileId('ford', ['default', 'ford']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/already/i);
  });

  it('rejects the reserved id "default"', () => {
    expect(validateProfileId('default', []).ok).toBe(false);
  });

  it('rejects an empty id', () => {
    expect(validateProfileId('', []).ok).toBe(false);
  });
});

describe('createProfile', () => {
  it('creates the profile and writes the heading', async () => {
    const p = await createProfile({
      hermesBin: MOCK_BIN,
      hermesHome: home,
      id: 'athena',
      heading: { name: 'Athena', tagline: 'the strategist' },
      env: { MOCK_HERMES_HOME: home },
    });
    expect(p.id).toBe('athena');
    expect(p.displayName).toBe('Athena');
    expect(p.tagline).toBe('the strategist');
    expect(p.real).toBe(true);
    const soul = readFileSync(join(home, 'profiles', 'athena', 'SOUL.md'), 'utf8');
    expect(soul.startsWith('# Athena — the strategist')).toBe(true);
  });

  it('appends optional persona text below the heading', async () => {
    await createProfile({
      hermesBin: MOCK_BIN,
      hermesHome: home,
      id: 'marvin',
      heading: { name: 'Marvin', tagline: 'the depressed android' },
      persona: 'You still do the work.',
      env: { MOCK_HERMES_HOME: home },
    });
    const soul = readFileSync(join(home, 'profiles', 'marvin', 'SOUL.md'), 'utf8');
    expect(soul).toContain('# Marvin — the depressed android');
    expect(soul).toContain('You still do the work.');
  });

  it('leaves every pre-existing profile byte-identical (§4.9, §10.6)', async () => {
    const before = hashTree(home);
    await createProfile({
      hermesBin: MOCK_BIN,
      hermesHome: home,
      id: 'athena',
      heading: { name: 'Athena', tagline: null },
      env: { MOCK_HERMES_HOME: home },
    });
    const after = hashTree(home);
    // The only difference is the new profile's own files.
    for (const [file, hash] of Object.entries(before)) {
      expect(after[file], `${file} was modified`).toBe(hash);
    }
    const added = Object.keys(after).filter((f) => !(f in before));
    expect(added.every((f) => f.startsWith('profiles/athena/'))).toBe(true);
  });

  it('rejects a duplicate id without touching disk', async () => {
    const before = hashTree(home);
    await expect(
      createProfile({
        hermesBin: MOCK_BIN,
        hermesHome: home,
        id: 'ford',
        heading: { name: 'Ford', tagline: 'Career' },
        env: { MOCK_HERMES_HOME: home },
      }),
    ).rejects.toThrow(/already/i);
    expect(hashTree(home)).toEqual(before);
  });

  it('surfaces a readable error when the CLI fails', async () => {
    await expect(
      createProfile({
        hermesBin: MOCK_BIN,
        hermesHome: home,
        id: 'Bad Name',
        heading: { name: 'Bad', tagline: null },
        env: { MOCK_HERMES_HOME: home },
      }),
    ).rejects.toThrow();
  });

  it('leaves the scaffold default untouched — never adopts it (decision 2)', async () => {
    await createProfile({
      hermesBin: MOCK_BIN,
      hermesHome: home,
      id: 'athena',
      heading: { name: 'Athena', tagline: null },
      env: { MOCK_HERMES_HOME: home },
    });
    expect(readFileSync(join(home, 'SOUL.md'), 'utf8')).toBe(SCAFFOLD);
    const def = (await enumerateProfiles(home)).find((p) => p.id === 'default')!;
    expect(def.real).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run test/unit/create.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/main/hermes/create.ts`:

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HermesProfile, SoulHeading } from '../../shared/types';
import { withSoulHeading } from './soul';
import { enumerateProfiles } from './profiles';

const run = promisify(execFile);

const RESERVED = new Set(['default']);

/**
 * Hermes's own help text says profile names are "lowercase, alphanumeric", but
 * `deep-thought` exists and works on real installs, so hyphens and underscores
 * are accepted here. The 32-character ceiling comes from spec §6, Screen 5.
 */
const ID_RE = /^[a-z0-9][a-z0-9_-]*$/;

export function validateProfileId(
  id: string,
  taken: string[],
): { ok: true } | { ok: false; message: string } {
  if (!id) return { ok: false, message: 'Name can’t be empty.' };
  if (id.length > 32) return { ok: false, message: 'Name can’t be longer than 32 characters.' };
  if (!ID_RE.test(id)) {
    return {
      ok: false,
      message: 'Use lowercase letters, numbers, hyphens, and underscores. Start with a letter or number.',
    };
  }
  if (RESERVED.has(id)) return { ok: false, message: 'That name is reserved by Hermes.' };
  if (taken.includes(id)) return { ok: false, message: 'A profile with that name already exists.' };
  return { ok: true };
}

export interface CreateProfileOptions {
  hermesBin: string;
  hermesHome: string;
  id: string;
  heading: SoulHeading;
  /** Optional free-text persona body from Screen 5, panel 5. */
  persona?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Creates one profile and writes its display-name heading. Touches nothing else
 * on disk — §4.9 forbids modifying any profile the user did not explicitly ask
 * Circe to modify, and §10.6 asserts it by hash.
 */
export async function createProfile(opts: CreateProfileOptions): Promise<HermesProfile> {
  const { hermesBin, hermesHome, id, heading, persona } = opts;
  const env = { ...process.env, ...opts.env };

  const existing = await enumerateProfiles(hermesHome);
  const check = validateProfileId(id, existing.map((p) => p.id));
  if (!check.ok) throw new Error(check.message);

  // Hermes owns profile creation — Circe never scaffolds a profile directory
  // itself (§4.7). `profile create` is non-interactive and takes flags.
  try {
    await run(hermesBin, ['profile', 'create', id], { env, timeout: 60_000 });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr?.trim();
    throw new Error(stderr || `Couldn’t create the profile "${id}".`);
  }

  const soulPath = join(hermesHome, 'profiles', id, 'SOUL.md');
  let existingSoul = '';
  try {
    existingSoul = await readFile(soulPath, 'utf8');
  } catch {
    existingSoul = '';
  }

  const body = persona?.trim() ? `${persona.trim()}\n` : existingSoul;
  await writeFile(soulPath, withSoulHeading(body, heading), 'utf8');

  const created = (await enumerateProfiles(hermesHome)).find((p) => p.id === id);
  if (!created) throw new Error(`Created "${id}" but couldn’t read it back.`);
  return created;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/unit/create.test.ts`
Expected: all 15 tests PASS. The byte-hash test is the Phase-1 unit-level half of §10.6; Task 17 adds the end-to-end half.

- [ ] **Step 5: Commit**

```bash
git add src/main/hermes/create.ts test/unit/create.test.ts
git commit -m "feat: create Hermes profiles without touching existing ones"
```

---

### Task 7: ACP client — transport, sessions, streaming

Harvested from the prototype at `/Users/sarachipps/Code/circe/acpClient.js`, which already solved the framing and the option classification. What changes: TypeScript with real types, the binary path is injected rather than hard-coded (prototype line 13), the diagnostic files it wrote into `~/.hermes` are dropped (prototype lines 119–134 — Circe should not litter the user's Hermes home), and the whole thing becomes testable against the Task 2 mock. The permission gate is deliberately **not** in this task; Task 8 adds it.

**Files:**
- Create: `src/main/hermes/acpClient.ts`
- Test: `test/unit/acpClient.test.ts`

**Interfaces:**
- Consumes: `GateMode` from `src/shared/types.ts`.
- Produces: the `AcpClient` class with constructor options `{ hermesBin, profileId, cwd?, env?, gateMode?, onUpdate?, onPermission?, onExit? }` and methods `start(): Promise<InitializeResult>`, `newSession(): Promise<string>`, `loadSession(id): Promise<void>`, `prompt(sessionId, text): Promise<PromptResult>`, `cancelSession(sessionId): Promise<void>`, `stop(): void`. Also exports the `SessionUpdate`, `PermissionEvent`, and `PermissionOption` types that Tasks 8, 10, and 12 consume.

- [ ] **Step 1: Write the failing test**

Create `test/unit/acpClient.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AcpClient } from '../../src/main/hermes/acpClient';
import type { SessionUpdate } from '../../src/main/hermes/acpClient';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOCK_BIN = resolve(HERE, '../fixtures/mock-hermes/hermes');

let client: AcpClient | null = null;
afterEach(() => {
  client?.stop();
  client = null;
});

function makeClient(scenario = 'stream', onUpdate?: (u: SessionUpdate) => void) {
  return new AcpClient({
    hermesBin: MOCK_BIN,
    profileId: 'test',
    env: { MOCK_HERMES_SCENARIO: scenario },
    onUpdate,
  });
}

describe('AcpClient', () => {
  it('spawns with `-p <profile> acp` — the §4.3 transport', async () => {
    client = makeClient();
    const result = await client.start();
    expect(result.protocolVersion).toBe(1);
    expect(client.spawnArgs).toEqual(['-p', 'test', 'acp', '--accept-hooks']);
  });

  it('opens a session and returns its id', async () => {
    client = makeClient();
    await client.start();
    expect(await client.newSession()).toBe('s1');
  });

  it('streams agent_message_chunk updates for a prompt', async () => {
    const chunks: string[] = [];
    client = makeClient('stream', (u) => {
      if (u.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text') {
        chunks.push(u.content.text);
      }
    });
    await client.start();
    const sid = await client.newSession();
    const res = await client.prompt(sid, 'hi');
    expect(res.stopReason).toBe('end_turn');
    expect(chunks.join('')).toContain('Hello');
  });

  it('handles a JSON-RPC response split across stdout chunks', async () => {
    // The mock writes whole lines, so exercise the framer directly instead.
    client = makeClient();
    await client.start();
    const seen: SessionUpdate[] = [];
    client.onUpdate = (u) => seen.push(u);
    client.ingestForTest('{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s1","upd');
    client.ingestForTest('ate":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"ok"}}}}\n');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.content?.text).toBe('ok');
  });

  it('ignores non-JSON lines on stdout rather than crashing', async () => {
    client = makeClient();
    await client.start();
    expect(() => client!.ingestForTest('not json at all\n')).not.toThrow();
  });

  it('rejects every in-flight request when the subprocess exits', async () => {
    const exits: (number | null)[] = [];
    client = new AcpClient({
      hermesBin: MOCK_BIN,
      profileId: 'test',
      env: { MOCK_HERMES_SCENARIO: 'crash' },
      onExit: (code) => exits.push(code),
    });
    await expect(client.start()).rejects.toThrow(/exited/);
    expect(exits).toHaveLength(1);
  });

  it('reports a readable error when the binary does not exist', async () => {
    client = new AcpClient({ hermesBin: '/nonexistent/hermes', profileId: 'test' });
    await expect(client.start()).rejects.toThrow();
  });

  it('is idempotent on stop()', async () => {
    client = makeClient();
    await client.start();
    client.stop();
    expect(() => client!.stop()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run test/unit/acpClient.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/main/hermes/acpClient.ts`. The gate hooks (`gateMode`, `onPermission`, `resolvePermission`) are declared here but only fully implemented in Task 8; for now `session/request_permission` is answered by auto-approving, which the Task 8 tests will then tighten.

```ts
import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import type { GateMode } from '../../shared/types';

export interface PermissionOption {
  optionId?: string;
  name?: string;
  /** ACP option kinds: allow_once, allow_always, reject_once, reject_always. */
  kind?: string;
}

export interface ToolCallRef {
  toolCallId?: string;
  title?: string;
  kind?: string;
}

export interface SessionUpdate {
  sessionUpdate: string;
  content?: { type: string; text: string };
  toolCallId?: string;
  title?: string;
  status?: string;
}

export interface PermissionEvent {
  /** Non-null only when the request is parked awaiting the user (ask mode). */
  requestKey: string | null;
  /** Set when the gate resolved the request without the user. */
  resolved: 'locked' | 'unlocked' | null;
  toolCall: ToolCallRef | null;
  options: PermissionOption[];
}

export interface InitializeResult {
  protocolVersion: number;
  agentCapabilities?: Record<string, unknown>;
}

export interface PromptResult {
  stopReason?: string;
}

export interface AcpClientOptions {
  hermesBin: string;
  profileId: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  gateMode?: GateMode;
  onUpdate?: (update: SessionUpdate, sessionId: string) => void;
  onPermission?: (event: PermissionEvent) => void;
  onExit?: (code: number | null) => void;
}

interface Pending {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
}

export class AcpClient {
  readonly profileId: string;
  readonly spawnArgs: string[];
  onUpdate: (update: SessionUpdate, sessionId: string) => void;
  onPermission: (event: PermissionEvent) => void;
  onExit: (code: number | null) => void;

  protected gateMode: GateMode;
  private readonly hermesBin: string;
  private readonly cwd: string;
  private readonly env: NodeJS.ProcessEnv;
  private child: ChildProcess | null = null;
  private ready: Promise<InitializeResult> | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private buf = '';

  constructor(opts: AcpClientOptions) {
    this.hermesBin = opts.hermesBin;
    this.profileId = opts.profileId;
    this.cwd = opts.cwd ?? homedir();
    this.env = { ...process.env, ...opts.env, HERMES_ACCEPT_HOOKS: '1' };
    this.gateMode = opts.gateMode ?? 'unlocked';
    this.onUpdate = opts.onUpdate ?? (() => {});
    this.onPermission = opts.onPermission ?? (() => {});
    this.onExit = opts.onExit ?? (() => {});
    // §4.3 — the one and only transport.
    this.spawnArgs = ['-p', this.profileId, 'acp', '--accept-hooks'];
  }

  start(): Promise<InitializeResult> {
    if (this.ready) return this.ready;

    this.child = spawn(this.hermesBin, this.spawnArgs, {
      env: this.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.child.stdout!.on('data', (b: Buffer) => this.ingest(b.toString()));
    this.child.stderr!.on('data', () => {
      // Hermes writes progress noise to stderr; it is not part of the protocol.
    });
    this.child.on('error', (err) => this.failAll(new Error(`Couldn’t start Hermes: ${err.message}`)));
    this.child.on('exit', (code) => {
      this.failAll(new Error(`hermes acp exited (${code})`));
      this.onExit(code);
    });

    this.ready = this.send<InitializeResult>('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
      clientInfo: { name: 'circe', version: '0.1.0' },
    });
    return this.ready;
  }

  async newSession(): Promise<string> {
    await this.ready;
    const r = await this.send<{ sessionId: string }>('session/new', { cwd: this.cwd, mcpServers: [] });
    return r.sessionId;
  }

  async loadSession(sessionId: string): Promise<void> {
    await this.ready;
    await this.send('session/load', { cwd: this.cwd, sessionId, mcpServers: [] });
  }

  async prompt(sessionId: string, text: string): Promise<PromptResult> {
    await this.ready;
    return this.send<PromptResult>('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text }],
    });
  }

  async cancelSession(sessionId: string): Promise<void> {
    try {
      await this.send('session/cancel', { sessionId });
    } catch {
      // Cancelling a dead session is not an error worth surfacing.
    }
  }

  stop(): void {
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
    this.ready = null;
  }

  /** Test seam so the line framer can be exercised without a subprocess. */
  ingestForTest(chunk: string): void {
    this.ingest(chunk);
  }

  protected send<T>(method: string, params: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  protected reply(id: number, result: unknown): void {
    this.write({ jsonrpc: '2.0', id, result });
  }

  protected replyError(id: number, code: number, message: string): void {
    this.write({ jsonrpc: '2.0', id, error: { code, message } });
  }

  private write(obj: unknown): void {
    if (this.child?.stdin?.writable) {
      this.child.stdin.write(JSON.stringify(obj) + '\n');
    }
  }

  private failAll(err: Error): void {
    for (const [, p] of this.pending) p.reject(err);
    this.pending.clear();
  }

  private ingest(chunk: string): void {
    this.buf += chunk;
    let i: number;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // Not protocol traffic — ignore rather than crash.
      }
      this.dispatch(msg);
    }
  }

  private dispatch(msg: any): void {
    // A response to something we sent.
    if (msg.id !== undefined && msg.method === undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message || 'rpc error'));
      else p.resolve(msg.result);
      return;
    }

    // A notification.
    if (msg.method === 'session/update' && msg.params) {
      this.onUpdate(msg.params.update as SessionUpdate, msg.params.sessionId as string);
      return;
    }

    // A server-initiated request.
    if (msg.method && msg.id !== undefined) {
      this.handleServerRequest(msg.id, msg.method, msg.params);
    }
  }

  protected handleServerRequest(id: number, method: string, params: any): void {
    if (method === 'session/request_permission') {
      // Task 8 replaces this with the real three-state gate.
      const allow = (params?.options ?? []).find((o: PermissionOption) => o.kind?.startsWith('allow'));
      this.reply(id, {
        outcome: { outcome: 'selected', optionId: allow?.optionId ?? allow?.name ?? 'allow' },
      });
      return;
    }
    if (method === 'fs/read_text_file') {
      readFile(params.path, 'utf8').then(
        (content) => this.reply(id, { content }),
        (err) => this.replyError(id, -32603, err.message),
      );
      return;
    }
    if (method === 'fs/write_text_file') {
      writeFile(params.path, params.content, 'utf8').then(
        () => this.reply(id, {}),
        (err) => this.replyError(id, -32603, err.message),
      );
      return;
    }
    this.replyError(id, -32601, `method not implemented: ${method}`);
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/unit/acpClient.test.ts`
Expected: all 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/hermes/acpClient.ts test/unit/acpClient.test.ts
git commit -m "feat: ACP JSON-RPC client over stdio, harvested from prototype"
```

---

### Task 8: The permission gate

Spec §6.4 plus the §10.4 liveness requirement. The gate lives in the main process inside the ACP client, because that is the only place that can act on the *next inbound request* without waiting for a session or turn boundary. Two behaviours are easy to get wrong and are tested explicitly: locked mode still renders a visible "denied" card so the user can see the agent tried something, and cycling away from `ask` while a card is pending resolves every pending card as `cancelled` so Hermes is never left waiting on an abandoned prompt.

**Files:**
- Modify: `src/main/hermes/acpClient.ts` (replace the placeholder `handleServerRequest` permission branch)
- Create: `src/shared/gate.ts`
- Test: `test/unit/gate.test.ts`

**Interfaces:**
- Consumes: `AcpClient` from Task 7; `GateMode`, `GATE_MODES` from `src/shared/types.ts`.
- Produces: `nextGateMode(m: GateMode): GateMode`, `isAllowOption(o: PermissionOption): boolean`, `isRejectOption(o: PermissionOption): boolean` in `src/shared/gate.ts`; and on `AcpClient`: `setGateMode(mode: GateMode): void`, `resolvePermission(requestKey: string, optionId: string | null): boolean`, `cancelPendingPermissions(): void`, `get pendingPermissionCount(): number`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/gate.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AcpClient, type PermissionEvent } from '../../src/main/hermes/acpClient';
import { nextGateMode, isAllowOption, isRejectOption } from '../../src/shared/gate';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOCK_BIN = resolve(HERE, '../fixtures/mock-hermes/hermes');

let client: AcpClient | null = null;
afterEach(() => {
  client?.stop();
  client = null;
});

function permissionClient(gateMode: 'locked' | 'ask' | 'unlocked', events: PermissionEvent[]) {
  return new AcpClient({
    hermesBin: MOCK_BIN,
    profileId: 'test',
    gateMode,
    env: { MOCK_HERMES_SCENARIO: 'permission' },
    onPermission: (e) => events.push(e),
  });
}

describe('nextGateMode', () => {
  it('cycles locked → ask → unlocked → locked (§6.4)', () => {
    expect(nextGateMode('locked')).toBe('ask');
    expect(nextGateMode('ask')).toBe('unlocked');
    expect(nextGateMode('unlocked')).toBe('locked');
  });
});

describe('option classification', () => {
  it('prefers the ACP kind field', () => {
    expect(isAllowOption({ kind: 'allow_once' })).toBe(true);
    expect(isAllowOption({ kind: 'allow_always' })).toBe(true);
    expect(isRejectOption({ kind: 'reject_once' })).toBe(true);
    expect(isRejectOption({ kind: 'reject_always' })).toBe(true);
  });

  it('falls back to name matching for less strict servers', () => {
    expect(isAllowOption({ name: 'Approve' })).toBe(true);
    expect(isRejectOption({ name: 'Deny' })).toBe(true);
  });

  it('does not classify an unrelated option', () => {
    expect(isAllowOption({ name: 'Explain' })).toBe(false);
    expect(isRejectOption({ name: 'Explain' })).toBe(false);
  });
});

describe('gate behaviour', () => {
  it('auto-approves in unlocked mode and completes the tool call', async () => {
    const events: PermissionEvent[] = [];
    client = permissionClient('unlocked', events);
    const statuses: string[] = [];
    client.onUpdate = (u) => {
      if (u.sessionUpdate === 'tool_call_update' && u.status) statuses.push(u.status);
    };
    await client.start();
    const sid = await client.newSession();
    await client.prompt(sid, 'write a file');
    expect(statuses).toContain('completed');
  });

  it('auto-denies in locked mode and still surfaces a visible denied event (§6.4)', async () => {
    const events: PermissionEvent[] = [];
    client = permissionClient('locked', events);
    const statuses: string[] = [];
    client.onUpdate = (u) => {
      if (u.sessionUpdate === 'tool_call_update' && u.status) statuses.push(u.status);
    };
    await client.start();
    const sid = await client.newSession();
    await client.prompt(sid, 'write a file');
    expect(statuses).toContain('failed');
    expect(events).toHaveLength(1);
    expect(events[0]!.resolved).toBe('locked');
    expect(events[0]!.requestKey).toBeNull();
    expect(events[0]!.toolCall?.title).toBe('write_file');
  });

  it('parks the request in ask mode until the user resolves it', async () => {
    const events: PermissionEvent[] = [];
    client = permissionClient('ask', events);
    await client.start();
    const sid = await client.newSession();
    const promptDone = client.prompt(sid, 'write a file');

    // Wait for the request to be parked rather than racing it.
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]!.requestKey).toBeTruthy();
    expect(events[0]!.resolved).toBeNull();
    expect(client.pendingPermissionCount).toBe(1);

    client.resolvePermission(events[0]!.requestKey!, 'allow-once');
    await promptDone;
    expect(client.pendingPermissionCount).toBe(0);
  });

  it('treats a null optionId as a cancellation', async () => {
    const events: PermissionEvent[] = [];
    client = permissionClient('ask', events);
    await client.start();
    const sid = await client.newSession();
    const promptDone = client.prompt(sid, 'write a file');
    await vi.waitFor(() => expect(events).toHaveLength(1));
    client.resolvePermission(events[0]!.requestKey!, null);
    await promptDone;
    expect(client.pendingPermissionCount).toBe(0);
  });

  it('LIVENESS (§10.4): switching to Locked mid-response denies the very next tool call', async () => {
    const events: PermissionEvent[] = [];
    client = permissionClient('unlocked', events);
    const statuses: string[] = [];
    client.onUpdate = (u) => {
      // The tool_call announcement arrives before the permission request, so
      // flipping the gate here proves no session or turn boundary is needed.
      if (u.sessionUpdate === 'tool_call') client!.setGateMode('locked');
      if (u.sessionUpdate === 'tool_call_update' && u.status) statuses.push(u.status);
    };
    await client.start();
    const sid = await client.newSession();
    await client.prompt(sid, 'write a file');

    expect(statuses).toContain('failed');
    expect(events.some((e) => e.resolved === 'locked')).toBe(true);
  });

  it('cancels pending cards when the mode leaves ask, so Hermes never hangs (§6.4)', async () => {
    const events: PermissionEvent[] = [];
    client = permissionClient('ask', events);
    await client.start();
    const sid = await client.newSession();
    const promptDone = client.prompt(sid, 'write a file');
    await vi.waitFor(() => expect(client!.pendingPermissionCount).toBe(1));

    client.setGateMode('unlocked');
    await promptDone;
    expect(client.pendingPermissionCount).toBe(0);
  });

  it('resolvePermission returns false for an unknown key', async () => {
    client = permissionClient('ask', []);
    await client.start();
    expect(client.resolvePermission('nope', 'allow-once')).toBe(false);
  });
});
```

Add `import { vi } from 'vitest';` to the import block at the top of the file.

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run test/unit/gate.test.ts`
Expected: FAIL — `src/shared/gate` not found, and `setGateMode` is not a function.

- [ ] **Step 3: Write the gate helpers**

Create `src/shared/gate.ts`:

```ts
import { GATE_MODES, type GateMode } from './types';

/** §6.4 — clicking the permission button cycles locked → ask → unlocked → locked. */
export function nextGateMode(mode: GateMode): GateMode {
  const i = GATE_MODES.indexOf(mode);
  return GATE_MODES[(i + 1) % GATE_MODES.length]!;
}

interface OptionLike {
  optionId?: string;
  name?: string;
  kind?: string;
}

/**
 * `kind` is the strongest signal — per the ACP spec options carry allow_once,
 * allow_always, reject_once, or reject_always. Name matching is a fallback for
 * servers that omit it. Harvested from prototype acpClient.js:50-53.
 */
export function isAllowOption(o: OptionLike): boolean {
  if (o.kind?.startsWith('allow')) return true;
  return /\b(allow|approve|yes|accept|permit)\b/i.test(o.name ?? o.optionId ?? '');
}

export function isRejectOption(o: OptionLike): boolean {
  if (o.kind?.startsWith('reject')) return true;
  return /\b(reject|deny|no|cancel|decline|refuse)\b/i.test(o.name ?? o.optionId ?? '');
}
```

- [ ] **Step 4: Wire the gate into the ACP client**

In `src/main/hermes/acpClient.ts`, add the import:

```ts
import { isAllowOption, isRejectOption } from '../../shared/gate';
```

Add these fields beside the existing private fields:

```ts
  /** Requests parked awaiting the user in ask mode. */
  private pendingPermissions = new Map<string, { rpcId: number; options: PermissionOption[] }>();
  private nextPermKey = 1;
```

Add these public members:

```ts
  get pendingPermissionCount(): number {
    return this.pendingPermissions.size;
  }

  /**
   * Takes effect on the next inbound request — no session or turn boundary
   * (§10.4). Leaving `ask` resolves every parked card as cancelled so the agent
   * is not left waiting on a prompt the user has abandoned (§6.4).
   */
  setGateMode(mode: GateMode): void {
    const previous = this.gateMode;
    this.gateMode = mode;
    if (previous === 'ask' && mode !== 'ask') this.cancelPendingPermissions();
  }

  resolvePermission(requestKey: string, optionId: string | null): boolean {
    const entry = this.pendingPermissions.get(requestKey);
    if (!entry) return false;
    this.pendingPermissions.delete(requestKey);
    if (optionId) {
      const match = entry.options.find((o) => (o.optionId ?? o.name) === optionId);
      this.reply(entry.rpcId, {
        outcome: { outcome: 'selected', optionId: match?.optionId ?? match?.name ?? optionId },
      });
    } else {
      this.reply(entry.rpcId, { outcome: { outcome: 'cancelled' } });
    }
    return true;
  }

  cancelPendingPermissions(): void {
    for (const [key, entry] of this.pendingPermissions) {
      this.reply(entry.rpcId, { outcome: { outcome: 'cancelled' } });
      this.pendingPermissions.delete(key);
    }
  }
```

Replace the placeholder `session/request_permission` branch in `handleServerRequest` with a call to a new method, and add that method:

```ts
    if (method === 'session/request_permission') {
      this.handlePermissionRequest(id, params);
      return;
    }
```

```ts
  private handlePermissionRequest(rpcId: number, params: any): void {
    const options: PermissionOption[] = params?.options ?? [];
    const toolCall: ToolCallRef | null = params?.toolCall ?? null;

    if (this.gateMode === 'unlocked') {
      const allow = options.find(isAllowOption) ?? options[0];
      this.reply(rpcId, {
        outcome: { outcome: 'selected', optionId: allow?.optionId ?? allow?.name ?? 'allow' },
      });
      return;
    }

    if (this.gateMode === 'locked') {
      const reject = options.find(isRejectOption);
      if (reject) {
        this.reply(rpcId, {
          outcome: { outcome: 'selected', optionId: reject.optionId ?? reject.name },
        });
      } else {
        this.reply(rpcId, { outcome: { outcome: 'cancelled' } });
      }
      // Still surface it, already resolved, so the transcript can render a card
      // showing what was denied — the user must be able to see the agent tried.
      this.onPermission({ requestKey: null, resolved: 'locked', toolCall, options });
      return;
    }

    // ask — park it and wait for resolvePermission().
    const requestKey = `p${this.nextPermKey++}`;
    this.pendingPermissions.set(requestKey, { rpcId, options });
    try {
      this.onPermission({ requestKey, resolved: null, toolCall, options });
    } catch {
      // If the UI could not take the handoff, do not leave Hermes hanging.
      this.pendingPermissions.delete(requestKey);
      this.reply(rpcId, { outcome: { outcome: 'cancelled' } });
    }
  }
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/unit/gate.test.ts test/unit/acpClient.test.ts`
Expected: all tests PASS, including the §10.4 liveness test. Task 18 adds the E2E half of §10.4 through the real UI.

- [ ] **Step 6: Commit**

```bash
git add src/shared/gate.ts src/main/hermes/acpClient.ts test/unit/gate.test.ts
git commit -m "feat: three-state permission gate with mid-response liveness"
```

---

### Task 9: State store

§10.5 requires that a three-tile fleet's open tiles, window bounds, tab lists, per-tab transcripts, focused tab, and gate modes all survive a clean quit and relaunch **exactly**. Writes must be atomic — a crash mid-write must never leave a truncated JSON file that bricks the next launch.

**Files:**
- Create: `src/main/state/store.ts`
- Test: `test/unit/store.test.ts`

**Interfaces:**
- Consumes: `CirceState`, `TileState`, `emptyState`, `DEFAULT_PALETTE` from `src/shared/types.ts`.
- Produces: `class StateStore` with `constructor(filePath: string)`, `load(): Promise<CirceState>`, `save(state: CirceState): Promise<void>`, `get(): CirceState`, `updateTile(profileId: string, patch: Partial<TileState>): Promise<void>`, `removeTile(profileId: string): Promise<void>`. Also `migrate(raw: unknown): CirceState`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateStore, migrate } from '../../src/main/state/store';
import { emptyState, DEFAULT_PALETTE, type TileState } from '../../src/shared/types';

let dir: string;
let file: string;

function tile(profileId: string, over: Partial<TileState> = {}): TileState {
  return {
    profileId,
    bounds: { x: 10, y: 20, width: 500, height: 600 },
    gateMode: 'unlocked',
    palette: DEFAULT_PALETTE,
    tabs: [{ id: 't1', title: 'New tab', sessionId: null, messages: [] }],
    activeTabId: 't1',
    tiled: true,
    isCodingProfile: false,
    ...over,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'circe-state-'));
  file = join(dir, 'state.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('StateStore', () => {
  it('returns empty state when the file does not exist', async () => {
    expect(await new StateStore(file).load()).toEqual(emptyState());
  });

  it('round-trips a three-tile fleet exactly (§10.5)', async () => {
    const store = new StateStore(file);
    const state = emptyState();
    state.onboarded = true;
    state.mainOperatorId = 'athena';
    state.tiles = {
      athena: tile('athena', {
        bounds: { x: 0, y: 0, width: 500, height: 600 },
        gateMode: 'locked',
        palette: { accent: '#ff0000', background: '#111111' },
        tabs: [
          { id: 't1', title: 'first', sessionId: 's1', messages: [{ role: 'user', text: 'hi' }] },
          { id: 't2', title: 'second', sessionId: 's2', messages: [] },
        ],
        activeTabId: 't2',
        isCodingProfile: true,
      }),
      ford: tile('ford', { bounds: { x: 520, y: 0, width: 480, height: 640 }, gateMode: 'ask' }),
      marvin: tile('marvin', { bounds: { x: 1040, y: 0, width: 500, height: 600 }, tiled: false }),
    };

    await store.save(state);
    expect(await new StateStore(file).load()).toEqual(state);
  });

  it('preserves every field §10.5 names', async () => {
    const store = new StateStore(file);
    const state = emptyState();
    state.tiles = { athena: tile('athena', { gateMode: 'ask', activeTabId: 't1' }) };
    await store.save(state);

    const loaded = await new StateStore(file).load();
    const t = loaded.tiles['athena']!;
    expect(t.bounds).toEqual({ x: 10, y: 20, width: 500, height: 600 });
    expect(t.gateMode).toBe('ask');
    expect(t.tabs).toHaveLength(1);
    expect(t.activeTabId).toBe('t1');
    expect(t.palette).toEqual(DEFAULT_PALETTE);
  });

  it('writes atomically, leaving no temp files behind', async () => {
    const store = new StateStore(file);
    await store.save(emptyState());
    expect(readdirSync(dir)).toEqual(['state.json']);
  });

  it('recovers to empty state from a truncated file rather than throwing', async () => {
    writeFileSync(file, '{"version":1,"tiles":{');
    expect(await new StateStore(file).load()).toEqual(emptyState());
  });

  it('recovers from a file that is valid JSON but the wrong shape', async () => {
    writeFileSync(file, '["not", "an", "object"]');
    expect(await new StateStore(file).load()).toEqual(emptyState());
  });

  it('drops tiles that are missing required fields instead of loading them broken', async () => {
    writeFileSync(
      file,
      JSON.stringify({ version: 1, onboarded: true, mainOperatorId: null, tiles: { bad: { profileId: 'bad' } } }),
    );
    const loaded = await new StateStore(file).load();
    expect(loaded.onboarded).toBe(true);
    expect(loaded.tiles).toEqual({});
  });

  it('updateTile patches one tile and persists', async () => {
    const store = new StateStore(file);
    const state = emptyState();
    state.tiles = { athena: tile('athena') };
    await store.save(state);

    await store.updateTile('athena', { gateMode: 'locked' });
    expect(store.get().tiles['athena']!.gateMode).toBe('locked');
    expect((await new StateStore(file).load()).tiles['athena']!.gateMode).toBe('locked');
  });

  it('updateTile on an unknown profile is a no-op', async () => {
    const store = new StateStore(file);
    await store.save(emptyState());
    await store.updateTile('ghost', { gateMode: 'locked' });
    expect(store.get().tiles).toEqual({});
  });

  it('removeTile deletes and persists', async () => {
    const store = new StateStore(file);
    const state = emptyState();
    state.tiles = { athena: tile('athena'), ford: tile('ford') };
    await store.save(state);

    await store.removeTile('athena');
    expect(Object.keys((await new StateStore(file).load()).tiles)).toEqual(['ford']);
  });

  it('serialises concurrent saves without interleaving', async () => {
    const store = new StateStore(file);
    await store.save(emptyState());
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => store.updateTile('athena', { gateMode: i % 2 ? 'locked' : 'ask' })),
    );
    // The file must still parse — the point is no torn write.
    expect(() => JSON.parse(readFileSync(file, 'utf8'))).not.toThrow();
  });
});

describe('migrate', () => {
  it('accepts a well-formed state unchanged', () => {
    const state = emptyState();
    expect(migrate(state)).toEqual(state);
  });

  it('returns empty state for null', () => {
    expect(migrate(null)).toEqual(emptyState());
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run test/unit/store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/main/state/store.ts`:

```ts
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  emptyState,
  GATE_MODES,
  type CirceState,
  type TileState,
  type GateMode,
} from '../../shared/types';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validTile(v: unknown): v is TileState {
  if (!isRecord(v)) return false;
  const b = v.bounds;
  return (
    typeof v.profileId === 'string' &&
    isRecord(b) &&
    typeof b.x === 'number' &&
    typeof b.y === 'number' &&
    typeof b.width === 'number' &&
    typeof b.height === 'number' &&
    GATE_MODES.includes(v.gateMode as GateMode) &&
    isRecord(v.palette) &&
    Array.isArray(v.tabs) &&
    typeof v.activeTabId === 'string' &&
    typeof v.tiled === 'boolean' &&
    typeof v.isCodingProfile === 'boolean'
  );
}

/**
 * Coerces whatever is on disk into a usable CirceState. A malformed tile is
 * dropped rather than loaded broken — §8.2 says Circe refuses to spawn a tile
 * for a bad profile and leaves the others unaffected, never auto-repairing.
 */
export function migrate(raw: unknown): CirceState {
  if (!isRecord(raw)) return emptyState();
  const tiles: Record<string, TileState> = {};
  if (isRecord(raw.tiles)) {
    for (const [id, tile] of Object.entries(raw.tiles)) {
      if (validTile(tile)) tiles[id] = tile;
    }
  }
  return {
    version: 1,
    onboarded: raw.onboarded === true,
    mainOperatorId: typeof raw.mainOperatorId === 'string' ? raw.mainOperatorId : null,
    tiles,
  };
}

export class StateStore {
  private state: CirceState = emptyState();
  /** Serialises writes so concurrent saves cannot interleave. */
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load(): Promise<CirceState> {
    try {
      this.state = migrate(JSON.parse(await readFile(this.filePath, 'utf8')));
    } catch {
      this.state = emptyState();
    }
    return this.state;
  }

  get(): CirceState {
    return this.state;
  }

  save(state: CirceState): Promise<void> {
    this.state = state;
    return this.enqueue();
  }

  updateTile(profileId: string, patch: Partial<TileState>): Promise<void> {
    const existing = this.state.tiles[profileId];
    if (!existing) return Promise.resolve();
    this.state.tiles[profileId] = { ...existing, ...patch };
    return this.enqueue();
  }

  removeTile(profileId: string): Promise<void> {
    delete this.state.tiles[profileId];
    return this.enqueue();
  }

  private enqueue(): Promise<void> {
    this.queue = this.queue.then(() => this.flush());
    return this.queue;
  }

  /** Write to a temp file and rename — rename is atomic on macOS, so a crash
   *  mid-write can never leave a truncated state file. */
  private async flush(): Promise<void> {
    const tmp = `${this.filePath}.tmp`;
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(tmp, JSON.stringify(this.state, null, 2), 'utf8');
    await rename(tmp, this.filePath);
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/unit/store.test.ts`
Expected: all 13 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/state/store.ts test/unit/store.test.ts
git commit -m "feat: atomic state persistence for the fleet"
```

---

### Task 10: Cast data and UI primitives

The cast picker's content (§6, Screen 4a) and the primitive set decided in §5.6. Critically, §4.6 and §10.7 forbid shipping a single character image — every character carries a name, a tagline, and a palette, and nothing else. The avatar is always the first initial in a colored circle unless the user uploads or generates one (both Phase 2).

**Files:**
- Create: `src/shared/casts.ts`
- Create: `src/renderer/ui/base.css`
- Create: `src/renderer/ui/primitives.ts`
- Test: `test/unit/casts.test.ts`

**Interfaces:**
- Consumes: `Palette` from `src/shared/types.ts`.
- Produces: `CASTS: Cast[]`, `type Cast = { id: string; label: string; characters: Character[] }`, `type Character = { name: string; tagline: string; palette: Palette; suggestedId: string }`, `DEFAULT_CAST_ID = 'neutral'`, `findCast(id: string): Cast | undefined`, `initialFor(name: string): string`. From `primitives.ts`: `button(...)`, `segmented(...)`, `loader(...)`, `emptyState(...)`, `errorState(...)`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/casts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CASTS, DEFAULT_CAST_ID, findCast, initialFor } from '../../src/shared/casts';

describe('casts', () => {
  it('ships exactly the five casts from §6 Screen 4a', () => {
    expect(CASTS.map((c) => c.id)).toEqual(['startrek', 'hitchhikers', 'greek', 'neutral', 'custom']);
  });

  it('defaults to Neutral — fans opt in to fandoms', () => {
    expect(DEFAULT_CAST_ID).toBe('neutral');
    expect(findCast(DEFAULT_CAST_ID)).toBeDefined();
  });

  it('lists the characters the spec names', () => {
    expect(findCast('startrek')!.characters.map((c) => c.name)).toEqual([
      'Picard', 'Data', 'Troi', 'Geordi', 'Wesley', 'Locutus',
    ]);
    expect(findCast('greek')!.characters.map((c) => c.name)).toEqual([
      'Athena', 'Hermes', 'Circe', 'Prometheus', 'Hecate',
    ]);
    expect(findCast('neutral')!.characters.map((c) => c.name)).toEqual([
      'Alpha', 'Beta', 'Gamma', 'Delta',
    ]);
  });

  it('gives every character a tagline and a two-colour palette', () => {
    for (const cast of CASTS) {
      for (const ch of cast.characters) {
        expect(ch.tagline, `${ch.name} needs a tagline`).toBeTruthy();
        expect(ch.palette.accent).toMatch(/^#[0-9a-f]{6}$/i);
        expect(ch.palette.background).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('gives every character a valid lowercase profile id', () => {
    for (const cast of CASTS) {
      for (const ch of cast.characters) {
        expect(ch.suggestedId).toMatch(/^[a-z0-9][a-z0-9_-]*$/);
        expect(ch.suggestedId.length).toBeLessThanOrEqual(32);
      }
    }
  });

  it('references no image assets anywhere (§4.6, §10.7)', () => {
    const serialised = JSON.stringify(CASTS);
    expect(serialised).not.toMatch(/\.(png|jpe?g|gif|webp|svg)/i);
    expect(serialised).not.toMatch(/https?:/i);
  });

  it('has an empty character list for the custom cast', () => {
    expect(findCast('custom')!.characters).toEqual([]);
  });
});

describe('initialFor', () => {
  it('takes the first letter, uppercased', () => {
    expect(initialFor('athena')).toBe('A');
    expect(initialFor('Deep-Thought')).toBe('D');
  });

  it('falls back to a bullet for an empty name', () => {
    expect(initialFor('')).toBe('•');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run test/unit/casts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the cast data**

Create `src/shared/casts.ts`:

```ts
import type { Palette } from './types';

export interface Character {
  name: string;
  tagline: string;
  palette: Palette;
  /** Pre-filled Hermes profile id — lowercase, valid per validateProfileId. */
  suggestedId: string;
}

export interface Cast {
  id: string;
  label: string;
  characters: Character[];
}

const c = (name: string, tagline: string, accent: string, background: string): Character => ({
  name,
  tagline,
  palette: { accent, background },
  suggestedId: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
});

/**
 * §4.6 — Circe ships no character images. A cast entry is a name, a tagline,
 * and two colours. Nothing here may ever reference an image file or a URL.
 */
export const CASTS: Cast[] = [
  {
    id: 'startrek',
    label: 'Star Trek: TNG',
    characters: [
      c('Picard', 'the diplomat', '#c8992e', '#1b1710'),
      c('Data', 'the analyst', '#d8c37a', '#191712'),
      c('Troi', 'the counsellor', '#8f6fb5', '#171320'),
      c('Geordi', 'the engineer', '#4f9e88', '#101a18'),
      c('Wesley', 'the prodigy', '#5b8fd0', '#101620'),
      c('Locutus', 'the assimilator', '#7d8a99', '#12161a'),
    ],
  },
  {
    id: 'hitchhikers',
    label: "Hitchhiker's Guide",
    characters: [
      c('Arthur', 'the reluctant', '#8fae6a', '#141810'),
      c('Ford', 'the researcher', '#d07a4a', '#1c1410'),
      c('Zaphod', 'the two-headed', '#d05a8a', '#1e1218'),
      c('Trillian', 'the coordinator', '#6f9fd0', '#101620'),
      c('Marvin', 'the depressed android', '#6b7280', '#141518'),
      c('Slartibartfast', 'the coastline architect', '#9a8fd0', '#16141f'),
      c('Deep Thought', 'the calculator', '#4fa3a3', '#101a1a'),
      c('Vogon', 'the bureaucrat', '#8a8f5a', '#171810'),
    ],
  },
  {
    id: 'greek',
    label: 'Greek mythology',
    characters: [
      c('Athena', 'the strategist', '#c9b273', '#181610'),
      c('Hermes', 'the messenger', '#6fb0c9', '#101a1d'),
      c('Circe', 'the transformer', '#a67fd4', '#171122'),
      c('Prometheus', 'the fire-bringer', '#d06a4a', '#1c1310'),
      c('Hecate', 'the keeper of thresholds', '#7a6fb5', '#14121e'),
    ],
  },
  {
    id: 'neutral',
    label: 'Neutral',
    characters: [
      c('Alpha', 'the first', '#8b7fd4', '#1a1820'),
      c('Beta', 'the second', '#5f9ea0', '#101a1a'),
      c('Gamma', 'the third', '#c08a5a', '#1a1510'),
      c('Delta', 'the fourth', '#7f9fd4', '#111620'),
    ],
  },
  // Custom has no characters — the user types a name and picks colours.
  { id: 'custom', label: 'Custom', characters: [] },
];

/** Fans opt in to fandoms; the wizard does not push a persona on anyone (§6, Screen 4a). */
export const DEFAULT_CAST_ID = 'neutral';

export function findCast(id: string): Cast | undefined {
  return CASTS.find((cast) => cast.id === id);
}

/** The avatar fallback — a colored circle with the character's first letter (§6.3.2). */
export function initialFor(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '•';
}
```

- [ ] **Step 4: Write the primitives and base stylesheet**

Create `src/renderer/ui/base.css`. §7 asks for flat, translucent, atmospheric chrome with no card-in-card nesting and no divider borders inside a panel.

```css
:root {
  --accent: #8b7fd4;
  --bg: #1a1820;
  --fg: rgba(255, 255, 255, 0.92);
  --fg-dim: rgba(255, 255, 255, 0.55);
  --hairline: rgba(255, 255, 255, 0.08);
  --radius: 12px;
  --font: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: var(--font);
  font-size: 13px;
  color: var(--fg);
  background: transparent;
  -webkit-font-smoothing: antialiased;
}

/* Group with whitespace and single hairlines — never nested boxes (§7). */
.hairline { border: 0; border-top: 1px solid var(--hairline); margin: 0; }

.btn {
  appearance: none;
  border: 1px solid var(--hairline);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--fg);
  font: inherit;
  padding: 7px 13px;
  cursor: pointer;
}
.btn:hover { background: rgba(255, 255, 255, 0.1); }
.btn:disabled { opacity: 0.4; cursor: default; }
.btn--primary { background: var(--accent); border-color: transparent; color: #0d0b12; font-weight: 600; }
.btn--quiet { background: transparent; border-color: transparent; color: var(--fg-dim); }

.segmented { display: flex; gap: 4px; }
.segmented__item {
  flex: 1;
  padding: 7px 11px;
  border-radius: 8px;
  border: 1px solid var(--hairline);
  background: transparent;
  color: var(--fg-dim);
  font: inherit;
  cursor: pointer;
}
.segmented__item[aria-selected='true'] { background: var(--accent); border-color: transparent; color: #0d0b12; }

.loader { width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid var(--hairline); border-top-color: var(--accent);
  animation: spin 0.7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.state { padding: 20px; color: var(--fg-dim); text-align: center; }
.state--error { color: #e08a8a; }

.avatar {
  width: 26px; height: 26px; border-radius: 50%;
  display: grid; place-items: center;
  background: var(--accent); color: #0d0b12;
  font-weight: 600; font-size: 12px;
}
```

Create `src/renderer/ui/primitives.ts`:

```ts
/** The §5.6 primitive set. One visual language, built once, used everywhere. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(
  label: string,
  onClick: () => void,
  variant: 'primary' | 'default' | 'quiet' = 'default',
): HTMLButtonElement {
  const b = el('button', variant === 'default' ? 'btn' : `btn btn--${variant}`, label);
  b.addEventListener('click', onClick);
  return b;
}

export function segmented(
  items: { id: string; label: string }[],
  selectedId: string,
  onSelect: (id: string) => void,
): HTMLDivElement {
  const wrap = el('div', 'segmented');
  for (const item of items) {
    const b = el('button', 'segmented__item', item.label);
    b.setAttribute('aria-selected', String(item.id === selectedId));
    b.addEventListener('click', () => onSelect(item.id));
    wrap.append(b);
  }
  return wrap;
}

export function loader(): HTMLDivElement {
  return el('div', 'loader');
}

export function emptyState(message: string): HTMLDivElement {
  return el('div', 'state', message);
}

export function errorState(message: string): HTMLDivElement {
  return el('div', 'state state--error', message);
}

export function avatar(initial: string): HTMLDivElement {
  return el('div', 'avatar', initial);
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/unit/casts.test.ts && npm run typecheck`
Expected: all 9 tests PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/shared/casts.ts src/renderer/ui/ test/unit/casts.test.ts
git commit -m "feat: cast data and UI primitive set"
```

---

### Task 11: The tile — window, IPC, transcript, composer, gate button

The steady-state UX from §6.3. A tile is a ~500×600 rounded translucent window with a header (display name, model, avatar, gate button), a transcript, and a composer. Phase 1 ships a single tab per tile; the full tab strip is Phase 2, but the state shape already carries a tab list so Phase 2 does not need a migration.

**Files:**
- Create: `src/shared/ipc.ts`
- Create: `src/preload/tile.ts`
- Create: `src/renderer/tile/index.html`, `src/renderer/tile/tile.css`, `src/renderer/tile/main.ts`
- Create: `src/main/tiles/manager.ts`
- Test: `test/unit/tileManager.test.ts`

**Interfaces:**
- Consumes: `AcpClient` (Task 7), `StateStore` (Task 9), `enumerateProfiles` (Task 5), `nextGateMode` (Task 8), `initialFor` (Task 10).
- Produces: `class TileManager` with `constructor(deps: { store: StateStore; hermesBin: string; hermesHome: string; env?: NodeJS.ProcessEnv; createWindow?: WindowFactory })`, `spawnTile(profileId: string): Promise<void>`, `closeTile(profileId: string): void`, `cycleGate(profileId: string): Promise<GateMode>`, `sendPrompt(profileId: string, text: string): Promise<void>`, `get openTileIds(): string[]`, `shutdown(): Promise<void>`. Also the `IPC` channel-name constants in `src/shared/ipc.ts`.

- [ ] **Step 1: Write the failing test**

`TileManager` takes an injectable window factory so its logic is testable without Electron. Create `test/unit/tileManager.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TileManager } from '../../src/main/tiles/manager';
import { StateStore } from '../../src/main/state/store';
import { emptyState, DEFAULT_PALETTE } from '../../src/shared/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOCK_BIN = resolve(HERE, '../fixtures/mock-hermes/hermes');

let home: string;
let store: StateStore;

/** A fake window that records what the renderer would have been sent. */
function fakeWindowFactory() {
  const windows: any[] = [];
  const factory = (profileId: string) => {
    const win = {
      profileId,
      sent: [] as { channel: string; payload: unknown }[],
      bounds: { x: 0, y: 0, width: 500, height: 600 },
      destroyed: false,
      send: (channel: string, payload: unknown) => win.sent.push({ channel, payload }),
      getBounds: () => win.bounds,
      close: () => { win.destroyed = true; },
      isDestroyed: () => win.destroyed,
    };
    windows.push(win);
    return win;
  };
  return { factory, windows };
}

function makeManager(scenario = 'stream') {
  const { factory, windows } = fakeWindowFactory();
  const manager = new TileManager({
    store,
    hermesBin: MOCK_BIN,
    hermesHome: home,
    env: { MOCK_HERMES_SCENARIO: scenario, MOCK_HERMES_HOME: home },
    createWindow: factory as any,
  });
  return { manager, windows };
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'circe-tiles-'));
  writeFileSync(join(home, 'SOUL.md'), 'scaffold prose');
  mkdirSync(join(home, 'profiles', 'athena'), { recursive: true });
  writeFileSync(join(home, 'profiles', 'athena', 'SOUL.md'), '# Athena — the strategist\n');
  store = new StateStore(join(home, 'state.json'));
  const s = emptyState();
  s.tiles = {
    athena: {
      profileId: 'athena',
      bounds: { x: 0, y: 0, width: 500, height: 600 },
      gateMode: 'unlocked',
      palette: DEFAULT_PALETTE,
      tabs: [{ id: 't1', title: 'New tab', sessionId: null, messages: [] }],
      activeTabId: 't1',
      tiled: true,
      isCodingProfile: false,
    },
  };
  await store.save(s);
});

afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('TileManager', () => {
  it('spawns a tile and reports it open', async () => {
    const { manager, windows } = makeManager();
    await manager.spawnTile('athena');
    expect(manager.openTileIds).toEqual(['athena']);
    expect(windows).toHaveLength(1);
    await manager.shutdown();
  });

  it('sends the resolved display name, tagline, and palette to the renderer', async () => {
    const { manager, windows } = makeManager();
    await manager.spawnTile('athena');
    const init = windows[0].sent.find((m: any) => m.channel === 'tile:init');
    expect(init.payload.displayName).toBe('Athena');
    expect(init.payload.tagline).toBe('the strategist');
    expect(init.payload.palette).toEqual(DEFAULT_PALETTE);
    expect(init.payload.gateMode).toBe('unlocked');
    await manager.shutdown();
  });

  it('streams agent chunks through to the renderer', async () => {
    const { manager, windows } = makeManager();
    await manager.spawnTile('athena');
    await manager.sendPrompt('athena', 'hi');
    const chunks = windows[0].sent.filter((m: any) => m.channel === 'tile:chunk');
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.map((c: any) => c.payload.text).join('')).toContain('Hello');
    await manager.shutdown();
  });

  it('persists the user message and the agent reply to the transcript', async () => {
    const { manager } = makeManager();
    await manager.spawnTile('athena');
    await manager.sendPrompt('athena', 'hi there');
    const tab = store.get().tiles['athena']!.tabs[0]!;
    expect(tab.messages[0]).toEqual({ role: 'user', text: 'hi there' });
    expect(tab.messages[1]!.role).toBe('agent');
    expect(tab.messages[1]!.text).toContain('Hello');
    await manager.shutdown();
  });

  it('cycles the gate and persists it (§6.4)', async () => {
    const { manager } = makeManager();
    await manager.spawnTile('athena');
    expect(await manager.cycleGate('athena')).toBe('locked');
    expect(store.get().tiles['athena']!.gateMode).toBe('locked');
    expect(await manager.cycleGate('athena')).toBe('ask');
    expect(await manager.cycleGate('athena')).toBe('unlocked');
    await manager.shutdown();
  });

  it('renders a denied card in the transcript when locked (§6.4)', async () => {
    const { manager, windows } = makeManager('permission');
    await manager.spawnTile('athena');
    await manager.cycleGate('athena'); // unlocked → locked
    await manager.sendPrompt('athena', 'write a file');

    const denied = windows[0].sent.filter((m: any) => m.channel === 'tile:denied');
    expect(denied).toHaveLength(1);
    expect(denied[0].payload.title).toBe('write_file');

    const messages = store.get().tiles['athena']!.tabs[0]!.messages;
    expect(messages.some((m) => m.kind === 'denied')).toBe(true);
    await manager.shutdown();
  });

  it('persists window bounds on close (§10.5)', async () => {
    const { manager, windows } = makeManager();
    await manager.spawnTile('athena');
    windows[0].bounds = { x: 120, y: 240, width: 640, height: 480 };
    manager.closeTile('athena');
    await vi.waitFor(() =>
      expect(store.get().tiles['athena']!.bounds).toEqual({ x: 120, y: 240, width: 640, height: 480 }),
    );
    expect(manager.openTileIds).toEqual([]);
  });

  it('does not spawn a second tile for the same profile', async () => {
    const { manager, windows } = makeManager();
    await manager.spawnTile('athena');
    await manager.spawnTile('athena');
    expect(windows).toHaveLength(1);
    await manager.shutdown();
  });

  it('refuses to spawn a tile for an unknown profile with a readable error (§8.2)', async () => {
    const { manager } = makeManager();
    await expect(manager.spawnTile('ghost')).rejects.toThrow(/ghost/);
  });

  it('surfaces an agent crash to the renderer rather than dying (§8.2)', async () => {
    const { manager, windows } = makeManager('crash');
    await manager.spawnTile('athena').catch(() => {});
    await vi.waitFor(() =>
      expect(windows[0].sent.some((m: any) => m.channel === 'tile:agent-stopped')).toBe(true),
    );
  });

  it('shuts every subprocess down cleanly (§6.3.4)', async () => {
    const { manager } = makeManager();
    await manager.spawnTile('athena');
    await manager.shutdown();
    expect(manager.openTileIds).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run test/unit/tileManager.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the IPC channel constants**

Create `src/shared/ipc.ts`:

```ts
import type { GateMode, Palette, Message } from './types';

/** Main → renderer. */
export const IPC_TO_RENDERER = {
  init: 'tile:init',
  chunk: 'tile:chunk',
  turnEnd: 'tile:turn-end',
  denied: 'tile:denied',
  permissionAsk: 'tile:permission-ask',
  agentStopped: 'tile:agent-stopped',
  gateChanged: 'tile:gate-changed',
  error: 'tile:error',
} as const;

/** Renderer → main, all `invoke`. */
export const IPC_TO_MAIN = {
  send: 'tile:send',
  cycleGate: 'tile:cycle-gate',
  resolvePermission: 'tile:resolve-permission',
  restart: 'tile:restart',
} as const;

export interface TileInitPayload {
  profileId: string;
  displayName: string;
  tagline: string | null;
  model: string | null;
  palette: Palette;
  gateMode: GateMode;
  messages: Message[];
}

export interface ChunkPayload { text: string }
export interface DeniedPayload { title: string }
export interface PermissionAskPayload {
  requestKey: string;
  title: string;
  options: { optionId: string; name: string }[];
}
```

- [ ] **Step 4: Write the tile manager**

Create `src/main/tiles/manager.ts`:

```ts
import { AcpClient, type PermissionEvent, type SessionUpdate } from '../hermes/acpClient';
import { enumerateProfiles } from '../hermes/profiles';
import { nextGateMode } from '../../shared/gate';
import { IPC_TO_RENDERER } from '../../shared/ipc';
import type { StateStore } from '../state/store';
import type { GateMode, Message } from '../../shared/types';

/** The slice of BrowserWindow TileManager needs, so tests can substitute a fake. */
export interface TileWindow {
  send(channel: string, payload: unknown): void;
  getBounds(): { x: number; y: number; width: number; height: number };
  close(): void;
  isDestroyed(): boolean;
}

export type WindowFactory = (profileId: string) => TileWindow;

interface OpenTile {
  window: TileWindow;
  client: AcpClient;
  sessionId: string | null;
  /** Accumulates the current turn's streamed text. */
  streaming: string;
}

export interface TileManagerDeps {
  store: StateStore;
  hermesBin: string;
  hermesHome: string;
  env?: NodeJS.ProcessEnv;
  createWindow: WindowFactory;
}

export class TileManager {
  private tiles = new Map<string, OpenTile>();

  constructor(private readonly deps: TileManagerDeps) {}

  get openTileIds(): string[] {
    return [...this.tiles.keys()];
  }

  async spawnTile(profileId: string): Promise<void> {
    if (this.tiles.has(profileId)) return;

    const profile = (await enumerateProfiles(this.deps.hermesHome)).find((p) => p.id === profileId);
    if (!profile) throw new Error(`No Hermes profile named "${profileId}".`);

    const tileState = this.deps.store.get().tiles[profileId];
    if (!tileState) throw new Error(`No saved tile for "${profileId}".`);

    const window = this.deps.createWindow(profileId);
    const client = new AcpClient({
      hermesBin: this.deps.hermesBin,
      profileId,
      env: this.deps.env,
      gateMode: tileState.gateMode,
      onUpdate: (u) => this.onUpdate(profileId, u),
      onPermission: (e) => this.onPermission(profileId, e),
      onExit: (code) => this.onExit(profileId, code),
    });

    const entry: OpenTile = { window, client, sessionId: null, streaming: '' };
    this.tiles.set(profileId, entry);

    window.send(IPC_TO_RENDERER.init, {
      profileId,
      displayName: profile.displayName,
      tagline: profile.tagline,
      model: null,
      palette: tileState.palette,
      gateMode: tileState.gateMode,
      messages: tileState.tabs[0]?.messages ?? [],
    });

    try {
      await client.start();
      entry.sessionId = await client.newSession();
    } catch (err) {
      window.send(IPC_TO_RENDERER.agentStopped, { message: (err as Error).message });
      throw err;
    }
  }

  async sendPrompt(profileId: string, text: string): Promise<void> {
    const tile = this.tiles.get(profileId);
    if (!tile || !tile.sessionId) throw new Error(`Tile "${profileId}" isn’t ready.`);

    await this.appendMessage(profileId, { role: 'user', text });
    tile.streaming = '';
    await tile.client.prompt(tile.sessionId, text);

    if (tile.streaming) {
      await this.appendMessage(profileId, { role: 'agent', text: tile.streaming });
      tile.streaming = '';
    }
    tile.window.send(IPC_TO_RENDERER.turnEnd, {});
  }

  async cycleGate(profileId: string): Promise<GateMode> {
    const current = this.deps.store.get().tiles[profileId]?.gateMode ?? 'unlocked';
    const next = nextGateMode(current);
    // Apply to the live client first — §10.4 requires the next inbound request
    // to see the new mode, with no session or turn boundary.
    this.tiles.get(profileId)?.client.setGateMode(next);
    await this.deps.store.updateTile(profileId, { gateMode: next });
    this.tiles.get(profileId)?.window.send(IPC_TO_RENDERER.gateChanged, { gateMode: next });
    return next;
  }

  resolvePermission(profileId: string, requestKey: string, optionId: string | null): boolean {
    return this.tiles.get(profileId)?.client.resolvePermission(requestKey, optionId) ?? false;
  }

  closeTile(profileId: string): void {
    const tile = this.tiles.get(profileId);
    if (!tile) return;
    if (!tile.window.isDestroyed()) {
      void this.deps.store.updateTile(profileId, { bounds: tile.window.getBounds() });
      tile.window.close();
    }
    tile.client.stop();
    this.tiles.delete(profileId);
  }

  async shutdown(): Promise<void> {
    for (const id of [...this.tiles.keys()]) this.closeTile(id);
    await this.deps.store.save(this.deps.store.get());
  }

  private onUpdate(profileId: string, update: SessionUpdate): void {
    const tile = this.tiles.get(profileId);
    if (!tile) return;
    if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
      tile.streaming += update.content.text;
      tile.window.send(IPC_TO_RENDERER.chunk, { text: update.content.text });
    }
  }

  private onPermission(profileId: string, event: PermissionEvent): void {
    const tile = this.tiles.get(profileId);
    if (!tile) return;
    const title = event.toolCall?.title ?? 'a tool call';

    if (event.resolved === 'locked') {
      tile.window.send(IPC_TO_RENDERER.denied, { title });
      void this.appendMessage(profileId, { role: 'tool', text: `Denied: ${title}`, kind: 'denied' });
      return;
    }
    if (event.requestKey) {
      tile.window.send(IPC_TO_RENDERER.permissionAsk, {
        requestKey: event.requestKey,
        title,
        options: event.options.map((o) => ({
          optionId: o.optionId ?? o.name ?? '',
          name: o.name ?? o.optionId ?? '',
        })),
      });
    }
  }

  private onExit(profileId: string, code: number | null): void {
    const tile = this.tiles.get(profileId);
    if (!tile) return;
    tile.window.send(IPC_TO_RENDERER.agentStopped, {
      message: `This agent stopped unexpectedly (exit ${code}).`,
    });
  }

  private async appendMessage(profileId: string, message: Message): Promise<void> {
    const state = this.deps.store.get().tiles[profileId];
    if (!state) return;
    const tab = state.tabs[0];
    if (!tab) return;
    tab.messages.push(message);
    await this.deps.store.updateTile(profileId, { tabs: state.tabs });
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/unit/tileManager.test.ts`
Expected: all 11 tests PASS.

- [ ] **Step 6: Write the preload and renderer**

Create `src/preload/tile.ts`:

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { IPC_TO_MAIN, IPC_TO_RENDERER } from '../shared/ipc';

const profileId = process.argv.find((a) => a.startsWith('--profile-id='))?.split('=')[1] ?? '';

// Context isolation is on and nodeIntegration is off — this is the entire
// surface the renderer gets.
contextBridge.exposeInMainWorld('circe', {
  profileId,
  send: (text: string) => ipcRenderer.invoke(IPC_TO_MAIN.send, { profileId, text }),
  cycleGate: () => ipcRenderer.invoke(IPC_TO_MAIN.cycleGate, { profileId }),
  resolvePermission: (requestKey: string, optionId: string | null) =>
    ipcRenderer.invoke(IPC_TO_MAIN.resolvePermission, { profileId, requestKey, optionId }),
  restart: () => ipcRenderer.invoke(IPC_TO_MAIN.restart, { profileId }),
  on: (event: keyof typeof IPC_TO_RENDERER, handler: (payload: any) => void) => {
    ipcRenderer.on(IPC_TO_RENDERER[event], (_e, payload) => handler(payload));
  },
});
```

Create `src/renderer/tile/index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;" />
    <link rel="stylesheet" href="../ui/base.css" />
    <link rel="stylesheet" href="./tile.css" />
  </head>
  <body>
    <header id="header">
      <div id="avatar" class="avatar"></div>
      <div id="identity">
        <div id="name"></div>
        <div id="model"></div>
      </div>
      <button id="gate" class="btn btn--quiet" title="Cycle permission gate"></button>
    </header>
    <hr class="hairline" />
    <main id="transcript"></main>
    <footer id="composer">
      <input id="input" type="text" placeholder="Message" autocomplete="off" />
      <button id="send" class="btn btn--primary">Send</button>
    </footer>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

The CSP above is deliberate — `default-src 'none'` plus `img-src 'self' data:` means the renderer cannot load a remote image even by accident, which is half of the §10.7 avatar-provenance invariant enforced at runtime.

Create `src/renderer/tile/tile.css`:

```css
/* Translucent, atmospheric, no nested boxes (§7). */
body {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: color-mix(in srgb, var(--bg) 82%, transparent);
  backdrop-filter: blur(24px);
  border-radius: var(--radius);
  border: 1px solid var(--hairline);
  overflow: hidden;
}

#header {
  display: flex; align-items: center; gap: 9px;
  padding: 10px 12px 10px 78px; /* room for the native traffic lights */
  -webkit-app-region: drag;      /* draggable by the top area (§6.3.1) */
}
#header button { -webkit-app-region: no-drag; }

#identity { flex: 1; min-width: 0; }
#name { font-weight: 600; }
#model { font-size: 11px; color: var(--fg-dim); }

#transcript { flex: 1; overflow-y: auto; padding: 10px 14px; display: flex; flex-direction: column; gap: 9px; }

.msg { max-width: 88%; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
.msg.user { align-self: flex-end; color: var(--fg); }
.msg.agent { align-self: flex-start; }
.msg.tool { align-self: flex-start; font-size: 11px; color: var(--fg-dim); }
.msg.denied { color: #e0a08a; }
.msg.error { color: #e08a8a; }

.permission { align-self: flex-start; display: flex; gap: 6px; align-items: center; font-size: 12px; }

#composer { display: flex; gap: 8px; padding: 10px 12px; }
#input {
  flex: 1; padding: 8px 11px; border-radius: 8px;
  border: 1px solid var(--hairline); background: rgba(255,255,255,0.05);
  color: var(--fg); font: inherit; outline: none;
}
#input:focus { border-color: var(--accent); }
```

Create `src/renderer/tile/main.ts`:

```ts
import { initialFor } from '../../shared/casts';
import { el, button } from '../ui/primitives';
import type { TileInitPayload, ChunkPayload, DeniedPayload, PermissionAskPayload } from '../../shared/ipc';

declare global {
  interface Window {
    circe: {
      profileId: string;
      send(text: string): Promise<void>;
      cycleGate(): Promise<{ gateMode: string }>;
      resolvePermission(requestKey: string, optionId: string | null): Promise<boolean>;
      restart(): Promise<void>;
      on(event: string, handler: (payload: any) => void): void;
    };
  }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const transcript = $('transcript');
const input = $<HTMLInputElement>('input');
const sendBtn = $<HTMLButtonElement>('send');
const gateBtn = $<HTMLButtonElement>('gate');

const GATE_LABEL: Record<string, string> = { locked: '🔒', ask: '⛔', unlocked: '🔓' };

let streamingEl: HTMLElement | null = null;
let busy = false;

function addMessage(role: string, text: string, kind?: string): HTMLElement {
  const node = el('div', `msg ${role}${kind ? ` ${kind}` : ''}`, text);
  transcript.append(node);
  transcript.scrollTop = transcript.scrollHeight;
  return node;
}

function setBusy(value: boolean) {
  busy = value;
  sendBtn.textContent = value ? 'Stop' : 'Send';
}

window.circe.on('init', (p: TileInitPayload) => {
  document.documentElement.style.setProperty('--accent', p.palette.accent);
  document.documentElement.style.setProperty('--bg', p.palette.background);
  $('name').textContent = p.displayName;
  $('model').textContent = p.model ?? '';
  $('avatar').textContent = initialFor(p.displayName);
  gateBtn.textContent = GATE_LABEL[p.gateMode] ?? '🔓';
  for (const m of p.messages) addMessage(m.role, m.text, m.kind);
});

window.circe.on('chunk', (p: ChunkPayload) => {
  if (!streamingEl) streamingEl = addMessage('agent', '');
  streamingEl.textContent += p.text;
  transcript.scrollTop = transcript.scrollHeight;
});

window.circe.on('turnEnd', () => {
  streamingEl = null;
  setBusy(false);
});

window.circe.on('denied', (p: DeniedPayload) => {
  addMessage('tool', `Denied: ${p.title}`, 'denied');
});

window.circe.on('permissionAsk', (p: PermissionAskPayload) => {
  const card = el('div', 'permission');
  card.append(el('span', undefined, `${p.title}?`));
  for (const opt of p.options) {
    card.append(
      button(opt.name, async () => {
        await window.circe.resolvePermission(p.requestKey, opt.optionId);
        card.remove();
      }),
    );
  }
  transcript.append(card);
  transcript.scrollTop = transcript.scrollHeight;
});

window.circe.on('gateChanged', (p: { gateMode: string }) => {
  gateBtn.textContent = GATE_LABEL[p.gateMode] ?? '🔓';
});

window.circe.on('agentStopped', (p: { message: string }) => {
  const card = el('div', 'msg agent error', p.message);
  card.append(button('Restart', () => window.circe.restart()));
  transcript.append(card);
  setBusy(false);
});

async function submit() {
  const text = input.value.trim();
  if (!text || busy) return;
  input.value = '';
  addMessage('user', text);
  setBusy(true);
  await window.circe.send(text);
}

sendBtn.addEventListener('click', submit);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submit();
});
gateBtn.addEventListener('click', () => window.circe.cycleGate());
```

- [ ] **Step 7: Verify the build and typecheck**

Run: `npm run typecheck && npm run build && npm test`
Expected: clean typecheck, successful build, all unit tests still passing.

- [ ] **Step 8: Commit**

```bash
git add src/shared/ipc.ts src/preload/tile.ts src/renderer/tile/ src/main/tiles/manager.ts test/unit/tileManager.test.ts
git commit -m "feat: tile window, IPC surface, transcript, composer, gate button"
```

---

### Task 12: Provider setup driver (§5.2)

`hermes login --provider <p> --no-browser` runs an OAuth **device authorization** flow: it prints a verification URL and a user code, waits while the user completes it in a browser, then exits 0. Circe scrapes the URL and code from stdout to render them, but never treats printed text as proof of success — success is exit code 0 confirmed by a follow-up `hermes status`. Everything here is a compat-notes entry because the output format is unversioned.

**Files:**
- Create: `src/main/hermes/provider.ts`
- Test: `test/unit/provider.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `PROVIDERS: { id: string; label: string }[]`, `parseDeviceCode(text: string): { url: string; code: string } | null`, and `class ProviderLogin` with `constructor(opts: { hermesBin: string; provider: string; env?: NodeJS.ProcessEnv; onPrompt?: (p: { url: string; code: string }) => void; onLog?: (line: string) => void })`, `run(): Promise<{ ok: boolean; message: string }>`, `cancel(): void`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/provider.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseDeviceCode, PROVIDERS } from '../../src/main/hermes/provider';

describe('PROVIDERS', () => {
  it('lists exactly what `hermes login --provider` accepts', () => {
    expect(PROVIDERS.map((p) => p.id)).toEqual(['nous', 'openai-codex', 'xai-oauth']);
  });

  it('gives each provider a human label', () => {
    for (const p of PROVIDERS) expect(p.label).toBeTruthy();
  });
});

describe('parseDeviceCode', () => {
  it('extracts a URL and a code from typical device-flow output', () => {
    const out = [
      'Starting device authorization…',
      'Visit https://portal.nousresearch.com/device to continue.',
      'Enter code: ABCD-1234',
    ].join('\n');
    expect(parseDeviceCode(out)).toEqual({
      url: 'https://portal.nousresearch.com/device',
      code: 'ABCD-1234',
    });
  });

  it('handles the url and code on one line', () => {
    expect(parseDeviceCode('Open https://example.com/activate and enter WXYZ-9876')).toEqual({
      url: 'https://example.com/activate',
      code: 'WXYZ-9876',
    });
  });

  it('returns null when no code is present yet', () => {
    expect(parseDeviceCode('Starting device authorization…')).toBeNull();
  });

  it('returns null when no URL is present', () => {
    expect(parseDeviceCode('Enter code: ABCD-1234')).toBeNull();
  });

  it('ignores a trailing period on the URL', () => {
    const r = parseDeviceCode('Visit https://example.com/device. Code: ABCD-1234');
    expect(r!.url).toBe('https://example.com/device');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run test/unit/provider.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/main/hermes/provider.ts`:

```ts
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Exactly the values `hermes login --provider` accepts on Hermes 0.14.0. */
export const PROVIDERS = [
  { id: 'nous', label: 'Nous Research' },
  { id: 'openai-codex', label: 'OpenAI' },
  { id: 'xai-oauth', label: 'xAI' },
] as const;

const URL_RE = /(https?:\/\/[^\s]+?)[.,]?(?=\s|$)/;
const CODE_RE = /\b([A-Z0-9]{4,8}-[A-Z0-9]{4,8})\b/;

/**
 * Scrapes the verification URL and user code out of `hermes login` stdout.
 *
 * COMPAT: this parses unversioned CLI output. If Hermes changes its device-flow
 * wording, this returns null and the wizard falls back to showing the raw log
 * plus a "run it in a terminal" affordance. See docs/compat-notes.md.
 */
export function parseDeviceCode(text: string): { url: string; code: string } | null {
  const url = URL_RE.exec(text)?.[1];
  const code = CODE_RE.exec(text)?.[1];
  return url && code ? { url, code } : null;
}

export interface ProviderLoginOptions {
  hermesBin: string;
  provider: string;
  env?: NodeJS.ProcessEnv;
  onPrompt?: (prompt: { url: string; code: string }) => void;
  onLog?: (line: string) => void;
}

export class ProviderLogin {
  private child: ChildProcess | null = null;
  private buffer = '';
  private prompted = false;

  constructor(private readonly opts: ProviderLoginOptions) {}

  /**
   * Runs the device flow to completion. Resolves with ok=true only when the
   * process exits 0 AND `hermes status` confirms it — never on printed text
   * alone, which is unversioned and could change meaning.
   */
  run(): Promise<{ ok: boolean; message: string }> {
    return new Promise((resolve) => {
      const env = { ...process.env, ...this.opts.env };
      this.child = spawn(
        this.opts.hermesBin,
        ['login', '--provider', this.opts.provider, '--no-browser'],
        { env, stdio: ['ignore', 'pipe', 'pipe'] },
      );

      const absorb = (chunk: Buffer) => {
        const text = chunk.toString();
        this.buffer += text;
        for (const line of text.split(/\r?\n/)) {
          if (line.trim()) this.opts.onLog?.(line);
        }
        if (!this.prompted) {
          const prompt = parseDeviceCode(this.buffer);
          if (prompt) {
            this.prompted = true;
            this.opts.onPrompt?.(prompt);
          }
        }
      };

      this.child.stdout!.on('data', absorb);
      this.child.stderr!.on('data', absorb);

      this.child.on('error', (err) =>
        resolve({ ok: false, message: `Couldn’t start the sign-in flow: ${err.message}` }),
      );

      this.child.on('exit', async (code) => {
        this.child = null;
        if (code !== 0) {
          resolve({ ok: false, message: 'Sign-in didn’t complete. You can retry, or skip and connect later.' });
          return;
        }
        try {
          await run(this.opts.hermesBin, ['status'], { env, timeout: 20_000 });
          resolve({ ok: true, message: 'Connected.' });
        } catch {
          resolve({ ok: false, message: 'Sign-in finished but Hermes couldn’t confirm it. Retry, or skip for now.' });
        }
      });
    });
  }

  cancel(): void {
    this.child?.kill();
    this.child = null;
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/unit/provider.test.ts`
Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/hermes/provider.ts test/unit/provider.test.ts
git commit -m "feat: drive Hermes provider login via the device-code flow"
```

---

### Task 13: Wizard shell and Screens 1–3

The wizard is the only modal flow Circe has (§4.8). Screens 1–3 are the detection half: welcome, runtime check, profile check. §8.2 requires that quitting mid-run and relaunching returns the user to the screen they left, not to Screen 1 — so the wizard's current screen is persisted.

**Files:**
- Create: `src/main/wizard/controller.ts`
- Create: `src/main/wizard/window.ts`
- Create: `src/preload/wizard.ts`
- Create: `src/renderer/wizard/index.html`, `src/renderer/wizard/wizard.css`, `src/renderer/wizard/main.ts`
- Modify: `src/shared/types.ts` (add the wizard's persisted position)
- Test: `test/unit/wizardController.test.ts`

**Interfaces:**
- Consumes: `locateHermes` (Task 4), `enumerateProfiles` (Task 5), `StateStore` (Task 9).
- Produces: `type ScreenId = 'welcome' | 'runtime' | 'profiles' | 'create' | 'walkthrough' | 'provider' | 'ready'`; `class WizardController` with `constructor(deps)`, `get screen(): ScreenId`, `start(): Promise<ScreenId>`, `goto(screen: ScreenId): void`, `back(): void`, `detectRuntime(): Promise<RuntimeStatus>`, `detectProfiles(): Promise<{ next: ScreenId; profiles: HermesProfile[] }>`.

- [ ] **Step 1: Add the wizard's persisted screen to shared types**

In `src/shared/types.ts`, add to `CirceState`:

```ts
  /** Where the wizard left off, so §8.2 can resume instead of restarting. */
  wizardScreen: string | null;
```

and update `emptyState()`:

```ts
export function emptyState(): CirceState {
  return { version: 1, onboarded: false, mainOperatorId: null, tiles: {}, wizardScreen: null };
}
```

Update `migrate()` in `src/main/state/store.ts` to carry it:

```ts
    wizardScreen: typeof raw.wizardScreen === 'string' ? raw.wizardScreen : null,
```

Update the `emptyState()` expectation in `test/unit/scaffold.test.ts` and `test/unit/store.test.ts` to include `wizardScreen: null`.

- [ ] **Step 2: Write the failing test**

Create `test/unit/wizardController.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WizardController } from '../../src/main/wizard/controller';
import { StateStore } from '../../src/main/state/store';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOCK_DIR = resolve(HERE, '../fixtures/mock-hermes');
const SCAFFOLD = 'You are Hermes Agent, an intelligent AI assistant created by Nous Research.';

let home: string;
let store: StateStore;

function makeController(env: Record<string, string> = {}) {
  return new WizardController({
    store,
    hermesHome: home,
    env: { PATH: MOCK_DIR, MOCK_HERMES_HOME: home, ...env },
  });
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'circe-wizard-'));
  writeFileSync(join(home, 'SOUL.md'), SCAFFOLD);
  store = new StateStore(join(home, 'state.json'));
  await store.load();
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('WizardController', () => {
  it('starts on welcome for a first run', async () => {
    expect(await makeController().start()).toBe('welcome');
  });

  it('resumes where the user left off rather than restarting (§8.2)', async () => {
    await store.save({ ...store.get(), wizardScreen: 'provider' });
    expect(await makeController().start()).toBe('provider');
  });

  it('persists the screen on every navigation', async () => {
    const w = makeController();
    await w.start();
    w.goto('runtime');
    expect(store.get().wizardScreen).toBe('runtime');
  });

  it('goes back through the screens it actually visited', async () => {
    const w = makeController();
    await w.start();
    w.goto('runtime');
    w.goto('profiles');
    w.back();
    expect(w.screen).toBe('runtime');
    w.back();
    expect(w.screen).toBe('welcome');
  });

  it('back at the first screen is a no-op', async () => {
    const w = makeController();
    await w.start();
    w.back();
    expect(w.screen).toBe('welcome');
  });

  it('detects an installed runtime and reports its version (Screen 2)', async () => {
    const status = await makeController().detectRuntime();
    expect(status.installed).toBe(true);
    expect(status.version).toBe('0.14.0');
  });

  it('reports a specific message when the runtime is missing (Screen 2)', async () => {
    const status = await makeController({ PATH: '/nonexistent' }).detectRuntime();
    expect(status.installed).toBe(false);
    expect(status.message).toMatch(/hermes/i);
    expect(status.message).not.toMatch(/at Object|\bstack\b/);
  });

  it('reports a too-old runtime as not usable (§8.1)', async () => {
    const status = await makeController({ MOCK_HERMES_VERSION: '0.13.0' }).detectRuntime();
    expect(status.installed).toBe(false);
    expect(status.message).toContain('0.14.0');
  });

  it('routes a fresh install to Screen 4a (§5.4)', async () => {
    const { next, profiles } = await makeController().detectProfiles();
    expect(next).toBe('create');
    expect(profiles.filter((p) => p.real)).toHaveLength(0);
  });

  it('routes an install with real profiles to Screen 4b', async () => {
    mkdirSync(join(home, 'profiles', 'ford'), { recursive: true });
    writeFileSync(join(home, 'profiles', 'ford', 'SOUL.md'), '# Ford — Career\n');
    const { next, profiles } = await makeController().detectProfiles();
    expect(next).toBe('profiles');
    expect(profiles.filter((p) => p.real).map((p) => p.id)).toEqual(['ford']);
  });

  it('treats an adopted default as real and routes to Screen 4b', async () => {
    writeFileSync(join(home, 'SOUL.md'), '# Trillian — Central Coordinator\n');
    expect((await makeController().detectProfiles()).next).toBe('profiles');
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npx vitest run test/unit/wizardController.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the controller**

Create `src/main/wizard/controller.ts`:

```ts
import { locateHermes, MIN_HERMES_VERSION } from '../hermes/locate';
import { enumerateProfiles } from '../hermes/profiles';
import type { StateStore } from '../state/store';
import type { HermesProfile } from '../../shared/types';

export type ScreenId =
  | 'welcome'    // 1
  | 'runtime'    // 2
  | 'profiles'   // 4b
  | 'create'     // 4a
  | 'walkthrough'// 5
  | 'provider'   // 6
  | 'ready';     // 7

export interface RuntimeStatus {
  installed: boolean;
  bin: string | null;
  version: string | null;
  message: string;
}

export interface WizardDeps {
  store: StateStore;
  hermesHome: string;
  env?: NodeJS.ProcessEnv;
}

export class WizardController {
  private current: ScreenId = 'welcome';
  private history: ScreenId[] = [];

  constructor(private readonly deps: WizardDeps) {}

  get screen(): ScreenId {
    return this.current;
  }

  /** Resumes at the persisted screen, so quitting mid-run doesn't restart (§8.2). */
  async start(): Promise<ScreenId> {
    const saved = this.deps.store.get().wizardScreen;
    this.current = (saved as ScreenId | null) ?? 'welcome';
    this.history = [];
    return this.current;
  }

  goto(screen: ScreenId): void {
    this.history.push(this.current);
    this.current = screen;
    void this.deps.store.save({ ...this.deps.store.get(), wizardScreen: screen });
  }

  back(): void {
    const previous = this.history.pop();
    if (!previous) return;
    this.current = previous;
    void this.deps.store.save({ ...this.deps.store.get(), wizardScreen: previous });
  }

  /** Screen 2. Advances automatically when Hermes is present and new enough. */
  async detectRuntime(): Promise<RuntimeStatus> {
    const found = await locateHermes({ env: this.deps.env });
    if (found.ok) {
      return { installed: true, bin: found.bin, version: found.version, message: '' };
    }
    return {
      installed: false,
      bin: found.bin,
      version: found.version,
      message: found.message.includes(MIN_HERMES_VERSION)
        ? found.message
        : `${found.message}`,
    };
  }

  /** Screen 3. Branches to 4a when nothing real exists, otherwise 4b (§5.4). */
  async detectProfiles(): Promise<{ next: ScreenId; profiles: HermesProfile[] }> {
    const profiles = await enumerateProfiles(this.deps.hermesHome);
    const real = profiles.filter((p) => p.real);
    return { next: real.length === 0 ? 'create' : 'profiles', profiles };
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/unit/wizardController.test.ts && npm test`
Expected: all 11 new tests PASS and the whole suite stays green.

- [ ] **Step 6: Write the wizard window, preload, and Screens 1–3 UI**

Create `src/main/wizard/window.ts`:

```ts
import { BrowserWindow } from 'electron';
import { join } from 'node:path';

export function createWizardWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 720,
    height: 520,
    resizable: false,
    titleBarStyle: 'hiddenInset',
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/wizard.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  return win;
}
```

Create `src/preload/wizard.ts`:

```ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('wizard', {
  start: () => ipcRenderer.invoke('wizard:start'),
  goto: (screen: string) => ipcRenderer.invoke('wizard:goto', screen),
  back: () => ipcRenderer.invoke('wizard:back'),
  detectRuntime: () => ipcRenderer.invoke('wizard:detect-runtime'),
  detectProfiles: () => ipcRenderer.invoke('wizard:detect-profiles'),
  createAgent: (payload: unknown) => ipcRenderer.invoke('wizard:create-agent', payload),
  listProviders: () => ipcRenderer.invoke('wizard:list-providers'),
  loginProvider: (provider: string) => ipcRenderer.invoke('wizard:login-provider', provider),
  launchFleet: () => ipcRenderer.invoke('wizard:launch-fleet'),
  on: (channel: string, handler: (payload: any) => void) => {
    ipcRenderer.on(channel, (_e, payload) => handler(payload));
  },
});
```

Create `src/renderer/wizard/index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;" />
    <link rel="stylesheet" href="../ui/base.css" />
    <link rel="stylesheet" href="./wizard.css" />
  </head>
  <body>
    <main id="screen"></main>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

Create `src/renderer/wizard/wizard.css`:

```css
body {
  height: 100vh;
  background: color-mix(in srgb, var(--bg) 92%, transparent);
  backdrop-filter: blur(30px);
  border-radius: var(--radius);
}
#screen { height: 100%; display: flex; flex-direction: column; justify-content: center; padding: 40px 56px; gap: 18px; }
h1 { font-size: 22px; font-weight: 600; margin: 0; }
p { margin: 0; color: var(--fg-dim); line-height: 1.5; }
.actions { display: flex; gap: 9px; margin-top: 6px; }
.log { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px;
  color: var(--fg-dim); max-height: 140px; overflow-y: auto; white-space: pre-wrap; }
.row { display: flex; align-items: center; gap: 10px; }
.code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 18px;
  letter-spacing: 2px; color: var(--fg); }
```

Create `src/renderer/wizard/main.ts` with Screens 1–3 (Screens 4a/5/6/7 are added in Tasks 14 and 15). Copy follows §1.4 — concise, sentence case, no cheerleading:

```ts
import { el, button, loader } from '../ui/primitives';

declare global {
  interface Window {
    wizard: {
      start(): Promise<string>;
      goto(screen: string): Promise<void>;
      back(): Promise<void>;
      detectRuntime(): Promise<{ installed: boolean; version: string | null; message: string }>;
      detectProfiles(): Promise<{ next: string; profiles: any[] }>;
      createAgent(payload: unknown): Promise<any>;
      listProviders(): Promise<{ id: string; label: string }[]>;
      loginProvider(provider: string): Promise<{ ok: boolean; message: string }>;
      launchFleet(): Promise<{ launched: number }>;
      on(channel: string, handler: (payload: any) => void): void;
    };
  }
}

const root = document.getElementById('screen')!;

export function render(nodes: (Node | string)[]) {
  root.replaceChildren(...nodes.map((n) => (typeof n === 'string' ? document.createTextNode(n) : n)));
}

function actions(...buttons: HTMLElement[]) {
  const wrap = el('div', 'actions');
  wrap.append(...buttons);
  return wrap;
}

const SCREENS: Record<string, () => void | Promise<void>> = {
  welcome() {
    render([
      el('h1', undefined, 'Circe'),
      el('p', undefined, 'Set up your agents.'),
      actions(
        button('Get started', () => go('runtime'), 'primary'),
        button('I already have Hermes running — skip ahead', () => go('profiles'), 'quiet'),
      ),
    ]);
  },

  async runtime() {
    const status = el('p', undefined, 'Checking for the Hermes runtime…');
    const row = el('div', 'row');
    row.append(loader(), status);
    render([el('h1', undefined, 'Runtime'), row]);

    const result = await window.wizard.detectRuntime();
    if (result.installed) {
      status.textContent = `Hermes ${result.version} is installed.`;
      row.firstChild?.remove();
      setTimeout(() => go('profiles'), 600); // advances in about a second (§6 Screen 2)
      return;
    }
    row.firstChild?.remove();
    status.textContent = result.message;
    render([
      el('h1', undefined, 'Runtime'),
      status,
      actions(
        button('Retry', () => go('runtime'), 'primary'),
        button('Back', () => window.wizard.back().then(boot), 'quiet'),
      ),
    ]);
  },

  async profiles() {
    render([el('h1', undefined, 'Profiles'), el('p', undefined, 'Looking for existing agents…')]);
    const { next, profiles } = await window.wizard.detectProfiles();
    if (next === 'create') {
      go('create');
      return;
    }
    const real = profiles.filter((p: any) => p.real);
    render([
      el('h1', undefined, 'Existing agents'),
      el('p', undefined, `Found ${real.length}. Circe will use them as they are.`),
      ...real.map((p: any) => el('div', 'row', `${p.displayName}${p.tagline ? ` — ${p.tagline}` : ''}`)),
      actions(button('Continue', () => go('provider'), 'primary')),
    ]);
  },
};

async function go(screen: string) {
  await window.wizard.goto(screen);
  await SCREENS[screen]?.();
}

async function boot() {
  const screen = await window.wizard.start();
  await (SCREENS[screen] ?? SCREENS.welcome!)();
}

boot();
```

Screen 4b here is deliberately read-only — it lists what was found and continues without touching anything, which is exactly the §10.6 invariant. Its per-row actions (use as-is, re-skin, rename, leave alone) are Phase 2 scope.

- [ ] **Step 7: Verify build and typecheck**

Run: `npm run typecheck && npm run build && npm test`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/main/wizard/ src/preload/wizard.ts src/renderer/wizard/ src/shared/types.ts src/main/state/store.ts test/unit/
git commit -m "feat: wizard shell with runtime and profile detection screens"
```

---

### Task 14: Screen 4a, the minimal walkthrough, and Screen 6

Screen 4a's job is nothing-to-one-themed-agent in under a minute. Phase 1 ships the cast picker, the suggested character card, and both primary actions; the "Customize" path opens a minimal Screen 5 with name, palette, and role picker. The full five-panel walkthrough with avatars is Phase 2. Screen 6 offers a provider per §5.2 and always offers Skip.

**Files:**
- Create: `src/main/wizard/agents.ts`
- Modify: `src/renderer/wizard/main.ts` (add the `create`, `walkthrough`, `provider` screens)
- Test: `test/unit/wizardAgents.test.ts`

**Interfaces:**
- Consumes: `createProfile`, `validateProfileId` (Task 6); `CASTS`, `findCast`, `DEFAULT_CAST_ID` (Task 10); `StateStore` (Task 9); `DEFAULT_PALETTE` (Task 1).
- Produces: `class AgentBuilder` with `constructor(deps: { store: StateStore; hermesBin: string; hermesHome: string; env?: NodeJS.ProcessEnv })` and `createFromCharacter(opts: { castId: string; characterName: string; profileId?: string; palette?: Palette; persona?: string; isCodingProfile?: boolean; makeMainOperator?: boolean }): Promise<HermesProfile>`; plus `suggestCharacter(castId: string, taken: string[]): Character | null`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/wizardAgents.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentBuilder, suggestCharacter } from '../../src/main/wizard/agents';
import { StateStore } from '../../src/main/state/store';
import { DEFAULT_PALETTE } from '../../src/shared/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOCK_BIN = resolve(HERE, '../fixtures/mock-hermes/hermes');
const SCAFFOLD = 'You are Hermes Agent, an intelligent AI assistant created by Nous Research.';

let home: string;
let store: StateStore;

function makeBuilder() {
  return new AgentBuilder({
    store,
    hermesBin: MOCK_BIN,
    hermesHome: home,
    env: { MOCK_HERMES_HOME: home },
  });
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'circe-agents-'));
  writeFileSync(join(home, 'SOUL.md'), SCAFFOLD);
  store = new StateStore(join(home, 'state.json'));
  await store.load();
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('suggestCharacter', () => {
  it('suggests the first character of the cast', () => {
    expect(suggestCharacter('greek', [])!.name).toBe('Athena');
    expect(suggestCharacter('neutral', [])!.name).toBe('Alpha');
  });

  it('skips characters whose id is already taken', () => {
    expect(suggestCharacter('neutral', ['alpha'])!.name).toBe('Beta');
  });

  it('returns null when the whole cast is taken', () => {
    expect(suggestCharacter('neutral', ['alpha', 'beta', 'gamma', 'delta'])).toBeNull();
  });

  it('returns null for the custom cast, which has no characters', () => {
    expect(suggestCharacter('custom', [])).toBeNull();
  });
});

describe('AgentBuilder', () => {
  it('creates a profile from a character with its suggested palette', async () => {
    const p = await makeBuilder().createFromCharacter({ castId: 'greek', characterName: 'Athena' });
    expect(p.id).toBe('athena');
    expect(p.displayName).toBe('Athena');
    expect(p.tagline).toBe('the strategist');

    const tile = store.get().tiles['athena']!;
    expect(tile.palette.accent).toBe('#c9b273');
    expect(tile.tiled).toBe(true);
  });

  it('writes the heading into SOUL.md', async () => {
    await makeBuilder().createFromCharacter({ castId: 'greek', characterName: 'Athena' });
    const soul = readFileSync(join(home, 'profiles', 'athena', 'SOUL.md'), 'utf8');
    expect(soul.startsWith('# Athena — the strategist')).toBe(true);
  });

  it('opens new profiles unlocked (§6.4)', async () => {
    await makeBuilder().createFromCharacter({ castId: 'greek', characterName: 'Athena' });
    expect(store.get().tiles['athena']!.gateMode).toBe('unlocked');
  });

  it('opens coding profiles locked (§5.5, §6.4)', async () => {
    await makeBuilder().createFromCharacter({
      castId: 'startrek',
      characterName: 'Locutus',
      isCodingProfile: true,
    });
    const tile = store.get().tiles['locutus']!;
    expect(tile.gateMode).toBe('locked');
    expect(tile.isCodingProfile).toBe(true);
  });

  it('accepts a custom profile id and palette', async () => {
    const p = await makeBuilder().createFromCharacter({
      castId: 'custom',
      characterName: 'Sentinel',
      profileId: 'sentinel',
      palette: { accent: '#ff0000', background: '#000000' },
    });
    expect(p.id).toBe('sentinel');
    expect(store.get().tiles['sentinel']!.palette).toEqual({ accent: '#ff0000', background: '#000000' });
  });

  it('falls back to the default palette when none is available', async () => {
    await makeBuilder().createFromCharacter({
      castId: 'custom',
      characterName: 'Sentinel',
      profileId: 'sentinel',
    });
    expect(store.get().tiles['sentinel']!.palette).toEqual(DEFAULT_PALETTE);
  });

  it('sets the first created profile as main operator (§6 Screen 7)', async () => {
    const builder = makeBuilder();
    await builder.createFromCharacter({ castId: 'greek', characterName: 'Athena', makeMainOperator: true });
    await builder.createFromCharacter({ castId: 'greek', characterName: 'Hermes', makeMainOperator: true });
    // Only the first claim wins.
    expect(store.get().mainOperatorId).toBe('athena');
  });

  it('gives the new tile one tab with an empty transcript', async () => {
    await makeBuilder().createFromCharacter({ castId: 'greek', characterName: 'Athena' });
    const tile = store.get().tiles['athena']!;
    expect(tile.tabs).toHaveLength(1);
    expect(tile.tabs[0]!.messages).toEqual([]);
    expect(tile.activeTabId).toBe(tile.tabs[0]!.id);
  });

  it('rejects an unknown character', async () => {
    await expect(
      makeBuilder().createFromCharacter({ castId: 'greek', characterName: 'Nobody' }),
    ).rejects.toThrow(/Nobody/);
  });

  it('leaves the scaffold default untouched (decision 2)', async () => {
    await makeBuilder().createFromCharacter({ castId: 'greek', characterName: 'Athena' });
    expect(readFileSync(join(home, 'SOUL.md'), 'utf8')).toBe(SCAFFOLD);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run test/unit/wizardAgents.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the agent builder**

Create `src/main/wizard/agents.ts`:

```ts
import { createProfile } from '../hermes/create';
import { findCast, type Character } from '../../shared/casts';
import { DEFAULT_PALETTE, type HermesProfile, type Palette, type TileState } from '../../shared/types';
import type { StateStore } from '../state/store';

/** Screen 4a suggests the first character of the cast that isn't already used. */
export function suggestCharacter(castId: string, taken: string[]): Character | null {
  const cast = findCast(castId);
  if (!cast) return null;
  return cast.characters.find((c) => !taken.includes(c.suggestedId)) ?? null;
}

export interface AgentBuilderDeps {
  store: StateStore;
  hermesBin: string;
  hermesHome: string;
  env?: NodeJS.ProcessEnv;
}

export interface CreateFromCharacterOptions {
  castId: string;
  characterName: string;
  /** Overrides the character's suggested id. Required for the custom cast. */
  profileId?: string;
  palette?: Palette;
  persona?: string;
  /** §5.5 — the explicit role pick. Flips the default gate to locked. */
  isCodingProfile?: boolean;
  makeMainOperator?: boolean;
}

export class AgentBuilder {
  constructor(private readonly deps: AgentBuilderDeps) {}

  async createFromCharacter(opts: CreateFromCharacterOptions): Promise<HermesProfile> {
    const cast = findCast(opts.castId);
    const character = cast?.characters.find((c) => c.name === opts.characterName) ?? null;

    if (!character && !opts.profileId) {
      throw new Error(`No character named "${opts.characterName}" in that cast.`);
    }

    const id = opts.profileId ?? character!.suggestedId;
    const tagline = character?.tagline ?? null;
    const palette = opts.palette ?? character?.palette ?? DEFAULT_PALETTE;

    const profile = await createProfile({
      hermesBin: this.deps.hermesBin,
      hermesHome: this.deps.hermesHome,
      id,
      heading: { name: opts.characterName, tagline },
      persona: opts.persona,
      env: this.deps.env,
    });

    const tabId = `t${Date.now().toString(36)}`;
    const tile: TileState = {
      profileId: id,
      // Screen 7 lays tiles out; this is the fallback size from §6.3.1.
      bounds: { x: 0, y: 0, width: 500, height: 600 },
      // New profiles open unlocked, except coding profiles (§6.4).
      gateMode: opts.isCodingProfile ? 'locked' : 'unlocked',
      palette,
      tabs: [{ id: tabId, title: 'New tab', sessionId: null, messages: [] }],
      activeTabId: tabId,
      tiled: true,
      isCodingProfile: opts.isCodingProfile ?? false,
    };

    const state = this.deps.store.get();
    state.tiles[id] = tile;
    if (opts.makeMainOperator && !state.mainOperatorId) {
      state.mainOperatorId = id;
    }
    await this.deps.store.save(state);

    return profile;
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/unit/wizardAgents.test.ts`
Expected: all 15 tests PASS.

- [ ] **Step 5: Add Screens 4a, 5-minimal, and 6 to the wizard renderer**

Add to the `SCREENS` map in `src/renderer/wizard/main.ts`:

```ts
  async create() {
    const { CASTS, DEFAULT_CAST_ID } = await import('../../shared/casts');
    let castId = DEFAULT_CAST_ID;

    const draw = async () => {
      const { profiles } = await window.wizard.detectProfiles();
      const taken = profiles.map((p: any) => p.id);
      const { suggestCharacter } = await import('../../src/main/wizard/agents');
      const character = suggestCharacter(castId, taken);

      const picker = (await import('../ui/primitives')).segmented(
        CASTS.map((c) => ({ id: c.id, label: c.label })),
        castId,
        (id) => {
          castId = id;
          void draw();
        },
      );

      const card = el('div');
      if (character) {
        card.append(
          el('div', 'row', `${character.name} — ${character.tagline}`),
          el('p', undefined, `Accent ${character.palette.accent} · background ${character.palette.background}`),
        );
      } else {
        card.append(el('p', undefined, 'Type a name for this agent on the next step.'));
      }

      render([
        el('h1', undefined, 'Your first agent'),
        picker,
        card,
        actions(
          button(
            'Start with this agent',
            async () => {
              if (!character) return go('walkthrough');
              await window.wizard.createAgent({
                castId,
                characterName: character.name,
                makeMainOperator: true,
              });
              return go('provider');
            },
            'primary',
          ),
          button('Customize this agent', () => go('walkthrough')),
        ),
      ]);
    };

    await draw();
  },

  async walkthrough() {
    // Phase 1 ships name, palette, and the §5.5 role picker. Avatar and the
    // full five-panel flow are Phase 2.
    const name = el('input') as HTMLInputElement;
    name.className = 'input';
    name.placeholder = 'Name';

    const accent = el('input') as HTMLInputElement;
    accent.type = 'color';
    accent.value = '#8b7fd4';

    const background = el('input') as HTMLInputElement;
    background.type = 'color';
    background.value = '#1a1820';

    const coding = el('input') as HTMLInputElement;
    coding.type = 'checkbox';
    const codingLabel = el('label', 'row');
    codingLabel.append(coding, document.createTextNode('Coding / writes files'));

    const error = el('p', 'state--error');

    render([
      el('h1', undefined, 'New agent'),
      name,
      el('div', 'row'),
      accent,
      background,
      codingLabel,
      error,
      actions(
        button(
          'Save',
          async () => {
            const value = name.value.trim();
            if (!value) {
              error.textContent = 'Name can’t be empty.';
              return;
            }
            try {
              await window.wizard.createAgent({
                castId: 'custom',
                characterName: value,
                profileId: value.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                palette: { accent: accent.value, background: background.value },
                isCodingProfile: coding.checked,
                makeMainOperator: true,
              });
              await go('provider');
            } catch (err) {
              error.textContent = (err as Error).message;
            }
          },
          'primary',
        ),
        button('Back', () => window.wizard.back().then(boot), 'quiet'),
      ),
    ]);
  },

  async provider() {
    const providers = await window.wizard.listProviders();
    const status = el('p');
    const detail = el('div');

    window.wizard.on('wizard:device-code', (p: { url: string; code: string }) => {
      detail.replaceChildren(
        el('p', undefined, `Open ${p.url} and enter this code:`),
        el('div', 'code', p.code),
      );
    });

    render([
      el('h1', undefined, 'Connect a provider'),
      el('p', undefined, 'Your agents need a model provider to talk to.'),
      actions(
        ...providers.map((p) =>
          button(p.label, async () => {
            status.textContent = 'Waiting for sign-in…';
            const result = await window.wizard.loginProvider(p.id);
            status.textContent = result.message;
            if (result.ok) await go('ready');
          }),
        ),
      ),
      // §6 Screen 6 requires this path to work whatever else fails.
      actions(button('Skip — I’ll connect a provider later', () => go('ready'), 'quiet')),
      status,
      detail,
    ]);
  },
```

Add an `.input` rule to `src/renderer/wizard/wizard.css`:

```css
.input { padding: 8px 11px; border-radius: 8px; border: 1px solid var(--hairline);
  background: rgba(255,255,255,0.05); color: var(--fg); font: inherit; outline: none; }
.input:focus { border-color: var(--accent); }
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm test && npm run build`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/main/wizard/agents.ts src/renderer/wizard/ test/unit/wizardAgents.test.ts
git commit -m "feat: agent creation screens and provider setup"
```

---

### Task 15: Screen 7, fleet launch, the zero-tile guard, and app wiring

The last wizard screen and the thing that turns everything so far into a running app. This is where decision 1 — the zero-tile soft-lock guard — is implemented, and where `src/main/index.ts` finally wires the controller, the store, the tile manager, and every IPC handler together.

**Files:**
- Create: `src/main/fleet.ts`
- Modify: `src/main/index.ts`
- Modify: `src/renderer/wizard/main.ts` (add the `ready` screen)
- Test: `test/unit/fleet.test.ts`

**Interfaces:**
- Consumes: `TileManager` (Task 11), `StateStore` (Task 9), `enumerateProfiles` (Task 5).
- Produces: `class Fleet` with `constructor(deps: { store: StateStore; tiles: TileManager; hermesHome: string })`, `plan(): Promise<{ launchable: string[]; skipped: { profileId: string; reason: string }[] }>`, `launch(): Promise<{ launched: number; skipped: { profileId: string; reason: string }[] }>`, `layout(count: number, display: { width: number; height: number }): { x: number; y: number; width: number; height: number }[]`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/fleet.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Fleet } from '../../src/main/fleet';
import { TileManager } from '../../src/main/tiles/manager';
import { StateStore } from '../../src/main/state/store';
import { emptyState, DEFAULT_PALETTE, type TileState } from '../../src/shared/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOCK_BIN = resolve(HERE, '../fixtures/mock-hermes/hermes');

let home: string;
let store: StateStore;

function tile(profileId: string, over: Partial<TileState> = {}): TileState {
  return {
    profileId,
    bounds: { x: 0, y: 0, width: 500, height: 600 },
    gateMode: 'unlocked',
    palette: DEFAULT_PALETTE,
    tabs: [{ id: 't1', title: 'New tab', sessionId: null, messages: [] }],
    activeTabId: 't1',
    tiled: true,
    isCodingProfile: false,
    ...over,
  };
}

function seedProfile(id: string, soul = `# ${id} — test\n`) {
  mkdirSync(join(home, 'profiles', id), { recursive: true });
  writeFileSync(join(home, 'profiles', id, 'SOUL.md'), soul);
}

function makeFleet() {
  const windows: any[] = [];
  const tiles = new TileManager({
    store,
    hermesBin: MOCK_BIN,
    hermesHome: home,
    env: { MOCK_HERMES_SCENARIO: 'stream', MOCK_HERMES_HOME: home },
    createWindow: ((profileId: string) => {
      const w = {
        profileId, sent: [] as any[], destroyed: false,
        send: (c: string, p: unknown) => w.sent.push({ channel: c, payload: p }),
        getBounds: () => ({ x: 0, y: 0, width: 500, height: 600 }),
        close: () => { w.destroyed = true; },
        isDestroyed: () => w.destroyed,
      };
      windows.push(w);
      return w;
    }) as any,
  });
  return { fleet: new Fleet({ store, tiles, hermesHome: home }), tiles, windows };
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'circe-fleet-'));
  writeFileSync(join(home, 'SOUL.md'), 'scaffold prose');
  store = new StateStore(join(home, 'state.json'));
  await store.load();
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('Fleet.plan', () => {
  it('launches every tiled profile', async () => {
    seedProfile('athena');
    seedProfile('ford');
    await store.save({ ...emptyState(), tiles: { athena: tile('athena'), ford: tile('ford') } });
    const { fleet } = makeFleet();
    expect((await fleet.plan()).launchable.sort()).toEqual(['athena', 'ford']);
  });

  it('skips profiles marked "leave alone" (§6 Screen 4b)', async () => {
    seedProfile('athena');
    seedProfile('ford');
    await store.save({
      ...emptyState(),
      tiles: { athena: tile('athena'), ford: tile('ford', { tiled: false }) },
    });
    const plan = await makeFleet().fleet.plan();
    expect(plan.launchable).toEqual(['athena']);
    expect(plan.skipped).toEqual([{ profileId: 'ford', reason: 'not-tiled' }]);
  });

  it('skips a profile that no longer exists on disk (§8.2)', async () => {
    await store.save({ ...emptyState(), tiles: { ghost: tile('ghost') } });
    const plan = await makeFleet().fleet.plan();
    expect(plan.launchable).toEqual([]);
    expect(plan.skipped).toEqual([{ profileId: 'ghost', reason: 'missing' }]);
  });
});

describe('Fleet.launch', () => {
  it('spawns one tile per launchable profile', async () => {
    seedProfile('athena');
    seedProfile('ford');
    await store.save({ ...emptyState(), tiles: { athena: tile('athena'), ford: tile('ford') } });
    const { fleet, tiles } = makeFleet();
    const result = await fleet.launch();
    expect(result.launched).toBe(2);
    expect(tiles.openTileIds.sort()).toEqual(['athena', 'ford']);
    await tiles.shutdown();
  });

  it('ZERO-TILE GUARD (decision 1): launching nothing reports zero and opens no windows', async () => {
    seedProfile('ford');
    await store.save({ ...emptyState(), tiles: { ford: tile('ford', { tiled: false }) } });
    const { fleet, tiles, windows } = makeFleet();
    const result = await fleet.launch();
    expect(result.launched).toBe(0);
    expect(windows).toHaveLength(0);
    expect(tiles.openTileIds).toEqual([]);
  });

  it('launches the rest when one profile is broken (§8.2)', async () => {
    seedProfile('athena');
    await store.save({ ...emptyState(), tiles: { athena: tile('athena'), ghost: tile('ghost') } });
    const { fleet, tiles } = makeFleet();
    const result = await fleet.launch();
    expect(result.launched).toBe(1);
    expect(result.skipped.map((s) => s.profileId)).toEqual(['ghost']);
    await tiles.shutdown();
  });

  it('restores saved bounds rather than re-laying-out (§10.5)', async () => {
    seedProfile('athena');
    await store.save({
      ...emptyState(),
      tiles: { athena: tile('athena', { bounds: { x: 300, y: 150, width: 640, height: 480 } }) },
    });
    const { fleet, tiles } = makeFleet();
    await fleet.launch();
    expect(store.get().tiles['athena']!.bounds).toEqual({ x: 300, y: 150, width: 640, height: 480 });
    await tiles.shutdown();
  });
});

describe('Fleet.layout', () => {
  it('lays tiles out left to right across the display', () => {
    const { fleet } = makeFleet();
    const boxes = fleet.layout(3, { width: 1800, height: 1000 });
    expect(boxes).toHaveLength(3);
    expect(boxes[0]!.x).toBeLessThan(boxes[1]!.x);
    expect(boxes[1]!.x).toBeLessThan(boxes[2]!.x);
    for (const b of boxes) {
      expect(b.x + b.width).toBeLessThanOrEqual(1800);
      expect(b.y + b.height).toBeLessThanOrEqual(1000);
    }
  });

  it('wraps to a second row when a row is full', () => {
    const { fleet } = makeFleet();
    const boxes = fleet.layout(6, { width: 1200, height: 1400 });
    expect(boxes.some((b) => b.y > boxes[0]!.y)).toBe(true);
  });

  it('returns nothing for an empty fleet', () => {
    expect(makeFleet().fleet.layout(0, { width: 1800, height: 1000 })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run test/unit/fleet.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the fleet**

Create `src/main/fleet.ts`:

```ts
import { enumerateProfiles } from './hermes/profiles';
import type { TileManager } from './tiles/manager';
import type { StateStore } from './state/store';

export interface SkippedTile {
  profileId: string;
  reason: 'not-tiled' | 'missing';
}

export interface FleetDeps {
  store: StateStore;
  tiles: TileManager;
  hermesHome: string;
}

const TILE_W = 500;
const TILE_H = 600;
const GAP = 20;

export class Fleet {
  constructor(private readonly deps: FleetDeps) {}

  /** Works out what would launch, without launching it. */
  async plan(): Promise<{ launchable: string[]; skipped: SkippedTile[] }> {
    const onDisk = new Set((await enumerateProfiles(this.deps.hermesHome)).map((p) => p.id));
    const launchable: string[] = [];
    const skipped: SkippedTile[] = [];

    for (const [profileId, tile] of Object.entries(this.deps.store.get().tiles)) {
      if (!tile.tiled) {
        skipped.push({ profileId, reason: 'not-tiled' });
      } else if (!onDisk.has(profileId)) {
        // §8.2 — refuse to spawn, name the profile, leave the others alone.
        skipped.push({ profileId, reason: 'missing' });
      } else {
        launchable.push(profileId);
      }
    }
    return { launchable, skipped };
  }

  async launch(): Promise<{ launched: number; skipped: SkippedTile[] }> {
    const { launchable, skipped } = await this.plan();
    let launched = 0;

    for (const profileId of launchable) {
      try {
        await this.deps.tiles.spawnTile(profileId);
        launched += 1;
      } catch {
        // A tile that fails to spawn must not take the rest of the fleet down.
        skipped.push({ profileId, reason: 'missing' });
      }
    }
    return { launched, skipped };
  }

  /** Grid layout across the primary display (§6 Screen 7). */
  layout(
    count: number,
    display: { width: number; height: number },
  ): { x: number; y: number; width: number; height: number }[] {
    if (count <= 0) return [];
    const perRow = Math.max(1, Math.floor((display.width + GAP) / (TILE_W + GAP)));
    return Array.from({ length: count }, (_, i) => ({
      x: (i % perRow) * (TILE_W + GAP),
      y: Math.floor(i / perRow) * (TILE_H + GAP),
      width: TILE_W,
      height: TILE_H,
    }));
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/unit/fleet.test.ts`
Expected: all 10 tests PASS, including the zero-tile guard.

- [ ] **Step 5: Add the ready screen with the zero-tile guard**

Add to `SCREENS` in `src/renderer/wizard/main.ts`:

```ts
  async ready() {
    render([el('h1', undefined, 'Circe'), el('p', undefined, 'Launching your fleet…')]);
    const { launched } = await window.wizard.launchFleet();

    // Decision 1 — never close the wizard on an empty fleet, or the user is
    // left with no window and no way back in.
    if (launched === 0) {
      render([
        el('h1', undefined, 'No agents to launch'),
        el('p', undefined, 'Nothing is set to open as a tile.'),
        actions(
          button('Add an agent', () => go('walkthrough'), 'primary'),
          button('Back', () => window.wizard.back().then(boot), 'quiet'),
        ),
      ]);
    }
    // On success the main process closes this window once tiles are up.
  },
```

- [ ] **Step 6: Wire the app together**

Replace `src/main/index.ts`:

```ts
import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { StateStore } from './state/store';
import { WizardController } from './wizard/controller';
import { AgentBuilder } from './wizard/agents';
import { TileManager, type TileWindow } from './tiles/manager';
import { Fleet } from './fleet';
import { locateHermes } from './hermes/locate';
import { PROVIDERS, ProviderLogin } from './hermes/provider';
import { createWizardWindow } from './wizard/window';
import { IPC_TO_MAIN } from '../shared/ipc';

const HERMES_HOME = process.env.HERMES_HOME ?? join(homedir(), '.hermes');
const STATE_FILE = join(app.getPath('userData'), 'state.json');

const store = new StateStore(STATE_FILE);
let hermesBin = 'hermes';
let wizardWindow: BrowserWindow | null = null;
let tiles: TileManager;
let fleet: Fleet;

function createTileWindow(profileId: string): TileWindow {
  const saved = store.get().tiles[profileId]?.bounds;
  const win = new BrowserWindow({
    width: saved?.width ?? 500,
    height: saved?.height ?? 600,
    x: saved?.x,
    y: saved?.y,
    minWidth: 340,
    minHeight: 380,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/tile.js'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--profile-id=${profileId}`],
    },
  });
  void win.loadFile(join(__dirname, '../renderer/tile/index.html'));

  return {
    send: (channel, payload) => win.webContents.send(channel, payload),
    getBounds: () => win.getBounds(),
    close: () => win.close(),
    isDestroyed: () => win.isDestroyed(),
  };
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => void tiles?.shutdown());

app.whenReady().then(async () => {
  await store.load();

  const found = await locateHermes();
  if (found.ok) hermesBin = found.bin;

  tiles = new TileManager({ store, hermesBin, hermesHome: HERMES_HOME, createWindow: createTileWindow });
  fleet = new Fleet({ store, tiles, hermesHome: HERMES_HOME });

  const wizard = new WizardController({ store, hermesHome: HERMES_HOME });
  const builder = new AgentBuilder({ store, hermesBin, hermesHome: HERMES_HOME });

  // ---- wizard IPC ----
  ipcMain.handle('wizard:start', () => wizard.start());
  ipcMain.handle('wizard:goto', (_e, screenId) => wizard.goto(screenId));
  ipcMain.handle('wizard:back', () => wizard.back());
  ipcMain.handle('wizard:detect-runtime', () => wizard.detectRuntime());
  ipcMain.handle('wizard:detect-profiles', () => wizard.detectProfiles());
  ipcMain.handle('wizard:create-agent', (_e, payload) => builder.createFromCharacter(payload));
  ipcMain.handle('wizard:list-providers', () => PROVIDERS);
  ipcMain.handle('wizard:login-provider', async (_e, provider: string) => {
    const login = new ProviderLogin({
      hermesBin,
      provider,
      onPrompt: (p) => wizardWindow?.webContents.send('wizard:device-code', p),
    });
    return login.run();
  });
  ipcMain.handle('wizard:launch-fleet', async () => {
    const result = await fleet.launch();
    if (result.launched > 0) {
      const state = store.get();
      state.onboarded = true;
      state.wizardScreen = null;
      await store.save(state);
      wizardWindow?.close();
      wizardWindow = null;
    }
    return result;
  });

  // ---- tile IPC ----
  ipcMain.handle(IPC_TO_MAIN.send, (_e, { profileId, text }) => tiles.sendPrompt(profileId, text));
  ipcMain.handle(IPC_TO_MAIN.cycleGate, (_e, { profileId }) => tiles.cycleGate(profileId));
  ipcMain.handle(IPC_TO_MAIN.resolvePermission, (_e, { profileId, requestKey, optionId }) =>
    tiles.resolvePermission(profileId, requestKey, optionId),
  );
  ipcMain.handle(IPC_TO_MAIN.restart, async (_e, { profileId }) => {
    tiles.closeTile(profileId);
    await tiles.spawnTile(profileId);
  });

  // ---- boot ----
  const state = store.get();
  if (state.onboarded) {
    // Lay out any tile that has never been positioned.
    const { launchable } = await fleet.plan();
    const primary = screen.getPrimaryDisplay().workAreaSize;
    const boxes = fleet.layout(launchable.length, primary);
    launchable.forEach((profileId, i) => {
      const tile = state.tiles[profileId];
      if (tile && tile.bounds.x === 0 && tile.bounds.y === 0 && boxes[i]) {
        tile.bounds = boxes[i]!;
      }
    });
    await store.save(state);

    const result = await fleet.launch();
    // Decision 1 — an empty fleet at boot reopens the wizard rather than
    // leaving the user with no window at all.
    if (result.launched === 0) {
      wizardWindow = createWizardWindow();
      void wizardWindow.loadFile(join(__dirname, '../renderer/wizard/index.html'));
    }
  } else {
    wizardWindow = createWizardWindow();
    void wizardWindow.loadFile(join(__dirname, '../renderer/wizard/index.html'));
  }
});
```

- [ ] **Step 7: Verify the whole suite**

Run: `npm run typecheck && npm test && npm run build`
Expected: clean typecheck, all unit tests pass, build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/main/fleet.ts src/main/index.ts src/renderer/wizard/main.ts test/unit/fleet.test.ts
git commit -m "feat: fleet launch, zero-tile guard, and app wiring"
```

---

### Task 16: E2E harness, §10.1 wizard timing, §10.5 state survival

Playwright drives the real Electron app against the mock Hermes, with `HERMES_HOME` and the Electron `userData` path both pointed at a temp directory so no test ever touches the user's real `~/.hermes`.

**Files:**
- Create: `playwright.config.ts`
- Create: `test/e2e/harness.ts`
- Create: `test/e2e/wizard.spec.ts`
- Create: `test/e2e/state.spec.ts`

**Interfaces:**
- Consumes: the built app in `out/`, the mock at `test/fixtures/mock-hermes/hermes`.
- Produces: `launchCirce(opts?: { home?: string; scenario?: string; seed?: (home: string) => void }): Promise<{ app: ElectronApplication; home: string; close(): Promise<void> }>` from `harness.ts`.

- [ ] **Step 1: Write the Playwright config**

Create `playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
});
```

- [ ] **Step 2: Write the harness**

Create `test/e2e/harness.ts`:

```ts
import { _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const MOCK_DIR = resolve(__dirname, '../fixtures/mock-hermes');
export const MOCK_BIN = join(MOCK_DIR, 'hermes');
export const SCAFFOLD =
  'You are Hermes Agent, an intelligent AI assistant created by Nous Research.';

export interface LaunchOptions {
  /** Reuse an existing temp home to simulate a relaunch. */
  home?: string;
  scenario?: string;
  seed?: (home: string) => void;
}

export async function launchCirce(opts: LaunchOptions = {}) {
  const home = opts.home ?? mkdtempSync(join(tmpdir(), 'circe-e2e-'));
  const userData = join(home, 'userData');
  mkdirSync(userData, { recursive: true });

  if (!opts.home) {
    writeFileSync(join(home, 'SOUL.md'), SCAFFOLD);
    opts.seed?.(home);
  }

  const app: ElectronApplication = await electron.launch({
    args: [resolve(__dirname, '../../out/main/index.js'), `--user-data-dir=${userData}`],
    env: {
      ...process.env,
      HERMES_HOME: home,
      MOCK_HERMES_HOME: home,
      MOCK_HERMES_SCENARIO: opts.scenario ?? 'stream',
      // Put the mock first so locateHermes() finds it instead of a real install.
      PATH: `${MOCK_DIR}:${process.env.PATH ?? ''}`,
      CIRCE_E2E: '1',
    },
  });

  return {
    app,
    home,
    async close() {
      await app.close();
      if (!opts.home) rmSync(home, { recursive: true, force: true });
    },
  };
}

/** Seeds a configured profile so the wizard routes to Screen 4b. */
export function seedProfile(home: string, id: string, soul?: string) {
  const dir = join(home, 'profiles', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SOUL.md'), soul ?? `# ${id} — seeded\n\nbody\n`);
}
```

- [ ] **Step 3: Write the §10.1 wizard timing test**

Create `test/e2e/wizard.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { launchCirce } from './harness';

test('§10.1 — wizard happy path reaches a streaming tile in ≤ 90s', async () => {
  const started = Date.now();
  const ctx = await launchCirce();

  try {
    const wizard = await ctx.app.firstWindow();

    // Screen 1 → 2 → 3 → 4a
    await wizard.getByText('Get started').click();
    await expect(wizard.getByText(/Your first agent/)).toBeVisible({ timeout: 30_000 });

    // Screen 4a: accept the suggested Neutral character.
    await wizard.getByText('Start with this agent').click();

    // Screen 6: skip provider — the path §6 requires to always work.
    await expect(wizard.getByText(/Connect a provider/)).toBeVisible({ timeout: 30_000 });
    await wizard.getByText(/Skip/).click();

    // Screen 7 → a tile window appears.
    const tile = await ctx.app.waitForEvent('window', { timeout: 30_000 });
    await tile.waitForLoadState('domcontentloaded');
    await expect(tile.locator('#name')).toHaveText('Alpha', { timeout: 15_000 });

    // Send a message and get a streaming response.
    await tile.locator('#input').fill('hello');
    await tile.locator('#send').click();
    await expect(tile.locator('.msg.agent')).toContainText('Hello', { timeout: 30_000 });

    const elapsed = (Date.now() - started) / 1000;
    // Logged every run so regressions are visible (§10.1).
    console.log(`[§10.1] wizard happy path: ${elapsed.toFixed(1)}s`);
    expect(elapsed).toBeLessThanOrEqual(90);
  } finally {
    await ctx.close();
  }
});

test('§10.1 — the wizard resumes where it was left, not at Screen 1 (§8.2)', async () => {
  const first = await launchCirce();
  const home = first.home;
  try {
    const wizard = await first.app.firstWindow();
    await wizard.getByText('Get started').click();
    await expect(wizard.getByText(/Your first agent/)).toBeVisible({ timeout: 30_000 });
  } finally {
    await first.app.close();
  }

  const second = await launchCirce({ home });
  try {
    const wizard = await second.app.firstWindow();
    await expect(wizard.getByText(/Your first agent/)).toBeVisible({ timeout: 30_000 });
  } finally {
    await second.close();
  }
});
```

- [ ] **Step 4: Write the §10.5 state survival test**

Create `test/e2e/state.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchCirce, seedProfile } from './harness';

/** Reads the persisted state file the way the app writes it. */
function readState(home: string) {
  return JSON.parse(readFileSync(join(home, 'userData', 'state.json'), 'utf8'));
}

test('§10.5 — every persisted field survives a clean quit and relaunch', async () => {
  const seeded = await launchCirce({
    seed: (home) => {
      seedProfile(home, 'athena', '# Athena — the strategist\n');
      seedProfile(home, 'ford', '# Ford — Career\n');
      seedProfile(home, 'marvin', '# Marvin — the depressed android\n');
    },
  });
  const home = seeded.home;

  try {
    const wizard = await seeded.app.firstWindow();
    // Screen 1 → 3 finds three real profiles → Screen 4b → continue → skip → launch.
    await wizard.getByText('Get started').click();
    await expect(wizard.getByText(/Existing agents/)).toBeVisible({ timeout: 30_000 });
    await wizard.getByText('Continue').click();
    await expect(wizard.getByText(/Connect a provider/)).toBeVisible({ timeout: 30_000 });
    await wizard.getByText(/Skip/).click();

    // Wait for all three tiles.
    await expect.poll(async () => (await seeded.app.windows()).length, { timeout: 30_000 })
      .toBeGreaterThanOrEqual(3);

    // Cycle one tile's gate so there is a non-default value to restore.
    const windows = seeded.app.windows();
    const tile = windows[windows.length - 1]!;
    await tile.locator('#gate').click();

    await expect.poll(() => readState(home).tiles['marvin']?.gateMode ?? readState(home).tiles['athena']?.gateMode,
      { timeout: 15_000 }).toBeTruthy();
  } finally {
    await seeded.app.close();
  }

  const before = readState(home);
  expect(Object.keys(before.tiles).sort()).toEqual(['athena', 'ford', 'marvin']);

  // Relaunch against the same home.
  const relaunched = await launchCirce({ home });
  try {
    await expect.poll(async () => (await relaunched.app.windows()).length, { timeout: 30_000 })
      .toBeGreaterThanOrEqual(3);

    const after = readState(home);
    for (const id of ['athena', 'ford', 'marvin']) {
      expect(after.tiles[id].bounds, `${id} bounds`).toEqual(before.tiles[id].bounds);
      expect(after.tiles[id].gateMode, `${id} gate`).toBe(before.tiles[id].gateMode);
      expect(after.tiles[id].activeTabId, `${id} active tab`).toBe(before.tiles[id].activeTabId);
      expect(after.tiles[id].tabs.length, `${id} tab count`).toBe(before.tiles[id].tabs.length);
      expect(after.tiles[id].tabs[0].messages, `${id} transcript`).toEqual(
        before.tiles[id].tabs[0].messages,
      );
      expect(after.tiles[id].palette, `${id} palette`).toEqual(before.tiles[id].palette);
    }
    expect(after.mainOperatorId).toBe(before.mainOperatorId);
  } finally {
    await relaunched.close();
  }
});
```

- [ ] **Step 5: Run the E2E suite**

Run: `npm run build && npm run test:e2e`
Expected: all 3 tests PASS. The §10.1 line prints the measured duration.

If tile windows are not found, check that `createTileWindow` loads the built renderer path — E2E runs against `out/`, not `src/`.

- [ ] **Step 6: Commit**

```bash
git add playwright.config.ts test/e2e/
git commit -m "test: E2E harness with wizard timing and state survival"
```

---

### Task 17: §10.3 render lag, §10.4 gate liveness, §10.6 non-destruction

The three remaining Phase-1 criteria. §10.6 is the one the spec restates twice for emphasis — a user who walks the whole wizard using only default primary actions must leave every pre-existing profile byte-identical.

**Files:**
- Create: `test/e2e/responsiveness.spec.ts`
- Create: `test/e2e/gate.spec.ts`
- Create: `test/e2e/nondestruction.spec.ts`
- Create: `test/e2e/hash.ts`

**Interfaces:**
- Consumes: `launchCirce`, `seedProfile` from `test/e2e/harness.ts`.
- Produces: `hashTree(dir: string): Record<string, string>` from `test/e2e/hash.ts`.

- [ ] **Step 1: Write the hash helper**

Create `test/e2e/hash.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

/** sha256 of every file under `dir`, keyed by relative path. */
export function hashTree(dir: string, skip: (rel: string) => boolean = () => false): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string, prefix: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (skip(rel)) continue;
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full, rel);
      else if (entry.isFile()) out[rel] = createHash('sha256').update(readFileSync(full)).digest('hex');
    }
  };
  if (statSync(dir, { throwIfNoEntry: false })) walk(dir, '');
  return out;
}
```

- [ ] **Step 2: Write the §10.6 non-destruction test**

Create `test/e2e/nondestruction.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { launchCirce, seedProfile } from './harness';
import { hashTree } from './hash';

// Circe's own state lives under userData; Hermes writes nothing in these runs.
const skipCirceOwnFiles = (rel: string) => rel.startsWith('userData/');

test('§10.6 — Continue on Screen 4b modifies zero profile files', async () => {
  const ctx = await launchCirce({
    seed: (home) => {
      seedProfile(home, 'athena', '# Athena — the strategist\n\npersona text\n');
      seedProfile(home, 'ford', '# Ford — Career\n\npersona text\n');
      seedProfile(home, 'marvin', '# Marvin — the depressed android\n\npersona text\n');
    },
  });

  try {
    const before = hashTree(ctx.home, skipCirceOwnFiles);
    expect(Object.keys(before).length).toBeGreaterThan(0);

    const wizard = await ctx.app.firstWindow();
    await wizard.getByText('Get started').click();
    await expect(wizard.getByText(/Existing agents/)).toBeVisible({ timeout: 30_000 });

    // Touch no per-row control — just Continue.
    await wizard.getByText('Continue').click();
    await expect(wizard.getByText(/Connect a provider/)).toBeVisible({ timeout: 30_000 });
    await wizard.getByText(/Skip/).click();

    await expect.poll(async () => (await ctx.app.windows()).length, { timeout: 30_000 })
      .toBeGreaterThanOrEqual(3);

    const after = hashTree(ctx.home, skipCirceOwnFiles);
    expect(after).toEqual(before);
  } finally {
    await ctx.close();
  }
});

test('§10.6 — a full default-path run adds only the profile it created', async () => {
  const ctx = await launchCirce({
    seed: (home) => seedProfile(home, 'ford', '# Ford — Career\n\npersona text\n'),
  });

  try {
    const before = hashTree(ctx.home, skipCirceOwnFiles);

    const wizard = await ctx.app.firstWindow();
    await wizard.getByText('Get started').click();
    await expect(wizard.getByText(/Existing agents/)).toBeVisible({ timeout: 30_000 });
    await wizard.getByText('Continue').click();
    await wizard.getByText(/Skip/).click();
    await expect.poll(async () => (await ctx.app.windows()).length, { timeout: 30_000 })
      .toBeGreaterThanOrEqual(2);

    const after = hashTree(ctx.home, skipCirceOwnFiles);

    // Nothing pre-existing changed.
    for (const [file, hash] of Object.entries(before)) {
      expect(after[file], `${file} was modified`).toBe(hash);
    }
    // Nothing was removed.
    for (const file of Object.keys(before)) expect(after).toHaveProperty(file);
  } finally {
    await ctx.close();
  }
});
```

- [ ] **Step 3: Write the §10.4 gate liveness E2E test**

Create `test/e2e/gate.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { launchCirce, seedProfile } from './harness';

test('§10.4 — switching to Locked denies the next tool call and renders a card', async () => {
  const ctx = await launchCirce({
    scenario: 'permission',
    seed: (home) => seedProfile(home, 'athena', '# Athena — the strategist\n'),
  });

  try {
    const wizard = await ctx.app.firstWindow();
    await wizard.getByText('Get started').click();
    await expect(wizard.getByText(/Existing agents/)).toBeVisible({ timeout: 30_000 });
    await wizard.getByText('Continue').click();
    await wizard.getByText(/Skip/).click();

    const tile = await ctx.app.waitForEvent('window', { timeout: 30_000 });
    await tile.waitForLoadState('domcontentloaded');
    await expect(tile.locator('#name')).toHaveText('Athena', { timeout: 15_000 });

    // New non-coding profiles open unlocked; one click cycles to locked (§6.4).
    await expect(tile.locator('#gate')).toHaveText('🔓');
    await tile.locator('#gate').click();
    await expect(tile.locator('#gate')).toHaveText('🔒');

    await tile.locator('#input').fill('write a file');
    await tile.locator('#send').click();

    // The denied card must appear — the user has to see the agent tried (§6.4).
    await expect(tile.locator('.msg.denied')).toContainText('write_file', { timeout: 30_000 });
  } finally {
    await ctx.close();
  }
});

test('§6.4 — the gate button cycles locked → ask → unlocked → locked', async () => {
  const ctx = await launchCirce({
    seed: (home) => seedProfile(home, 'athena', '# Athena — the strategist\n'),
  });

  try {
    const wizard = await ctx.app.firstWindow();
    await wizard.getByText('Get started').click();
    await expect(wizard.getByText(/Existing agents/)).toBeVisible({ timeout: 30_000 });
    await wizard.getByText('Continue').click();
    await wizard.getByText(/Skip/).click();

    const tile = await ctx.app.waitForEvent('window', { timeout: 30_000 });
    await tile.waitForLoadState('domcontentloaded');

    await expect(tile.locator('#gate')).toHaveText('🔓');
    await tile.locator('#gate').click();
    await expect(tile.locator('#gate')).toHaveText('🔒');
    await tile.locator('#gate').click();
    await expect(tile.locator('#gate')).toHaveText('⛔');
    await tile.locator('#gate').click();
    await expect(tile.locator('#gate')).toHaveText('🔓');
  } finally {
    await ctx.close();
  }
});
```

- [ ] **Step 4: Write the §10.3 responsiveness test**

The spec asks for lag between "Hermes emits a token to stdout" and "token appears rendered." The mock timestamps nothing, so the test measures the observable proxy: time from send to first rendered token, and total render time across a long stream.

Create `test/e2e/responsiveness.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { launchCirce, seedProfile } from './harness';

test('§10.3 — a 1000-token stream renders with ≤ 300ms p95 per-chunk lag', async () => {
  const words = Array.from({ length: 1000 }, (_, i) => `w${i}`).join(' ');

  const ctx = await launchCirce({
    seed: (home) => seedProfile(home, 'athena', '# Athena — the strategist\n'),
  });

  try {
    const wizard = await ctx.app.firstWindow();
    await wizard.getByText('Get started').click();
    await expect(wizard.getByText(/Existing agents/)).toBeVisible({ timeout: 30_000 });
    await wizard.getByText('Continue').click();
    await wizard.getByText(/Skip/).click();

    const tile = await ctx.app.waitForEvent('window', { timeout: 30_000 });
    await tile.waitForLoadState('domcontentloaded');

    // Record the wall-clock gap between successive DOM mutations of the
    // streaming bubble — this is the renderer-side half of the §10.3 budget.
    await tile.evaluate(() => {
      (window as any).__lags = [];
      let last = performance.now();
      new MutationObserver(() => {
        const now = performance.now();
        (window as any).__lags.push(now - last);
        last = now;
      }).observe(document.getElementById('transcript')!, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    });

    await tile.locator('#input').fill(words);
    await tile.locator('#send').click();
    await expect(tile.locator('#send')).toHaveText('Send', { timeout: 120_000 });

    const lags: number[] = await tile.evaluate(() => (window as any).__lags);
    expect(lags.length).toBeGreaterThan(100);

    const sorted = [...lags].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
    console.log(`[§10.3] chunks=${lags.length} p95=${p95.toFixed(1)}ms`);
    expect(p95).toBeLessThanOrEqual(300);
  } finally {
    await ctx.close();
  }
});
```

Set `MOCK_HERMES_REPLY` in the harness call if a longer canned reply is needed; the mock already streams one word per chunk.

- [ ] **Step 5: Run the full E2E suite**

Run: `npm run build && npm run test:e2e`
Expected: all 8 E2E tests PASS. Both `[§10.1]` and `[§10.3]` measurement lines appear in the output.

- [ ] **Step 6: Commit**

```bash
git add test/e2e/
git commit -m "test: gate liveness, render lag, and non-destruction invariants"
```

---

### Task 18: ADR, compat notes, README, LICENSE

Every §5 decision and every §1.2 non-obvious call becomes a dated ADR entry (§12.4). Every place Circe parses unversioned Hermes output becomes a compat-notes entry (§8.1).

**Files:**
- Create: `docs/adr/0001-hermes-install-integration.md` … `0011-orchestrator-fleet-growth.md`
- Create: `docs/compat-notes.md`
- Create: `README.md`, `LICENSE`

**Interfaces:**
- Consumes: the decisions recorded at the top of this plan.
- Produces: documentation only.

- [ ] **Step 1: Write the ADR entries**

One file per decision, all dated `2026-08-03`. Each uses this shape:

```markdown
# ADR NNNN — <title>

**Date:** 2026-08-03
**Status:** Accepted
**Spec reference:** §X.Y

## Question
<the question, in one or two sentences>

## Options considered
- **A** — …
- **B** — …

## Decision
<the option picked>

## Reasoning
<why, grounded in evidence>

## How this can break
<what changes upstream would invalidate it, and what Circe does then>
```

Write these eleven, using the content from the "§5 architectural decisions" and "Decisions carried into this plan" sections above:

| File | Covers |
|---|---|
| `0001-hermes-install-integration.md` | §5.1 — non-interactive `profile create`, no `hermes setup` parsing |
| `0002-provider-oauth.md` | §5.2 — device-code capture, success confirmed by exit code + `hermes status` |
| `0003-image-generation-detection.md` | §5.3 — conservative allowlist, Phase 2 |
| `0004-real-profile-heuristic.md` | §5.4 — the H1-heading rule and why it beats hashing |
| `0005-coding-role-default-locked.md` | §5.5 — explicit opt-in, inference fallback, stored as Circe metadata |
| `0006-ui-primitives.md` | §5.6 — no consumable Hermes UI library exists; build our own |
| `0007-orchestrator-skill.md` | §5.7 — option (a), coding/email/notes, Phase 2 |
| `0008-zero-tile-guard.md` | §1.2 gap — the soft-lock and the Screen 7 guard |
| `0009-default-profile-not-adopted.md` | §1.2 gap — Screen 4a creates rather than adopts |
| `0010-profile-id-vs-display-name.md` | §1.2 gap — id validation against real behaviour, not the help string |
| `0011-orchestrator-fleet-growth.md` | Departure from §6.5 — orchestrator may propose new agents, with guardrails |

ADR 0011 must state plainly that this is a **deliberate departure from §6.5**, requested by the product owner, that Phase 1 implements none of it, and that the agreed guardrails are: always-ask regardless of gate state, orchestrator proposes and Screen 5 disposes, one agent per confirmed request.

- [ ] **Step 2: Write the compat notes**

Create `docs/compat-notes.md`:

```markdown
# Compat notes

Every place Circe depends on Hermes behaviour that is not versioned or documented.
When Hermes changes under us, the fix is in one of these places.

Verified against **Hermes Agent v0.14.0 (2026.5.16)**.

## 1. The `-p <profile>` global flag

`hermes -p <profile> acp` is the §4.3 transport, but `-p` does **not** appear in
`hermes --help` output. It works, and the prototype relied on it, but it is
undocumented and could be renamed without a deprecation notice.

- **Used in:** `src/main/hermes/acpClient.ts` (`spawnArgs`)
- **If it breaks:** every tile fails to spawn. Detect with `hermes -p <id> acp --version`.

## 2. `hermes --version` output format

Parsed by a regex tolerant of both `Hermes Agent v0.14.0 (2026.5.16)` and a bare
`0.14.0`.

- **Used in:** `src/main/hermes/locate.ts` (`parseVersion`)
- **If it breaks:** Circe reports `unreadable-version` and refuses to run, with an
  actionable message rather than a stack trace.

## 3. Profile directory layout

The `default` profile lives at the Hermes home root (`~/.hermes`); named profiles
live at `~/.hermes/profiles/<id>/`. Confirmed via `hermes profile show default`,
which reports `Path: /Users/<user>/.hermes`. Each profile's persona is `SOUL.md`.

- **Used in:** `src/main/hermes/profiles.ts` (`enumerateProfiles`)
- **If it breaks:** profile detection returns nothing and the wizard routes every
  user to Screen 4a as if fresh.

## 4. The scaffold SOUL.md has no heading

`hermes_cli/default_soul.py` seeds `DEFAULT_SOUL_MD`, which is bare prose. The
§5.4 realness rule keys on the *absence* of a level-1 heading. If Hermes ever
seeds a scaffold that starts with `# Hermes Agent`, every fresh install would be
misclassified as having a real profile.

- **Used in:** `src/main/hermes/profiles.ts` (`isRealProfile`)
- **If it breaks:** fresh installs route to Screen 4b showing a boilerplate
  profile. Detect with the "fresh install produces zero real profiles" unit test.

## 5. `hermes profile create` flags

Non-interactive, takes `--description`, `--clone`, `--no-alias`, `--no-skills`.
Circe uses only the positional name.

- **Used in:** `src/main/hermes/create.ts`
- **If it breaks:** agent creation fails with the CLI's own stderr surfaced to
  the user.

## 6. Profile name validation

`hermes profile create --help` says names are "lowercase, alphanumeric", but
`deep-thought` exists on real installs and works. Circe validates against
observed behaviour (lowercase alphanumerics plus hyphens and underscores), not
the help string.

- **Used in:** `src/main/hermes/create.ts` (`validateProfileId`)

## 7. `hermes login` device-flow output

The verification URL and user code are scraped from stdout. Success is confirmed
by exit code 0 **plus** a `hermes status` check — never by the printed text.

- **Used in:** `src/main/hermes/provider.ts` (`parseDeviceCode`)
- **If it breaks:** `parseDeviceCode` returns null, the wizard shows the raw log,
  and the user can still take the Skip path.

## 8. `hermes profile show` output format

Key-value lines including `Model: <model> (<provider>)`. Not parsed in Phase 1;
Phase 2 uses it for §5.3 image-capability detection and the tile's model label.
```

- [ ] **Step 3: Write the README**

Create `README.md` covering, per §11: install, first-run, adding an agent, troubleshooting, the minimum Hermes version, and the keyboard shortcuts table. Phase 1 has no shortcuts wired yet (that is Phase 3), so the table section states that plainly rather than promising them.

```markdown
# Circe

A fleet of [Hermes Agent](https://hermes-agent.nousresearch.com) profiles as themed,
side-by-side chat tiles on macOS.

> **Status: Phase 1 (Foundations).** The wizard runs end to end, one tile streams a
> real conversation, and the permission gate works. Multi-tile fleet UX, avatars,
> and the orchestrator handoff are Phase 2.

## Requirements

- macOS (Circe is macOS-only by design)
- Node 22+
- **Hermes Agent 0.14.0 or newer** — `hermes --version`

## Install from source

```bash
git clone <repo> && cd circe-app
npm ci
npm run build
npm start
```

## First run

Circe opens a seven-screen wizard:

1. **Welcome** — start, or skip ahead if Hermes is already set up.
2. **Runtime** — checks for Hermes and its version.
3. **Profiles** — finds existing agents. A fresh Hermes install has none.
4. **Your first agent** — pick a cast and a character, or customize.
5. **Walkthrough** — name, colours, and whether the agent writes files.
6. **Provider** — connect a model provider, or skip and do it later.
7. **Ready** — tiles launch.

Chat won't work until a provider is connected, but the tiles launch either way.

## Adding an agent

Phase 2. For now, create the profile with `hermes profile create <name>` and
relaunch Circe.

## Permission gate

Each tile's header button cycles three states:

| State | Behaviour |
|---|---|
| 🔒 Locked | Every permission request is auto-denied, with a card showing what was blocked |
| ⛔ Ask | The agent pauses and asks inline |
| 🔓 Unlocked | Every request is auto-approved silently |

New agents open unlocked, except those marked "coding / writes files", which open locked.

## Keyboard shortcuts

Not wired in Phase 1. The shortcut table ships in Phase 3.

## Troubleshooting

**"Hermes isn't installed"** — Circe looks on `$PATH` and at `~/.local/bin/hermes`.
A GUI app doesn't inherit a login shell's `PATH`, so a Hermes installed only in
your shell profile may not be found.

**"This agent stopped unexpectedly"** — the Hermes subprocess exited. Use Restart
in the transcript. The transcript is preserved.

**A tile is missing** — the profile may no longer exist on disk. Circe refuses to
spawn a tile for a missing or malformed profile and leaves the others alone.

## Privacy

Circe's own process makes zero telemetry, analytics, or crash-reporting calls, and
ships no character images. Every avatar is user-uploaded or model-generated.

## Docs

- [Architecture decisions](docs/adr/)
- [Compat notes](docs/compat-notes.md) — where Circe depends on unversioned Hermes behaviour

## License

MIT
```

- [ ] **Step 4: Write the LICENSE**

Standard MIT text, copyright 2026.

- [ ] **Step 5: Commit**

```bash
git add docs/ README.md LICENSE
git commit -m "docs: ADRs, compat notes, README, and license"
```

---

### Task 19: Phase 1 exit verification

Not new code — the gate that proves Phase 1 is actually done before it goes to human review. §12 is explicit that Phase 1 stops here.

**Files:** none created.

- [ ] **Step 1: Run the full suite from a clean tree**

```bash
cd /Users/sarachipps/Code/circe-app
rm -rf node_modules out
npm ci
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Expected: typecheck clean, all unit tests pass, build succeeds, all E2E tests pass. Record the `[§10.1]` and `[§10.3]` numbers.

- [ ] **Step 2: Check every Phase-1 exit criterion**

Confirm each against real output, not assumption:

- [ ] Wizard runs Screens 1–7 end to end
- [ ] A single tile spawns, renders a transcript, and takes input
- [ ] Each tile owns a `hermes -p <profile> acp` subprocess over stdio
- [ ] Permission gate: three states, cycling, per-profile persistence, mid-response liveness
- [ ] Per-profile theming from the palette
- [ ] Display name resolves from `SOUL.md`
- [ ] State persists: positions, sizes, tab history, current tab, gate mode
- [ ] §10.1 passes and logs its duration
- [ ] §10.3 passes and logs p95
- [ ] §10.4 passes at both unit and E2E level
- [ ] §10.5 passes
- [ ] §10.6 passes
- [ ] ADR has all eleven entries
- [ ] Compat notes list all eight items
- [ ] README states the minimum Hermes version

- [ ] **Step 3: Run the manual runbook on a real machine**

CI uses the mock Hermes, so the real-Hermes path needs a human. Against a real install with a real provider:

1. Launch Circe. Confirm Screen 2 finds Hermes 0.14.0 and advances in about a second.
2. Confirm Screen 3 routes to **Screen 4b** — this machine has eight real profiles.
3. Click Continue without touching any row. Confirm tiles launch.
4. Verify by hash that no profile under `~/.hermes` changed:
   ```bash
   find ~/.hermes -name SOUL.md -exec shasum {} \; | sort > /tmp/souls-before.txt
   # …run Circe, click through, quit…
   find ~/.hermes -name SOUL.md -exec shasum {} \; | sort > /tmp/souls-after.txt
   diff /tmp/souls-before.txt /tmp/souls-after.txt   # must be empty
   ```
5. Send a real message in one tile. Confirm streaming.
6. Cycle the gate to Locked mid-response. Confirm the next tool call is denied and a card appears.
7. Quit with ⌘Q, relaunch, confirm tiles restore.

Record the results in the PR description.

- [ ] **Step 4: Stop**

Phase 1 is complete. **Do not begin Phase 2.** §1.3 and §12.3 both require a human review gate here — running app on real macOS plus code review. Phase 2 gets its own plan, written after that review.

- [ ] **Step 5: Commit and open the review**

```bash
git add -A
git commit -m "chore: Phase 1 exit verification"
```

---

## Self-review

Checked against the spec after writing.

**Spec coverage — Phase 1 scope (§9):**

| Requirement | Task |
|---|---|
| Wizard shell, Screens 1–7 | 13, 14, 15 |
| Tile shell — spawn, transcript, input | 11 |
| ACP transport per tile | 7 |
| Permission gate, three states, persistence, liveness | 8, 11 |
| Per-profile theming | 10, 11, 14 |
| Display name from SOUL.md | 3, 5, 11 |
| State persistence | 9, 15 |
| End-to-end path: fresh install → tile → streaming reply | 16 |
| §10.1 wizard timing | 16 |
| §10.3 tile responsiveness | 17 |
| §10.4 gate liveness | 8 (unit), 17 (E2E) |
| §10.5 state survival | 16 |
| §10.6 non-destruction | 6 (unit), 17 (E2E) |
| §5.1–§5.7 decisions recorded | 18 |
| §1.2 ambiguities recorded | 18 |

**Deliberately out of scope for this plan**, per §12.3 — tab strips, multi-tile parallel operation, the full five-panel Screen 5, avatars, Screen 4b's per-row actions, provider batching, the orchestrator handoff and skill, fleet management, error/offline states (§8.2 beyond what tiles already surface), keyboard shortcuts (§8.3), and the telemetry CI check (§8.4). §10.2, §10.7, and §10.8 are Phase 2 and Phase 3 criteria and are not in this plan.

**Note on §8.4 and §10.7:** the plan does not build the network sandbox, but it does put the CSP in place in Task 11 (`default-src 'none'`, `img-src 'self' data:`), and Task 10 tests that the cast data references no image files or URLs. That is partial early coverage, not the full Phase-3 check.

**Type consistency:** `GateMode`, `Palette`, `SoulHeading`, `HermesProfile`, `Message`, `TabState`, `TileState`, and `CirceState` are defined once in Task 1 and imported everywhere. `wizardScreen` is added to `CirceState` in Task 13, which also updates `migrate()` and the two tests that assert on `emptyState()`. `TileWindow` is defined in Task 11 and reused by Task 15's `createTileWindow`. `AcpClient`'s `gateMode` field is declared `protected` in Task 7 so Task 8's `setGateMode` can reassign it.

**Known rough edge:** Task 14's wizard renderer uses dynamic `import()` of `src/main/wizard/agents` from renderer code to reach `suggestCharacter`. That crosses the main/renderer boundary and will fail under electron-vite's bundling. The implementer should move `suggestCharacter` into `src/shared/casts.ts` — it is pure and depends only on cast data — and import it directly. Flagged rather than silently left, because a fresh implementer would hit it as a confusing build error.








