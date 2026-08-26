> **Historical plan:** Do not execute unchecked tasks from this document. See
> [../../CURRENT_BUILD.md](../../CURRENT_BUILD.md) for the current scope.

# Tile Parity Phase 2 — The Core Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agent created outside Circe — at a terminal, or by the orchestrator mid-conversation — gets its own correctly-themed tile on the display the user is looking at, without a restart.

**Architecture:** The palette moves out of Circe's private record and into `<profile>/circe.json`, which is what makes a profile Circe never created displayable at all. The per-profile tile state moves out of `index.ts`'s module-level singletons into `src/main/tiles.ts`, a registry that imports no Electron and takes its window and client factories as parameters — the same treatment `restore.ts` got in the Phase 1 fix wave, applied to what stayed behind. `src/main/fleet.ts` then decides which profiles deserve a tile and watches the home for new ones. `index.ts` keeps the wizard IPC, `boot`, and the app lifecycle.

**Tech Stack:** TypeScript, Electron 32, electron-vite, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-16-tile-parity-design.md` (§3.1, §4.3, §4.3.1, §4.6, §4.7, §9)

## Global Constraints

Copied from `~/Code/circe-oss-spec.md` and the design's own rulings; every task's requirements implicitly include these.

- **Constraint 1 — macOS only.** Do not add platform abstractions for later. Recursive `fs.watch` is available and is used deliberately.
- **Constraint 3 — ACP JSON-RPC over stdio is the only transport to a profile.** Do not invent a second transport. In particular, do not give the orchestrator a Circe-side tool or control channel for creating peers.
- **Constraint 4 — no telemetry.** Circe's own process makes zero network calls.
- **Constraint 7 — Circe reimplements nothing Hermes ships.** Conversations, titles, and context accounting are Hermes'.
- **Constraint 10 — a profile describes itself; Circe stores no agent facts.** After this phase, Circe's state holds window facts only: open sessions, geometry, access mode, and which profile is the main operator. Colours, name, tagline and avatar live in the profile.
- **Copy rule (§1.4):** UI text is plain and honest; it never claims something happened that did not.
- **Degradation rule:** a missing, corrupt, or future-versioned Circe record costs presentation, never an agent and never a conversation. Every parse in this plan is version-gated and falls back rather than throwing.
- **Nothing shells out except `RealHermes`.** `HermesRuntime` is the whole surface Circe is allowed to ask of Hermes; new capabilities go on that interface and are faked in `test/fake/hermes.ts`.
- **Verified protocol facts** (spec §2, captured from Hermes 0.14.0 — do not re-derive): `hermes profile create <id>` plus writing `SOUL.md` is all it takes to make a profile real; `hermes profile update` preserves non-distribution-owned files, so `circe.json` survives a persona replacement.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/main/palette.ts` (modify) | Gains the single `DEFAULT_PALETTE`. Today there are two, with different colours. |
| `src/main/profileTheme.ts` (create) | Pure parse/serialize of `<profile>/circe.json`, plus the read that degrades to `DEFAULT_PALETTE`. |
| `src/main/hermes/runtime.ts` (modify) | `profileFilePath()` beside `soulPath()`; `watchHome()` on the `HermesRuntime` interface. |
| `src/main/hermes/real.ts` (modify) | Implements `watchHome` with a recursive `fs.watch`. |
| `src/main/wizard.ts` (modify) | Writes `circe.json` beside `SOUL.md`; writes the shrunken launch record. |
| `src/main/startup.ts` (modify) | Record shrinks to `{version:2, mainProfileId}`; identity from `SOUL.md`, colours from `circe.json`; migrates a v1 record's palette into the profile. |
| `src/main/tiles.ts` (create) | The tile registry: one record per profile, all the lifecycle `index.ts` used to hold in singletons. Imports no Electron. |
| `src/main/fleet.ts` (create) | Which profiles deserve a tile, and the debounced watch that notices new ones. Imports no Electron. |
| `src/main/windows.ts` (modify) | Tile windows open on the display holding the cursor, cascade, and are raised on creation. |
| `src/main/index.ts` (modify) | Wiring only: wizard IPC, sender-routed tile IPC, `boot`, `activate`. |
| `resources/orchestrator/skills/circe-orchestrator/SKILL.md` (modify) | Documents the `circe.json` convention so the orchestrator creates a themed peer. |
| `test/profileTheme.test.ts` (create) | Round-trip, corruption, wrong shape, future version, bad hex, unreadable file. |
| `test/tiles.test.ts` (create) | Everything in `index.ts` that has never had a test. |
| `test/fleet.test.ts` (create) | Enumeration, readiness, debounce, dedup. |
| `src/main/tileLayout.ts` (create) | Tile size constants and cascade placement maths. Imports nothing, so it is testable. |
| `test/tileLayout.test.ts` (create) | Placement maths — anchoring, cascade, wrap, clamping. |
| `test/fake/hermes.ts` (modify) | Gains `watchHome` and a manual trigger. |

---

### Task 1: One `DEFAULT_PALETTE`, and `circe.json` on disk

**Files:**
- Modify: `src/main/palette.ts` (add the constant), `src/main/startup.ts:25-29` (remove it, re-export), `src/renderer/tile/main.ts:26` (remove the second one), `src/main/hermes/runtime.ts` (add `profileFilePath`)
- Create: `src/main/profileTheme.ts`
- Test: `test/profileTheme.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `DEFAULT_PALETTE: Palette` from `./palette`; `profileFilePath(profileId: string, file: string): string`; `THEME_FILE = 'circe.json'`; `serializeProfileTheme(palette: Palette): string`; `parseProfileTheme(json: string | null): Palette | null`; `readProfilePalette(hermes: HermesRuntime, profileId: string): Promise<Palette>`; `writeProfileTheme(hermes: HermesRuntime, profileId: string, palette: Palette): Promise<void>` (consumed by Tasks 2 and 4).

**Why two constants is a defect, not a detail:** `startup.ts` defines `DEFAULT_PALETTE` as `#1c1c1e/#8a8a8e/#c9c9ce` and `src/renderer/tile/main.ts:26` defines a *different* one as `#1e1e2a/#4b5563/#9ca3af`. A tile falling back in the main process and a tile falling back in the renderer are two different colours today. This phase makes the fallback path common, so they have to agree first.

**Why hex is validated:** `paletteVars` feeds `hexToRgb`, which is `parseInt(hex.slice(1,3), 16)`. A malformed value yields `NaN`, so the CSS variable becomes `rgba(NaN, NaN, NaN, 0.85)` — invalid, silently dropped by the browser, and the tile renders unstyled. A corrupt `circe.json` must cost the default palette, not a broken window.

- [ ] **Step 1: Write the failing tests**

Create `test/profileTheme.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  parseProfileTheme,
  readProfilePalette,
  serializeProfileTheme,
  THEME_FILE,
} from '../src/main/profileTheme';
import { DEFAULT_PALETTE } from '../src/main/palette';
import { profileFilePath } from '../src/main/hermes/runtime';
import { FakeHermes, INSTALLED_EMPTY } from './fake/hermes';
import type { Palette } from '../src/shared/types';

const PALETTE: Palette = { bg: '#1e2952', border: '#c7d2fe', accent: '#a5b4fc' };

describe('profileFilePath', () => {
  it('puts the default profile’s files at the home root', () => {
    expect(profileFilePath('default', THEME_FILE)).toBe('circe.json');
  });

  it('puts a named profile’s files under its own directory', () => {
    expect(profileFilePath('ford', THEME_FILE)).toBe('profiles/ford/circe.json');
  });
});

describe('parseProfileTheme', () => {
  it('round-trips a palette', () => {
    expect(parseProfileTheme(serializeProfileTheme(PALETTE))).toEqual(PALETTE);
  });

  it('answers null for an absent file', () => {
    expect(parseProfileTheme(null)).toBeNull();
  });

  it('answers null for unparseable JSON', () => {
    expect(parseProfileTheme('{ not json')).toBeNull();
  });

  it('answers null for a future version', () => {
    expect(parseProfileTheme(JSON.stringify({ version: 2, palette: PALETTE }))).toBeNull();
  });

  it('answers null when the palette is missing', () => {
    expect(parseProfileTheme(JSON.stringify({ version: 1 }))).toBeNull();
  });

  it('answers null for a non-object at the top level', () => {
    expect(parseProfileTheme('"a string"')).toBeNull();
    expect(parseProfileTheme('null')).toBeNull();
  });

  // A NaN channel reaches the stylesheet as `rgba(NaN, ...)`, which the browser
  // drops — an unstyled tile rather than a default-coloured one.
  it('answers null when a channel is not a six-digit hex colour', () => {
    for (const bad of ['red', '#fff', '#12345g', '', '#1234567']) {
      expect(parseProfileTheme(JSON.stringify({ version: 1, palette: { ...PALETTE, bg: bad } })))
        .toBeNull();
    }
  });

  it('answers null when a channel is not a string at all', () => {
    expect(parseProfileTheme(JSON.stringify({ version: 1, palette: { ...PALETTE, accent: 7 } })))
      .toBeNull();
  });
});

describe('readProfilePalette', () => {
  it('reads a profile’s own colours', async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    await hermes.writeHomeFile('profiles/ford/circe.json', serializeProfileTheme(PALETTE));

    expect(await readProfilePalette(hermes, 'ford')).toEqual(PALETTE);
  });

  it('falls back to the default palette when there is no file', async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    expect(await readProfilePalette(hermes, 'ford')).toEqual(DEFAULT_PALETTE);
  });

  it('falls back to the default palette when the file is corrupt', async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    await hermes.writeHomeFile('profiles/ford/circe.json', '{ broken');

    expect(await readProfilePalette(hermes, 'ford')).toEqual(DEFAULT_PALETTE);
  });

  // `readHomeFile` rejects for a file that exists but cannot be read. Colours
  // are not worth failing a tile over — §3.1: "it costs colours, never a tile".
  it('falls back to the default palette when the file cannot be read', async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    hermes.readHomeFile = async () => {
      throw new Error('EACCES');
    };

    expect(await readProfilePalette(hermes, 'ford')).toEqual(DEFAULT_PALETTE);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/profileTheme.test.ts`
Expected: FAIL — `Failed to resolve import "../src/main/profileTheme"`.

- [ ] **Step 3: Move `DEFAULT_PALETTE` into `palette.ts`**

Add to the top of `src/main/palette.ts`, under the existing import:

```ts
/**
 * Used for any profile whose colours Circe cannot read — someone else's
 * coordinator, a specialist created at a terminal before it was themed, or a
 * `circe.json` that failed to parse. Deliberately neutral: it should read as
 * "not themed yet", not as a character choice.
 *
 * Lives here, next to the functions that consume it, because both the main
 * process and the renderer fall back to it and they must agree. They did not:
 * `startup.ts` and `src/renderer/tile/main.ts` each had their own, with
 * different colours.
 */
export const DEFAULT_PALETTE: Palette = {
  bg: '#1c1c1e',
  border: '#8a8a8e',
  accent: '#c9c9ce',
};
```

In `src/main/startup.ts`, delete the `DEFAULT_PALETTE` declaration at `:25-29` and re-export it so existing importers (including `test/startup.test.ts`) keep working:

```ts
import { DEFAULT_PALETTE } from './palette';

export { DEFAULT_PALETTE };
```

In `src/renderer/tile/main.ts`, delete the local declaration at `:26` and its comment, and import the shared one instead. The existing import at `:3` becomes:

```ts
import { DEFAULT_PALETTE, paletteVars } from '../../main/palette';
```

The `Palette` type import at `:2` is now unused by this file's own declarations but is still used elsewhere in it; leave the import line as the typecheck requires.

- [ ] **Step 4: Add `profileFilePath` to `runtime.ts`**

Add below `soulPath` in `src/main/hermes/runtime.ts`:

```ts
/**
 * A file inside one profile's own directory, relative to the Hermes home.
 * The root profile keeps its files at the home root, exactly as `soulPath`
 * does and as `installOrchestratorSkill` already hand-rolls. Relative because
 * that is what `readHomeFile`/`writeHomeFile` take.
 */
export function profileFilePath(profileId: string, file: string): string {
  return profileId === 'default' ? file : `profiles/${profileId}/${file}`;
}
```

- [ ] **Step 5: Implement `profileTheme.ts`**

Create `src/main/profileTheme.ts`:

```ts
import type { Palette } from '../shared/types';
import { DEFAULT_PALETTE } from './palette';
import { profileFilePath, type HermesRuntime } from './hermes/runtime';

/** The profile-owned file that carries an agent's colours (spec §3.1). */
export const THEME_FILE = 'circe.json';

const RECORD_VERSION = 1;

/**
 * Six-digit hex only. `hexToRgb` is `parseInt(hex.slice(1, 3), 16)`, so any
 * other shape yields `NaN` channels and an `rgba(NaN, …)` custom property,
 * which the browser drops — leaving an unstyled tile rather than a
 * default-coloured one. Rejecting here is what keeps the fallback visible.
 */
const HEX = /^#[0-9a-fA-F]{6}$/;

function isHex(v: unknown): v is string {
  return typeof v === 'string' && HEX.test(v);
}

export function serializeProfileTheme(palette: Palette): string {
  return `${JSON.stringify({ version: RECORD_VERSION, palette }, null, 2)}\n`;
}

/**
 * The palette a `circe.json` describes, or null for anything Circe should not
 * act on. Version-gated for the same reason `startup.ts` is: a file written by
 * a later Circe may carry fields this build would half-read.
 */
export function parseProfileTheme(json: string | null): Palette | null {
  if (json === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as { version?: unknown; palette?: unknown };
  if (record.version !== RECORD_VERSION) return null;
  const p = record.palette;
  if (typeof p !== 'object' || p === null) return null;
  const { bg, border, accent } = p as Record<string, unknown>;
  if (!isHex(bg) || !isHex(border) || !isHex(accent)) return null;
  return { bg, border, accent };
}

/**
 * A profile's own colours, or the neutral default.
 *
 * Never throws. `readHomeFile` rejects for a file that exists but cannot be
 * read — an unreadable `circe.json` costs colours, never a tile (§3.1), and a
 * profile whose theme cannot be read still has an agent behind it.
 */
export async function readProfilePalette(
  hermes: HermesRuntime,
  profileId: string,
): Promise<Palette> {
  let json: string | null;
  try {
    json = await hermes.readHomeFile(profileFilePath(profileId, THEME_FILE));
  } catch (err) {
    console.warn(`Could not read colours for profile "${profileId}"; using the default.`, err);
    return DEFAULT_PALETTE;
  }
  return parseProfileTheme(json) ?? DEFAULT_PALETTE;
}

/**
 * Writes a profile's colours. Callers treat a failure as non-fatal: it costs
 * colours, not an agent, and must never roll back a persona that succeeded
 * (ruling F-1).
 */
export async function writeProfileTheme(
  hermes: HermesRuntime,
  profileId: string,
  palette: Palette,
): Promise<void> {
  await hermes.writeHomeFile(profileFilePath(profileId, THEME_FILE), serializeProfileTheme(palette));
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run test/profileTheme.test.ts test/startup.test.ts test/palette.test.ts`
Expected: PASS, all three files.

- [ ] **Step 7: Typecheck and full suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; 227 existing tests plus the new ones green.

- [ ] **Step 8: Commit**

```bash
git add src/main/palette.ts src/main/profileTheme.ts src/main/startup.ts \
        src/main/hermes/runtime.ts src/renderer/tile/main.ts test/profileTheme.test.ts
git commit -m "feat: a profile carries its own colours in circe.json

Constraint 10 puts an agent's colours in the profile, not in Circe's record.
This adds the file and the reader; nothing writes it yet.

Also collapses two DEFAULT_PALETTE constants into one. startup.ts and the tile
renderer each had their own, with different colours, so a fallback in the main
process and a fallback in the renderer did not agree. This phase makes that
path common, so they have to."
```

---

### Task 2: The wizard writes `circe.json`

**Files:**
- Modify: `src/main/wizard.ts:205-250` (`commitAccept`)
- Test: `test/wizard.test.ts`

**Interfaces:**
- Consumes: `writeProfileTheme(hermes, profileId, palette)` from Task 1.
- Produces: nothing new; `commitAccept`'s observable effect gains one file.

**Why it is written where it is:** `commitAccept`'s ordering is load-bearing and documented in the existing comment — both writes complete *before* `launching` is announced, because `index.ts` reacts to `launching` by spawning an agent that reads `SOUL.md`. `circe.json` is not read by the agent, so it does not share that constraint, but it must be on disk before a tile is themed from it, and the tile is launched from `launching`. So it goes in the same block, after the skill install.

**Why a failure is not fatal:** §4.7 — "A failure to write `circe.json` is not fatal — it costs colours, not an agent — and must not roll back a persona that succeeded, consistent with ruling F-1's honesty about partial writes." It therefore goes in its own `try`, swallowed and warned, exactly like the launch record below it.

- [ ] **Step 1: Write the failing tests**

Add to `test/wizard.test.ts`, inside `describe('a fresh Hermes install', …)`:

```ts
  it('writes the character’s colours into the profile', async () => {
    const { hermes, w } = await toMeet(INSTALLED_EMPTY);

    await w.accept();

    const theme = JSON.parse((await hermes.readHomeFile('circe.json'))!);
    expect(theme).toEqual({
      version: 1,
      palette: { bg: '#1e2952', border: '#c7d2fe', accent: '#a5b4fc' },
    });
  });

  it('still launches when the colours cannot be written', async () => {
    // Colours are not worth trading a working agent for. The persona is already
    // on disk by this point and must not be rolled back (ruling F-1).
    const hermes = new FakeHermes(scenario(INSTALLED_EMPTY));
    const realWrite = hermes.writeHomeFile.bind(hermes);
    hermes.writeHomeFile = async (rel: string, contents: string) => {
      if (rel === 'circe.json') throw new Error('EACCES');
      return realWrite(rel, contents);
    };
    const w = new Wizard(hermes);
    await w.start();
    await w.submitFandom("Hitchhiker's Guide to the Galaxy");

    await w.accept();

    expect(w.state).toMatchObject({ kind: 'launching', profileId: 'default' });
    expect(await hermes.readHomeFile('SOUL.md')).toContain('# Trillian');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/wizard.test.ts -t 'colours'`
Expected: FAIL — the first with `Cannot read properties of null (reading 'version')` (no `circe.json` was written); the second passes vacuously today and must stay green.

- [ ] **Step 3: Implement**

In `src/main/wizard.ts`, add the import:

```ts
import { writeProfileTheme } from './profileTheme';
```

In `commitAccept`, immediately after the `try` block that writes the persona and installs the skill, and *before* the launch-record write, insert:

```ts
    // Deliberately outside the block above, and deliberately swallowed. The
    // persona is already on disk; failing the launch now would trade a working
    // agent for its colours, and would leave the user with a `write-failed`
    // screen for a file the agent never reads. A profile with no `circe.json`
    // falls back to the neutral palette and is otherwise complete.
    try {
      await writeProfileTheme(this.hermes, 'default', character.palette);
    } catch (err) {
      console.warn('Could not write the profile’s colours (circe.json):', err);
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/wizard.test.ts`
Expected: PASS, all 34 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/wizard.ts test/wizard.test.ts
git commit -m "feat: the wizard writes the character's colours into the profile

Non-fatal by design: the persona is already on disk when this runs, so a
failure costs colours and must not roll back an agent that was written."
```

---

### Task 3: The orchestrator skill documents the convention

**Files:**
- Modify: `resources/orchestrator/skills/circe-orchestrator/SKILL.md` ("Creating an agent" section)
- Test: `test/skill.test.ts` (create) — or append to an existing skill test if one exists; check with `ls test/`

**Interfaces:**
- Consumes: the `circe.json` shape from Task 1.
- Produces: nothing in code. This is the piece that makes "the fleet grows through conversation" produce a *themed* result.

**Why this is a task and not a docs afterthought:** §4.3's "why a watch and not a tool" argument is that the orchestrator needs *knowledge of a convention*, not a Circe-provided capability. This file is that knowledge. Without it the orchestrator creates profiles that tile in the neutral fallback palette, and the core loop half-works in a way no test would catch.

**Why the palette is not asked for:** §6.2 Step 4's rule — colours are applied silently, chosen for the character. The skill must say so, or an orchestrator will helpfully offer the user a colour picker.

- [ ] **Step 1: Edit the skill**

In `resources/orchestrator/skills/circe-orchestrator/SKILL.md`, replace step 3 of "Creating an agent" with steps 3 and 4, renumbering the two that follow:

```markdown
3. Write `~/.hermes/profiles/<id>/SOUL.md`, starting with `# <Name> — <domain>`.
   The heading matters: it is how the profile is recognised as configured rather
   than as an untouched scaffold.
4. Write `~/.hermes/profiles/<id>/circe.json` — the agent's colours:

   ```json
   {
     "version": 1,
     "palette": { "bg": "#1e2952", "border": "#c7d2fe", "accent": "#a5b4fc" }
   }
   ```

   Three six-digit hex colours: a dark background, a light border, and a bright
   accent readable against the background. Choose them for the character, from
   the same world their name came from. **Do not ask the user to pick colours** —
   this is part of giving the agent a face, like the name is. A profile without
   this file still works; it just appears in a neutral grey.
5. Prune its loadout: `hermes skills config` then `hermes tools`, in that order.
   A new profile inherits everything; leaving it unpruned means the new agent is
   the same unpruned setup under a different name.
6. Tell the user it exists, what it owns, and what you turned off.
```

- [ ] **Step 2: Write the test**

Create `test/skill.test.ts` (if `test/` already holds a skill test, add these cases to it instead):

```ts
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { SKILL_SOURCE_PATH } from '../src/main/orchestrator/skill';

describe('the orchestrator skill', () => {
  it('tells the orchestrator how to theme an agent it creates', async () => {
    const text = await readFile(SKILL_SOURCE_PATH, 'utf8');

    // The convention itself: without this the fleet grows in grey.
    expect(text).toContain('circe.json');
    expect(text).toMatch(/"version":\s*1/);
    expect(text).toContain('"palette"');
    for (const channel of ['bg', 'border', 'accent']) expect(text).toContain(`"${channel}"`);
  });

  it('tells the orchestrator not to ask the user for colours', async () => {
    const text = await readFile(SKILL_SOURCE_PATH, 'utf8');
    expect(text).toMatch(/Do not ask the user to pick colours/i);
  });

  it('still tells it to write a heading, which is what makes a profile real', async () => {
    const text = await readFile(SKILL_SOURCE_PATH, 'utf8');
    expect(text).toContain('# <Name> — <domain>');
  });
});
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run test/skill.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add resources/orchestrator/skills/circe-orchestrator/SKILL.md test/skill.test.ts
git commit -m "docs: the orchestrator skill documents the circe.json convention

§4.3's argument for a watch rather than a Circe-side tool is that the
orchestrator needs knowledge of a convention, not a capability. This file is
that knowledge; without it the fleet grows in the neutral fallback palette."
```

---

### Task 4: Startup reads identity and colours from the profile

**Files:**
- Modify: `src/main/startup.ts` (whole file), `src/main/wizard.ts` (the launch-record write)
- Test: `test/startup.test.ts`

**Interfaces:**
- Consumes: `readProfilePalette`, `writeProfileTheme`, `profileFilePath`, `THEME_FILE` (Task 1).
- Produces:
  - `interface LastLaunch { version: 2; mainProfileId: string }`
  - `serializeLastLaunch(mainProfileId: string): string`
  - `parseLastLaunch(json: string | null): LastLaunch | null` (exported now, for Task 9's migration)
  - `type Startup = { kind: 'wizard' } | { kind: 'fleet'; mainProfileId: string }`
  - `readStartup(hermes: HermesRuntime): Promise<Startup>`
  - `resolveStartup(recordJson: string | null, soulText: string | null): Startup`
  - `characterFor(hermes: HermesRuntime, profile: HermesProfile): Promise<Character>`
  - `migrateV1Palette(hermes: HermesRuntime, recordJson: string | null): Promise<void>`

**What changes and why:** §3 — "`circe/last-launch.json` shrinks to what it is actually for: which profile is the main operator... Its `character` block goes away — that data now lives in the profile." The record no longer carries a palette, so `resolveStartup` no longer reads one from it. And because there is now more than one tile, `Startup` stops describing a single character and says only *whether* onboarding is needed and which tile foregrounds.

**The migration is not optional.** An existing install — including the operator's own — has a v1 record holding the only copy of its palette and no `circe.json`. Version-gating alone would silently grey out an agent the user has been using. `migrateV1Palette` reads a v1 record and writes its palette into the profile if the profile has none, once, at boot. It is best-effort: a failure costs colours.

- [ ] **Step 1: Write the failing tests**

Replace the body of `test/startup.test.ts` with this. The old tests asserted on `Startup.character`, which no longer exists.

```ts
import { describe, expect, it } from 'vitest';
import {
  characterFor,
  DEFAULT_PALETTE,
  LAST_LAUNCH_PATH,
  migrateV1Palette,
  parseLastLaunch,
  resolveStartup,
  serializeLastLaunch,
} from '../src/main/startup';
import { serializeProfileTheme } from '../src/main/profileTheme';
import { FakeHermes, INSTALLED_EMPTY, SCAFFOLD_SOUL } from './fake/hermes';
import type { HermesProfile, Palette } from '../src/shared/types';

const PALETTE: Palette = { bg: '#1e2952', border: '#c7d2fe', accent: '#a5b4fc' };
const REAL_SOUL = '# Trillian — the one who keeps the plot\n\nYou are **Trillian**.\n';

function profile(over: Partial<HermesProfile> = {}): HermesProfile {
  return { id: 'default', displayName: 'Trillian', model: 'claude-opus-5', isReal: true, ...over };
}

describe('resolveStartup', () => {
  it('opens onboarding when SOUL.md is the stock scaffold', () => {
    expect(resolveStartup(null, SCAFFOLD_SOUL)).toEqual({ kind: 'wizard' });
  });

  it('opens onboarding when there is no SOUL.md at all', () => {
    expect(resolveStartup(null, null)).toEqual({ kind: 'wizard' });
  });

  // SOUL.md is the authority: a hand-edited persona keeps its agent rather than
  // being sent back through a wizard whose next move is to overwrite it.
  it('opens the fleet when a persona exists, with no record at all', () => {
    expect(resolveStartup(null, REAL_SOUL)).toEqual({ kind: 'fleet', mainProfileId: 'default' });
  });

  it('foregrounds the profile the record names', () => {
    const record = serializeLastLaunch('ford');
    expect(resolveStartup(record, REAL_SOUL)).toEqual({ kind: 'fleet', mainProfileId: 'ford' });
  });

  it('falls back to default for a corrupt record', () => {
    expect(resolveStartup('{ broken', REAL_SOUL)).toEqual({
      kind: 'fleet',
      mainProfileId: 'default',
    });
  });

  // A v1 record carries a `character` block this build would half-read.
  it('falls back to default for a v1 record', () => {
    const v1 = JSON.stringify({ version: 1, profileId: 'ford', character: { name: 'Ford' } });
    expect(resolveStartup(v1, REAL_SOUL)).toEqual({ kind: 'fleet', mainProfileId: 'default' });
  });
});

describe('serializeLastLaunch', () => {
  it('records the main operator and nothing about who they are', () => {
    const record = JSON.parse(serializeLastLaunch('ford'));
    expect(record).toEqual({ version: 2, mainProfileId: 'ford' });
  });
});

describe('characterFor', () => {
  it('takes identity from SOUL.md and colours from the profile', async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    await hermes.writeHomeFile('SOUL.md', REAL_SOUL);
    await hermes.writeHomeFile('circe.json', serializeProfileTheme(PALETTE));

    expect(await characterFor(hermes, profile())).toEqual({
      name: 'Trillian',
      tagline: 'the one who keeps the plot',
      profileId: 'default',
      palette: PALETTE,
      why: '',
      fandom: '',
    });
  });

  it('falls back to the neutral palette for a profile with no colours', async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    await hermes.writeHomeFile('profiles/ford/SOUL.md', '# Ford — the one who finds the exit\n');

    const c = await characterFor(hermes, profile({ id: 'ford', displayName: 'Ford' }));
    expect(c).toMatchObject({ name: 'Ford', profileId: 'ford', palette: DEFAULT_PALETTE });
  });

  // A profile whose SOUL.md cannot be parsed still has an agent behind it.
  it('falls back to the profile’s display name when the heading cannot be read', async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    hermes.readHomeFile = async () => {
      throw new Error('EACCES');
    };

    const c = await characterFor(hermes, profile({ id: 'ford', displayName: 'ford' }));
    expect(c).toMatchObject({ name: 'ford', tagline: '', palette: DEFAULT_PALETTE });
  });
});

describe('migrateV1Palette', () => {
  const V1 = JSON.stringify({
    version: 1,
    profileId: 'default',
    character: { name: 'Trillian', palette: PALETTE },
  });

  it('moves a v1 record’s colours into the profile', async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);

    await migrateV1Palette(hermes, V1);

    expect(JSON.parse((await hermes.readHomeFile('circe.json'))!)).toEqual({
      version: 1,
      palette: PALETTE,
    });
  });

  it('does not overwrite colours the profile already has', async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    const mine: Palette = { bg: '#000000', border: '#111111', accent: '#222222' };
    await hermes.writeHomeFile('circe.json', serializeProfileTheme(mine));

    await migrateV1Palette(hermes, V1);

    expect(JSON.parse((await hermes.readHomeFile('circe.json'))!).palette).toEqual(mine);
  });

  it('does nothing for a v2 record', async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    await migrateV1Palette(hermes, serializeLastLaunch('default'));
    expect(await hermes.readHomeFile('circe.json')).toBeNull();
  });

  it('does nothing when there is no record', async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    await migrateV1Palette(hermes, null);
    expect(await hermes.readHomeFile('circe.json')).toBeNull();
  });

  // Best-effort: a migration that throws would take the whole boot with it.
  it('swallows a write failure', async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    hermes.writeHomeFile = async () => {
      throw new Error('EACCES');
    };

    await expect(migrateV1Palette(hermes, V1)).resolves.toBeUndefined();
  });
});

describe('parseLastLaunch', () => {
  it('reads a v2 record', () => {
    expect(parseLastLaunch(serializeLastLaunch('ford'))).toEqual({
      version: 2,
      mainProfileId: 'ford',
    });
  });

  it('rejects anything else', () => {
    expect(parseLastLaunch(null)).toBeNull();
    expect(parseLastLaunch('{ broken')).toBeNull();
    expect(parseLastLaunch(JSON.stringify({ version: 2 }))).toBeNull();
  });
});

describe('LAST_LAUNCH_PATH', () => {
  it('lives inside the Hermes home so HERMES_HOME redirects it', () => {
    expect(LAST_LAUNCH_PATH).toBe('circe/last-launch.json');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/startup.test.ts`
Expected: FAIL — `characterFor`, `migrateV1Palette` and `parseLastLaunch` are not exported, and `resolveStartup` returns `kind: 'tile'`.

- [ ] **Step 3: Rewrite `startup.ts`**

Replace `src/main/startup.ts` with:

```ts
import type { Character, HermesProfile } from '../shared/types';
import { profileFilePath, soulPath, type HermesRuntime } from './hermes/runtime';
import { DEFAULT_PALETTE } from './palette';
import { isRealSoul } from './profiles';
import { parseProfileTheme, readProfilePalette, THEME_FILE, writeProfileTheme } from './profileTheme';
import { parseSoulHeading } from './soul';

export { DEFAULT_PALETTE };

/**
 * What Circe remembers between launches about the fleet as a whole: which
 * profile is the main operator, i.e. whose tile foregrounds (spec §6.6).
 *
 * The `character` block a v1 record carried is gone. An agent's name, tagline
 * and colours are the profile's own (§3.1), so caching them here was constraint
 * 10's inversion — it meant a profile Circe had not created could not be shown.
 * Losing this record now costs nothing but which window ends up on top.
 */
export interface LastLaunch {
  version: 2;
  mainProfileId: string;
}

const RECORD_VERSION = 2;

/** Where the record lives, relative to the Hermes home. */
export const LAST_LAUNCH_PATH = 'circe/last-launch.json';

export type Startup = { kind: 'wizard' } | { kind: 'fleet'; mainProfileId: string };

export function serializeLastLaunch(mainProfileId: string): string {
  const record: LastLaunch = { version: RECORD_VERSION, mainProfileId };
  return JSON.stringify(record, null, 2);
}

export function parseLastLaunch(json: string | null): LastLaunch | null {
  if (json === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const r = parsed as Partial<LastLaunch>;
  if (r.version !== RECORD_VERSION) return null;
  if (typeof r.mainProfileId !== 'string') return null;
  return { version: RECORD_VERSION, mainProfileId: r.mainProfileId };
}

/**
 * Moves a pre-Phase-2 record's palette into the profile that owns it.
 *
 * Version-gating alone would silently grey out an agent the user has been
 * living with, because a v1 record holds the *only* copy of its colours and
 * such an install has no `circe.json` at all. Runs once at boot, never
 * overwrites colours the profile already has, and swallows every failure: this
 * is a cosmetic rescue, and a boot that dies over it would be a far worse bug
 * than the grey tile it prevents.
 */
export async function migrateV1Palette(
  hermes: HermesRuntime,
  recordJson: string | null,
): Promise<void> {
  if (recordJson === null) return;
  try {
    const parsed: unknown = JSON.parse(recordJson);
    if (typeof parsed !== 'object' || parsed === null) return;
    const r = parsed as { version?: unknown; profileId?: unknown; character?: unknown };
    if (r.version !== 1) return;
    const profileId = typeof r.profileId === 'string' ? r.profileId : 'default';
    const palette = (r.character as { palette?: unknown } | undefined)?.palette;
    // Reuse the theme parser rather than trusting the record: a v1 palette has
    // never been hex-validated, and an unvalidated channel reaches the
    // stylesheet as `rgba(NaN, …)`.
    const valid = parseProfileTheme(JSON.stringify({ version: 1, palette }));
    if (valid === null) return;
    const existing = await hermes.readHomeFile(profileFilePath(profileId, THEME_FILE));
    if (existing !== null) return;
    await writeProfileTheme(hermes, profileId, valid);
    console.info(`Moved profile "${profileId}" colours from Circe's record into the profile.`);
  } catch (err) {
    console.warn('Could not migrate the recorded palette into the profile.', err);
  }
}

/**
 * Everything a tile needs to present a profile, read from the profile itself.
 *
 * Identity comes from the file the agent actually loads, so a hand-edited
 * `SOUL.md` wins over anything Circe remembers. Colours come from the
 * profile's own `circe.json`. `why` and `fandom` were only ever derivation
 * artefacts shown on the wizard's meet screen; a tile does not use them, and
 * for a profile Circe did not create they do not exist, so they are empty.
 *
 * Never throws. A profile whose files cannot be read still has an agent behind
 * it and still gets a tile — the display name Hermes already computed is the
 * fallback for the heading.
 */
export async function characterFor(
  hermes: HermesRuntime,
  profile: HermesProfile,
): Promise<Character> {
  let soulText: string | null = null;
  try {
    soulText = await hermes.readHomeFile(soulPath('', profile.id).replace(/^\//, ''));
  } catch (err) {
    console.warn(`Could not read the persona for profile "${profile.id}".`, err);
  }
  const heading = soulText === null ? null : parseSoulHeading(soulText);
  return {
    name: heading?.name ?? profile.displayName,
    tagline: heading?.tagline ?? '',
    profileId: profile.id,
    palette: await readProfilePalette(hermes, profile.id),
    why: '',
    fandom: '',
  };
}

/**
 * Reads what `resolveStartup` needs out of the Hermes home. Any read failure
 * resolves to the wizard: `readHomeFile` rejects (rather than returning null)
 * for a file that exists but can't be read, and the wizard is the safe landing
 * for that — its own write path refuses to overwrite a persona it couldn't
 * read first, so an unreadable SOUL.md still can't be destroyed.
 */
export async function readStartup(hermes: HermesRuntime): Promise<Startup> {
  const soulRel = soulPath('', 'default').replace(/^\//, '');
  let soulText: string | null;
  let recordJson: string | null;
  try {
    soulText = await hermes.readHomeFile(soulRel);
    recordJson = await hermes.readHomeFile(LAST_LAUNCH_PATH);
  } catch (err) {
    console.warn('Could not read the Hermes home on startup; starting onboarding.', err);
    return { kind: 'wizard' };
  }
  await migrateV1Palette(hermes, recordJson);
  return resolveStartup(recordJson, soulText);
}

/**
 * Decides whether Circe onboards or opens the fleet, and which tile foregrounds.
 *
 * SOUL.md is the authority. If the root profile holds a real persona then an
 * orchestrator exists and Circe opens onto the fleet, whoever wrote it — a user
 * who hand-edits their own identity file must not be sent back through
 * onboarding, because onboarding's next move is to overwrite the very file they
 * just edited.
 *
 * Kept pure so every branch is testable without an Electron app around it.
 */
export function resolveStartup(recordJson: string | null, soulText: string | null): Startup {
  if (!isRealSoul(soulText)) return { kind: 'wizard' };
  return { kind: 'fleet', mainProfileId: parseLastLaunch(recordJson)?.mainProfileId ?? 'default' };
}
```

- [ ] **Step 4: Update the wizard's record write**

In `src/main/wizard.ts`'s `commitAccept`, the launch-record write currently passes a character. Change it to:

```ts
      await this.hermes.writeHomeFile(LAST_LAUNCH_PATH, serializeLastLaunch('default'));
```

Adjust the `serializeLastLaunch` import if the old signature was imported by name (it was). Then fix `test/wizard.test.ts`'s existing record assertion — the one titled *"records the launch so the next cold start can reopen the tile"* — to:

```ts
    const record = JSON.parse((await hermes.readHomeFile(LAST_LAUNCH_PATH))!);
    expect(record).toEqual({ version: 2, mainProfileId: 'default' });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/startup.test.ts test/wizard.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: FAIL, in `src/main/index.ts` only — `boot` still destructures `startup.character`. That is Task 6's job; leave it. Record the error text in the commit body so the next task's implementer knows it is expected.

- [ ] **Step 7: Commit**

```bash
git add src/main/startup.ts src/main/wizard.ts test/startup.test.ts test/wizard.test.ts
git commit -m "feat: read an agent's identity and colours from its own profile

The launch record shrinks to {version:2, mainProfileId}. Its character block is
gone: name, tagline and colours are the profile's own, and caching them in
Circe's record is the constraint 10 inversion that made a profile Circe had not
created undisplayable.

Adds a one-shot migration for the palette a v1 record holds, because such an
install has no circe.json and version-gating alone would silently grey out an
agent the user has been using.

index.ts does not typecheck after this commit — it still reads startup.character.
The next task rewires it."
```

---

### Task 5: The tile registry

**Files:**
- Create: `src/main/tiles.ts`
- Test: `test/tiles.test.ts` (create)

**Interfaces:**
- Consumes: `restoreOrCreateSession`, `TileSession`, `SessionClient` (`./restore`); `HermesRuntime`; `Character`.
- Produces:
  - `interface TileWindow` — the narrow slice of `BrowserWindow` a tile needs
  - `interface TileClient extends SessionClient` — adds `start`, `stop`, `prompt`
  - `interface TileDeps` — the registry's collaborators
  - `class TileRegistry` with `launch(character, profileId)`, `has(profileId)`, `profileForSender(sender)`, `prompt(profileId, text)`, `close(profileId)`, `raise(profileId)`, `openProfileIds()`

**Why this task exists:** §4.3.1. Every one of the behaviours tested below currently lives in `src/main/index.ts` and has never had a test, because `index.ts` imports `electron` at module scope and calls `app.setName` there — the import throws under Vitest before any test body runs. Fleet tiles turn each of its singletons into a per-profile map, so this file is being rewritten either way.

**The supersession discipline must survive the move.** Phase 1 established that a launch writes shared state only while it is still current (`acp === client` at the old `index.ts:191`). Per profile this becomes `this.tiles.get(profileId)?.client === client`. It is timing-dependent, has never been exercised by hand, and is exactly the cross-module contract per-task review misses. It is tested here for the first time against a real registry rather than a reimplementation.

- [ ] **Step 1: Write the failing tests**

Create `test/tiles.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { TileRegistry, type TileClient, type TileDeps, type TileWindow } from '../src/main/tiles';
import { FakeHermes, INSTALLED_EMPTY } from './fake/hermes';
import type { Character } from '../src/shared/types';

const PALETTE = { bg: '#1e2952', border: '#c7d2fe', accent: '#a5b4fc' };

function character(profileId: string): Character {
  return { name: profileId, profileId, tagline: '', palette: PALETTE, why: '', fandom: '' };
}

/** A window that records what it was sent and lets a test fire its events. */
class FakeWindow implements TileWindow {
  readonly sent: Array<{ channel: string; payload: unknown }> = [];
  destroyed = false;
  shown = 0;
  focused = 0;
  minimized = false;
  restored = 0;
  closeCalls = 0;
  readonly sender = {};
  private loaded: Array<() => void> = [];
  private failed: Array<() => void> = [];
  private closedCbs: Array<() => void> = [];

  send(channel: string, payload: unknown): void {
    this.sent.push({ channel, payload });
  }
  isDestroyed(): boolean {
    return this.destroyed;
  }
  close(): void {
    this.closeCalls++;
    this.fireClosed();
  }
  show(): void {
    this.shown++;
  }
  focus(): void {
    this.focused++;
  }
  isMinimized(): boolean {
    return this.minimized;
  }
  restore(): void {
    this.restored++;
  }
  ownsSender(s: unknown): boolean {
    return s === this.sender;
  }
  onceLoaded(cb: () => void): void {
    this.loaded.push(cb);
  }
  onceFailedLoad(cb: () => void): void {
    this.failed.push(cb);
  }
  onceClosed(cb: () => void): void {
    this.closedCbs.push(cb);
  }

  fireLoaded(): void {
    this.loaded.splice(0).forEach((cb) => cb());
  }
  fireFailedLoad(): void {
    this.failed.splice(0).forEach((cb) => cb());
  }
  fireClosed(): void {
    this.destroyed = true;
    this.closedCbs.splice(0).forEach((cb) => cb());
  }
  /** Only the payloads of `tile:update`, which is where circe/* events ride. */
  updates(): Array<Record<string, unknown>> {
    return this.sent
      .filter((s) => s.channel === 'tile:update')
      .map((s) => s.payload as Record<string, unknown>);
  }
  /** Only the text of `tile:opening`, which is where prose reaches the tile. */
  openings(): string[] {
    return this.sent.filter((s) => s.channel === 'tile:opening').map((s) => s.payload as string);
  }
}

class FakeClient implements TileClient {
  canLoadSession = false;
  canListSessions = false;
  started = false;
  stopped = 0;
  readonly prompts: Array<{ sessionId: string; text: string }> = [];
  /**
   * Armed by the harness at construction, never set afterwards: `launch` calls
   * `start()` before it returns to the test, so a test that assigns this after
   * calling `launch` would arm a gun already fired.
   */
  constructor(readonly startError: Error | null = null) {}
  /** Resolves `prompt`; a test can hold a turn open by not calling it. */
  private resolvePrompt: (() => void) | null = null;
  onUpdate: (sessionId: string, update: Record<string, unknown>) => void = () => {};
  onExit: (code: number | null) => void = () => {};
  private nextSession = 1;

  async start(): Promise<void> {
    if (this.startError) throw this.startError;
    this.started = true;
  }
  stop(): void {
    this.stopped++;
  }
  async newSession(): Promise<string> {
    return `session-${this.nextSession++}`;
  }
  async loadSession(): Promise<boolean> {
    return true;
  }
  async listSessions(): Promise<string[] | null> {
    return null;
  }
  prompt(sessionId: string, text: string): Promise<void> {
    this.prompts.push({ sessionId, text });
    return new Promise((resolve) => {
      this.resolvePrompt = resolve;
    });
  }
  finishTurn(): void {
    this.resolvePrompt?.();
    this.resolvePrompt = null;
  }
}

interface Harness {
  registry: TileRegistry;
  windows: FakeWindow[];
  clients: FakeClient[];
  hermes: FakeHermes;
}

/**
 * `startError` arms the *next* client to fail its handshake. It is a harness
 * argument rather than a field a test sets afterwards because `launch` calls
 * `client.start()` synchronously, before its promise ever returns to the test.
 */
function harness(startError: Error | null = null): Harness {
  const windows: FakeWindow[] = [];
  const clients: FakeClient[] = [];
  const hermes = new FakeHermes(INSTALLED_EMPTY);
  const deps: TileDeps = {
    hermes,
    createWindow: () => {
      const w = new FakeWindow();
      windows.push(w);
      return w;
    },
    createClient: (opts) => {
      const c = new FakeClient(startError);
      c.onUpdate = opts.onUpdate;
      c.onExit = opts.onExit;
      clients.push(c);
      return c;
    },
  };
  return { registry: new TileRegistry(deps), windows, clients, hermes };
}

/** Launches and lets the window finish loading, which is the happy path. */
async function launched(h: Harness, profileId = 'default'): Promise<void> {
  const launch = h.registry.launch(character(profileId), profileId);
  h.windows[h.windows.length - 1]!.fireLoaded();
  await launch;
}

describe('launching a tile', () => {
  it('creates one window and one client, and starts the client', async () => {
    const h = harness();
    await launched(h);

    expect(h.windows).toHaveLength(1);
    expect(h.clients).toHaveLength(1);
    expect(h.clients[0]!.started).toBe(true);
  });

  it('paints the greeting once the renderer has loaded, not before', async () => {
    const h = harness();
    const launch = h.registry.launch(character('default'), 'default', 'Hello.');
    const win = h.windows[0]!;

    expect(win.openings()).toEqual([]); // queued, not sent

    win.fireLoaded();
    await launch;

    expect(win.openings()).toEqual(['Hello.']);
  });

  it('does not replay the greeting when reopened without one', async () => {
    const h = harness();
    await launched(h);
    h.registry.close('default');

    await launched(h);

    expect(h.windows[1]!.openings()).toEqual([]);
  });

  it('opens a session and remembers it', async () => {
    const h = harness();
    await launched(h);

    expect(h.registry.openProfileIds()).toEqual(['default']);
  });

  it('gives each profile its own window and client', async () => {
    const h = harness();
    await launched(h, 'default');
    await launched(h, 'ford');

    expect(h.windows).toHaveLength(2);
    expect(h.clients).toHaveLength(2);
    expect(h.registry.openProfileIds().sort()).toEqual(['default', 'ford']);
  });
});

// The old `if (tileWin) return` was a silent no-op. A directory watch fires
// again on a profile whose files are touched, and `activate` needs to raise a
// specific tile — §4.3.1.
describe('launching a profile that already has a tile', () => {
  it('shows and focuses the existing tile instead of opening a second', async () => {
    const h = harness();
    await launched(h);

    await h.registry.launch(character('default'), 'default');

    expect(h.windows).toHaveLength(1);
    expect(h.windows[0]!.shown).toBe(1);
    expect(h.windows[0]!.focused).toBe(1);
  });

  it('un-minimises it', async () => {
    const h = harness();
    await launched(h);
    h.windows[0]!.minimized = true;

    await h.registry.launch(character('default'), 'default');

    expect(h.windows[0]!.restored).toBe(1);
  });
});

describe('the ready promise', () => {
  it('resolves on a failed load, so a launch never hangs', async () => {
    const h = harness();
    const launch = h.registry.launch(character('default'), 'default');
    h.windows[0]!.fireFailedLoad();

    await expect(launch).resolves.toBeUndefined();
  });

  it('resolves when the window is closed before it ever loads', async () => {
    const h = harness();
    const launch = h.registry.launch(character('default'), 'default');
    h.windows[0]!.fireClosed();

    await expect(launch).resolves.toBeUndefined();
  });
});

describe('routing updates', () => {
  it('draws an update for the session the tile is showing', async () => {
    const h = harness();
    await launched(h);

    h.clients[0]!.onUpdate('session-1', { sessionUpdate: 'agent_message_chunk' });

    expect(h.windows[0]!.updates()).toContainEqual({ sessionUpdate: 'agent_message_chunk' });
  });

  it('drops an update for a session the tile is not showing', async () => {
    const h = harness();
    await launched(h);
    const before = h.windows[0]!.updates().length;

    h.clients[0]!.onUpdate('some-other-session', { sessionUpdate: 'agent_message_chunk' });

    expect(h.windows[0]!.updates()).toHaveLength(before);
  });

  it('sends an update only to the tile that owns the client', async () => {
    const h = harness();
    await launched(h, 'default');
    await launched(h, 'ford');

    h.clients[1]!.onUpdate('session-1', { sessionUpdate: 'agent_message_chunk' });

    expect(h.windows[0]!.updates()).not.toContainEqual({
      sessionUpdate: 'agent_message_chunk',
    });
    expect(h.windows[1]!.updates()).toContainEqual({ sessionUpdate: 'agent_message_chunk' });
  });

  it('tells the tile when its agent exits', async () => {
    const h = harness();
    await launched(h);

    h.clients[0]!.onExit(1);

    expect(h.windows[0]!.updates()).toContainEqual({ sessionUpdate: 'circe/exited', code: 1 });
  });
});

describe('prompting', () => {
  it('sends to the tile’s own session and ends the turn when it resolves', async () => {
    const h = harness();
    await launched(h);

    const turn = h.registry.prompt('default', 'hello');
    expect(h.clients[0]!.prompts).toEqual([{ sessionId: 'session-1', text: 'hello' }]);

    h.clients[0]!.finishTurn();
    await turn;

    expect(h.windows[0]!.updates()).toContainEqual({ sessionUpdate: 'circe/turn-end' });
  });

  // Both outcomes end the turn: a failed prompt must not leave the previous
  // bubble streaming forever.
  it('ends the turn and says so when the prompt fails', async () => {
    const h = harness();
    await launched(h);
    h.clients[0]!.prompt = () => Promise.reject(new Error('connection closed'));

    await h.registry.prompt('default', 'hello');

    expect(h.windows[0]!.updates()).toContainEqual({ sessionUpdate: 'circe/turn-end' });
    expect(h.windows[0]!.openings().some((t) => t.includes('connection closed'))).toBe(true);
  });

  // There is no window to say anything into, so silence is the only option
  // here. Every branch that *does* have a tile ends in something visible.
  it('does nothing for a profile with no tile', async () => {
    const h = harness();
    await expect(h.registry.prompt('nobody', 'hello')).resolves.toBeUndefined();
  });
});

describe('closing a tile', () => {
  it('stops the client and forgets the tile', async () => {
    const h = harness();
    await launched(h);

    h.registry.close('default');

    expect(h.clients[0]!.stopped).toBeGreaterThan(0);
    expect(h.registry.openProfileIds()).toEqual([]);
  });

  it('stops the client when the window is closed natively', async () => {
    const h = harness();
    await launched(h);

    h.windows[0]!.fireClosed();

    expect(h.clients[0]!.stopped).toBeGreaterThan(0);
    expect(h.registry.openProfileIds()).toEqual([]);
  });

  it('leaves another profile’s tile alone', async () => {
    const h = harness();
    await launched(h, 'default');
    await launched(h, 'ford');

    h.registry.close('ford');

    expect(h.registry.openProfileIds()).toEqual(['default']);
    expect(h.clients[0]!.stopped).toBe(0);
  });
});

describe('supersession', () => {
  // The guard Phase 1 established, per profile. A launch that has been replaced
  // must not stop, draw into, or clear the launch that replaced it.
  it('a superseded launch does not clear the live tile’s session', async () => {
    const h = harness();
    const first = h.registry.launch(character('default'), 'default');
    const firstWin = h.windows[0]!;

    // The tile is closed and reopened while the first launch is still in flight.
    firstWin.fireClosed();
    await launched(h, 'default');
    await first;

    expect(h.registry.openProfileIds()).toEqual(['default']);
  });

  it('a stale exit handler does not draw into the new tile', async () => {
    const h = harness();
    await launched(h);
    const staleClient = h.clients[0]!;
    h.windows[0]!.fireClosed();
    await launched(h, 'default');
    const newWin = h.windows[1]!;

    staleClient.onExit(1);

    expect(newWin.updates()).not.toContainEqual({ sessionUpdate: 'circe/exited', code: 1 });
  });
});

describe('a launch that cannot reach its agent', () => {
  it('reaps the client and explains itself in the tile', async () => {
    const h = harness(new Error('spawn ENOENT'));
    const launch = h.registry.launch(character('default'), 'default');
    h.windows[0]!.fireLoaded();
    await launch;

    expect(h.clients[0]!.stopped).toBeGreaterThan(0);
    const text = h.windows[0]!.openings().join('\n');
    expect(text).toContain('spawn ENOENT');
    expect(text).toMatch(/hermes setup/);
  });

  it('reports a message typed while it was starting as unsent', async () => {
    const h = harness(new Error('spawn ENOENT'));
    const launch = h.registry.launch(character('default'), 'default');
    void h.registry.prompt('default', 'are you there?'); // held: launch in flight
    h.windows[0]!.fireLoaded();
    await launch;

    const text = h.windows[0]!.openings().join('\n');
    expect(text).toMatch(/message you typed while it was starting wasn't sent/i);
  });

  // The tile is gone from the registry, so a later message has nowhere to go
  // and must not resurrect it.
  it('forgets the tile, so the profile can be launched again', async () => {
    const h = harness(new Error('spawn ENOENT'));
    const launch = h.registry.launch(character('default'), 'default');
    h.windows[0]!.fireLoaded();
    await launch;

    expect(h.registry.openProfileIds()).toEqual([]);
  });
});

describe('routing an IPC message to the tile that sent it', () => {
  it('names the profile a window belongs to', async () => {
    const h = harness();
    await launched(h, 'default');
    await launched(h, 'ford');

    expect(h.registry.profileForSender(h.windows[1]!.sender)).toBe('ford');
  });

  // A window may only ever speak for itself — §4.3.1.
  it('answers null for a sender it does not recognise', async () => {
    const h = harness();
    await launched(h);

    expect(h.registry.profileForSender({})).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/tiles.test.ts`
Expected: FAIL — `Failed to resolve import "../src/main/tiles"`.

- [ ] **Step 3: Implement `tiles.ts`**

Create `src/main/tiles.ts`:

```ts
import type { Character } from '../shared/types';
import type { HermesRuntime } from './hermes/runtime';
import { restoreOrCreateSession, TileSession, type SessionClient } from './restore';

/**
 * The slice of `BrowserWindow` a tile actually needs, narrowed to an interface
 * so the registry imports no Electron and can be tested against an object.
 * `windows.ts` adapts a real window to this; `test/tiles.test.ts` supplies a
 * fake. This is the same treatment `restore.ts`'s `SessionClient` gets, applied
 * to the other half of what `index.ts` used to hold.
 */
export interface TileWindow {
  send(channel: string, payload: unknown): void;
  isDestroyed(): boolean;
  close(): void;
  show(): void;
  focus(): void;
  isMinimized(): boolean;
  restore(): void;
  /** True when an IPC event's `sender` is this window's own web contents. */
  ownsSender(sender: unknown): boolean;
  onceLoaded(cb: () => void): void;
  onceFailedLoad(cb: () => void): void;
  onceClosed(cb: () => void): void;
}

/** The slice of `AcpClient` a tile drives. Extends what `restore.ts` needs. */
export interface TileClient extends SessionClient {
  start(): Promise<void>;
  stop(): void;
  prompt(sessionId: string, text: string): Promise<void>;
}

export interface TileClientOptions {
  profileId: string;
  onUpdate(sessionId: string, update: Record<string, unknown>): void;
  onExit(code: number | null): void;
}

export interface TileDeps {
  hermes: HermesRuntime;
  createWindow(character: Character, profileId: string): TileWindow;
  createClient(opts: TileClientOptions): TileClient;
}

/** One profile's live tile. Everything `index.ts` used to hold in singletons. */
interface Tile {
  readonly profileId: string;
  readonly win: TileWindow;
  readonly client: TileClient;
  readonly session: TileSession;
  loaded: boolean;
  queue: string[];
  ready: Promise<void>;
}

export class TileRegistry {
  private readonly tiles = new Map<string, Tile>();

  constructor(private readonly deps: TileDeps) {}

  /** The profiles with a tile on screen right now. */
  openProfileIds(): string[] {
    return [...this.tiles.keys()];
  }

  has(profileId: string): boolean {
    return this.tiles.has(profileId);
  }

  /**
   * Which profile an IPC event belongs to, or null.
   *
   * Routing by sender rather than by a profile id the renderer supplies is
   * deliberate: a tile renders agent output through a markdown renderer that
   * does not sanitize, into a window holding `send()`. A renderer that could
   * name its own profile could name someone else's, and prompt an agent it does
   * not belong to. A window may only ever speak for itself (§4.3.1).
   */
  profileForSender(sender: unknown): string | null {
    for (const tile of this.tiles.values()) {
      if (tile.win.ownsSender(sender)) return tile.profileId;
    }
    return null;
  }

  /**
   * Opens this profile's tile, or raises it if it already has one.
   *
   * The old single-tile guard was `if (tileWin) return` — a silent no-op,
   * adequate when the only second caller was macOS's `activate`. Under a
   * directory watch a profile whose files are touched again must produce no
   * second tile, and `activate` has to be able to raise a *specific* one, so
   * this raises instead of returning.
   */
  async launch(character: Character, profileId: string, greeting: string | null = null): Promise<void> {
    const existing = this.tiles.get(profileId);
    if (existing) {
      this.raiseTile(existing);
      return;
    }

    const session = new TileSession();
    // Opened before the window exists, so there is no instant in which the tile
    // is on screen with an enabled input and nowhere for a message to go.
    session.beginLaunch();
    const win = this.deps.createWindow(character, profileId);

    // Captured, never read back off the map: `start()` and
    // `restoreOrCreateSession()` each await for up to 30s, easily enough time
    // for this tile to be closed and reopened, which spins up a second launch
    // with its own client. Every access to *this* launch's state goes through
    // these locals, and every write to the map is guarded by `isCurrent`.
    const client = this.deps.createClient({
      profileId,
      onUpdate: (sessionId, update) => {
        if (!isCurrent()) return; // this launch has been superseded
        // One client can serve several sessions; only the one on screen is drawn.
        if (sessionId !== session.activeSessionId) return;
        this.emit(win, update);
      },
      onExit: (code) => {
        if (!isCurrent()) return; // the exit belongs to an already-replaced client
        this.emit(win, { sessionUpdate: 'circe/exited', code });
      },
    });

    const tile: Tile = {
      profileId,
      win,
      client,
      session,
      loaded: false,
      // The opening message belongs to the handoff out of onboarding and
      // nowhere else: it says "Right now I'm the only agent you have", which
      // stops being true the moment the orchestrator creates the first
      // specialist. Reopening a tile must not replay it.
      queue: greeting === null ? [] : [greeting],
      ready: Promise.resolve(),
    };
    const isCurrent = (): boolean => this.tiles.get(profileId) === tile;
    this.tiles.set(profileId, tile);

    // `did-finish-load` is the happy path: it flushes the queue and marks the
    // tile ready to draw. A window can also fail to load, or be destroyed
    // before it ever loads — without an escape on those, `await ready`
    // downstream would hang forever and "every failure path lands on a fresh
    // session" would be a lie. Resolving twice is harmless.
    tile.ready = new Promise<void>((resolve) => {
      win.onceLoaded(() => {
        tile.loaded = true;
        for (const text of tile.queue.splice(0)) win.send('tile:opening', text);
        resolve();
      });
      win.onceFailedLoad(() => resolve());
      win.onceClosed(() => resolve());
    });

    // `close(profileId)` stops the client, but the native close button, Cmd+W
    // and `app.quit()` all bypass it and go straight to the window — the far
    // more instinctive way to dismiss a floating window, and nothing on that
    // path stopping the client leaks a `hermes acp` process per close.
    // `stop()` tolerates a second call, so no dedup is needed.
    win.onceClosed(() => {
      client.stop();
      if (isCurrent()) this.tiles.delete(profileId);
    });

    try {
      await client.start();
      await restoreOrCreateSession({
        hermes: this.deps.hermes,
        client,
        profileId,
        session,
        emit: (update) => this.emit(win, update),
        tileReady: tile.ready,
        isCurrent,
        sendPrompt: (sessionId, text) => this.send(tile, sessionId, text),
      });
    } catch (err) {
      client.stop();
      if (!isCurrent()) return;
      this.tiles.delete(profileId);
      // Closes the launch window before anything else is drawn, so a message
      // typed after this point is refused out loud rather than held for a
      // session that is never coming.
      const unsent = session.failLaunch();
      session.reset();
      const message = err instanceof Error ? err.message : String(err);
      this.say(tile,
        "I couldn't reach the Hermes agent behind this tile, so I can't respond yet. " +
          'Check that Hermes is installed and set up (`hermes setup` in a terminal), ' +
          `then close this tile and start over.\n\n(${message})`,
      );
      // Whatever was typed while the tile was starting is already drawn as the
      // user's own bubble. Saying nothing would leave it sitting unanswered
      // forever, which is the silence the holding pen exists to avoid.
      if (unsent.length > 0) {
        this.say(tile,
          unsent.length === 1
            ? "The message you typed while it was starting wasn't sent."
            : "The messages you typed while it was starting weren't sent.",
        );
      }
    }
  }

  /**
   * Routes a message the user typed. Every branch ends in something they can
   * see: the renderer has already drawn their bubble, so returning quietly is
   * not one of the options.
   */
  async prompt(profileId: string, text: string): Promise<void> {
    const tile = this.tiles.get(profileId);
    if (!tile) return;
    const route = tile.session.route(text);
    // Held: a launch is in flight and will either send this or, if it fails,
    // say so in the tile. Either way the user hears back.
    if (route.kind === 'held') return;
    if (route.kind === 'no-session') {
      this.emit(tile.win, { sessionUpdate: 'circe/turn-end' });
      this.say(tile, "Your message wasn't sent — this tile has no agent session right now.");
      return;
    }
    await this.send(tile, route.sessionId, text);
  }

  /** Closes a tile from inside the app. The native close path lands in the same handler. */
  close(profileId: string): void {
    const tile = this.tiles.get(profileId);
    if (!tile) return;
    tile.client.stop();
    tile.win.close();
    this.tiles.delete(profileId);
  }

  /** Brings a tile to the front. Used by `activate` and by a duplicate launch. */
  raise(profileId: string): boolean {
    const tile = this.tiles.get(profileId);
    if (!tile) return false;
    this.raiseTile(tile);
    return true;
  }

  private raiseTile(tile: Tile): void {
    if (tile.win.isDestroyed()) return;
    if (tile.win.isMinimized()) tile.win.restore();
    tile.win.show();
    tile.win.focus();
  }

  /**
   * Sends one message and closes the turn behind it.
   *
   * A turn ends when `prompt` resolves — that is ACP's completion signal, and
   * the renderer has no other way to know a reply is finished. Both outcomes
   * end it, so a failed prompt doesn't leave the previous bubble open forever.
   * Never rejects: `restore.ts` awaits this to deliver held messages one at a
   * time, and a rejection there is not a launch failure.
   */
  private send(tile: Tile, sessionId: string, text: string): Promise<void> {
    return tile.client.prompt(sessionId, text).then(
      () => this.emit(tile.win, { sessionUpdate: 'circe/turn-end' }),
      (err: unknown) => {
        this.emit(tile.win, { sessionUpdate: 'circe/turn-end' });
        const message = err instanceof Error ? err.message : String(err);
        // Deliberately does not name a cause: this fires for a dead connection,
        // a stopped client and an agent-side error alike, and the attached
        // message is the only thing that actually knows which.
        this.say(tile, `Your message wasn't sent. (${message})`);
      },
    );
  }

  /** Circe's own prose. Queued until the renderer has registered its listeners. */
  private say(tile: Tile, text: string): void {
    if (!tile.loaded) {
      tile.queue.push(text);
      return;
    }
    // A prompt rejection can land after the user has closed the tile, and
    // `close()` destroys the window before the closed handler runs.
    if (!tile.win.isDestroyed()) tile.win.send('tile:opening', text);
  }

  /**
   * Circe's own lifecycle events ride the same channel as real ACP updates,
   * namespaced so they can never collide with a protocol `sessionUpdate` kind.
   */
  private emit(win: TileWindow, update: Record<string, unknown>): void {
    if (!win.isDestroyed()) win.send('tile:update', update);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/tiles.test.ts`
Expected: PASS, all 24 tests.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: still failing in `src/main/index.ts` only (Task 4's known breakage). `tiles.ts` itself must be clean — confirm no error mentions `src/main/tiles.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/main/tiles.ts test/tiles.test.ts
git commit -m "feat: a testable per-profile tile registry

Every behaviour tested here has lived in index.ts untested since it was
written, because index.ts imports electron at module scope. Fleet tiles turn
each of its singletons into a per-profile map, so this file was being rewritten
either way; doing it behind a seam is what makes the rewrite checkable.

The supersession guard Phase 1 established survives the move, now per profile,
and is tested for the first time against a real registry rather than a
reimplementation of one."
```

---

### Task 6: `index.ts` uses the registry

**Files:**
- Modify: `src/main/index.ts` (whole file), `src/main/windows.ts` (add the `TileWindow` adapter)
- Test: none new — `test/tiles.test.ts` covers the behaviour; this task is the wiring that was extracted from.

**Interfaces:**
- Consumes: `TileRegistry`, `TileWindow`, `TileDeps` (Task 5); `characterFor`, `readStartup`, `serializeLastLaunch` (Task 4).
- Produces: `adaptTileWindow(win: BrowserWindow): TileWindow` from `windows.ts`.

**Why the adapter lives in `windows.ts`:** it is the only place that already knows what a `BrowserWindow` is. Keeping it there means `tiles.ts` never imports Electron, which is the entire point of the seam.

**Note on scope:** `boot` still opens exactly one tile after this task. Task 9 makes it open the fleet. Splitting them keeps this task reviewable as "the same behaviour, rewired" rather than "new behaviour and a rewire at once".

- [ ] **Step 1: Add the adapter to `windows.ts`**

Add to `src/main/windows.ts`:

```ts
import type { TileWindow } from './tiles';

/**
 * Presents a real window as the narrow surface `tiles.ts` consumes. The
 * registry imports no Electron; this is the one place the two meet.
 *
 * `ownsSender` compares against `webContents` because that is what an
 * `IpcMainEvent.sender` is — it is how a message is attributed to the window
 * that actually sent it, rather than to a profile id the renderer names.
 */
export function adaptTileWindow(win: BrowserWindow): TileWindow {
  return {
    send: (channel, payload) => {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    },
    isDestroyed: () => win.isDestroyed(),
    close: () => win.close(),
    show: () => win.show(),
    focus: () => win.focus(),
    isMinimized: () => win.isMinimized(),
    restore: () => win.restore(),
    ownsSender: (sender) => !win.isDestroyed() && sender === win.webContents,
    onceLoaded: (cb) => win.webContents.once('did-finish-load', cb),
    onceFailedLoad: (cb) => win.webContents.once('did-fail-load', cb),
    onceClosed: (cb) => win.once('closed', cb),
  };
}
```

- [ ] **Step 2: Rewrite `index.ts`'s tile half**

In `src/main/index.ts`, delete these declarations and functions entirely: `tileWin`, `acp`, `tileLoaded`, `tileQueue`, `tileReady`, `tileSession`, `lastLaunch`, `sendToTile`, `sendTileUpdate`, `sendPrompt`, and `launchTile`. Replace them with a registry, constructed in `boot`:

```ts
import { AcpClient } from './acp';
import { TileRegistry } from './tiles';
import { adaptTileWindow, createTileWindow, createWizardWindow } from './windows';
import { characterFor, readStartup, serializeLastLaunch, LAST_LAUNCH_PATH } from './startup';

let wizardWin: BrowserWindow | null = null;
let hermes: RealHermes;
let wizard: Wizard | null = null;
let tiles: TileRegistry;

/**
 * The registry owns every tile. `index.ts` keeps only what needs Electron:
 * the wizard, the IPC channels, and the app lifecycle.
 */
function createRegistry(): TileRegistry {
  return new TileRegistry({
    hermes,
    createWindow: (character, profileId) => adaptTileWindow(createTileWindow(character, profileId)),
    createClient: (opts) => new AcpClient(opts),
  });
}
```

Replace the two tile IPC handlers in `registerIpc` with sender-routed versions:

```ts
  // Routed by sender, never by a profile id the renderer supplies: a tile
  // renders unsanitized agent output into a window holding `send()`, so a
  // renderer that could name its own profile could name someone else's.
  ipcMain.on('tile:prompt', (e, text: string) => {
    const profileId = tiles.profileForSender(e.sender);
    if (profileId === null) return;
    void tiles.prompt(profileId, text);
  });
  ipcMain.on('tile:close', (e) => {
    const profileId = tiles.profileForSender(e.sender);
    if (profileId === null) return;
    tiles.close(profileId);
  });
```

In `openWizard`, the `launching` listener becomes:

```ts
  w.onChange((s) => {
    if (wizard !== w) return;
    if (s.kind !== 'launching') return;
    void tiles.launch(s.character, s.profileId, openingMessage(s.character));
    wizardWin?.close();
    wizardWin = null;
  });
```

The wizard window close moved out of `launchTile` and to the call site, because the registry does not know a wizard exists. The reasoning that put it *before* the session work (Amendment 2, and the later move ahead of held-message delivery) is preserved: it closes as soon as the tile is launched, not after the first turn.

Rewrite `boot` and `activate`:

```ts
async function boot(): Promise<void> {
  hermes = new RealHermes();
  tiles = createRegistry();
  registerIpc();

  const startup = await readStartup(hermes);
  if (startup.kind === 'fleet') {
    await openFleet(startup.mainProfileId);
  } else {
    openWizard();
  }

  app.on('activate', () => {
    if (tiles.openProfileIds().length > 0) {
      for (const id of tiles.openProfileIds()) tiles.raise(id);
      return;
    }
    if (wizardWin && !wizardWin.isDestroyed()) {
      if (wizardWin.isMinimized()) wizardWin.restore();
      wizardWin.show();
      wizardWin.focus();
      return;
    }
    void boot();
  });
}

/** Opens a tile for the main operator. Task 9 widens this to the whole fleet. */
async function openFleet(mainProfileId: string): Promise<void> {
  const profiles = await hermes.listProfiles();
  const main = profiles.find((p) => p.id === mainProfileId) ?? profiles.find((p) => p.id === 'default');
  if (!main) return;
  await tiles.launch(await characterFor(hermes, main), main.id);
}
```

`activate` re-runs `boot` when nothing is open, which is what "reopen Circe" has to mean once the wizard is gone and the tiles have been closed: `readStartup` decides again from disk. It is idempotent — `registerIpc` uses `ipcMain.on`, and re-registering would double every handler, so guard it:

```ts
let ipcRegistered = false;
function registerIpc(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;
  // …existing handlers…
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS — clean for the first time since Task 4.

- [ ] **Step 4: Full suite**

Run: `npm test`
Expected: PASS. No test imports `index.ts`, so this step proves only that nothing else broke; the walkthrough in Task 10 is what verifies this file.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: succeeds. This is the only automated check that `index.ts` is even loadable.

- [ ] **Step 6: Commit**

```bash
git add src/main/index.ts src/main/windows.ts
git commit -m "refactor: index.ts drives the tile registry

index.ts keeps what needs Electron — the wizard, the IPC channels, the app
lifecycle — and nothing else. tile:prompt and tile:close now resolve their tile
from event.sender, so a window can only ever speak for itself.

Still opens exactly one tile; the fleet comes next. Split that way so this
commit is reviewable as the same behaviour rewired, not as new behaviour."
```

---

### Task 7: Tiles open where the user is looking

**Files:**
- Create: `src/main/tileLayout.ts` (the placement maths and the size constants)
- Modify: `src/main/windows.ts:46-63` (`createTileWindow`), `src/main/tiles.ts` (`createWindow` gains an index), `src/main/index.ts` (forward it)
- Test: `test/tileLayout.test.ts` (create)

**Interfaces:**
- Consumes: `TileDeps` (Task 5).
- Produces: `interface Rect`; `TILE_W`, `TILE_H`; `tilePosition(workArea: Rect, index: number): { x: number; y: number }` — all from `./tileLayout`, re-exported by `windows.ts` for existing importers; `createTileWindow(character, profileId, index?)`.

**Why a separate module and not just an exported function:** `src/main/windows.ts` imports `electron` at module scope, and `vitest.config.ts` runs `environment: 'node'` — so a test importing `windows.ts` throws before any test body runs, exactly as `index.ts` does. The maths has to live somewhere with no Electron import to be testable at all. `windows.ts` re-exports `TILE_W`/`TILE_H` so nothing that imports them today has to change.

**The two defects, both observed live on 2026-08-16 and both invisible to the suite (§4.6):**

1. `screen.getPrimaryDisplay()` puts a tile on the primary monitor regardless of where the user is. Onboarding completed on a laptop screen put the tile at x=3370 on a 3840-wide external display.
2. Nothing raises a tile on creation. A frameless, transparent, chrome-less window is created behind whatever the user had open.

**Why the maths is extracted:** `screen` is Electron, so `createTileWindow` cannot be tested. `tilePosition` is arithmetic and can be, which is where the cascade's wrap-around actually needs checking.

- [ ] **Step 1: Write the failing test**

Create `test/tileLayout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { tilePosition, TILE_H, TILE_W } from '../src/main/tileLayout';

/** A 1920×1080 display whose work area starts below a menu bar. */
const WORK_AREA = { x: 0, y: 25, width: 1920, height: 1055 };
/** An external display to the right of the primary one — negative and offset origins are real. */
const RIGHT_OF = { x: 1920, y: 0, width: 3840, height: 2160 };

describe('tilePosition', () => {
  it('anchors the first tile to the top right of the work area', () => {
    expect(tilePosition(WORK_AREA, 0)).toEqual({ x: 1920 - TILE_W - 40, y: 25 + 40 });
  });

  // The anchor is relative to the display, not to the desktop origin, or a
  // tile lands on the wrong monitor — the x=3370 defect.
  it('anchors to the display it was given, not to the desktop origin', () => {
    expect(tilePosition(RIGHT_OF, 0)).toEqual({ x: 1920 + 3840 - TILE_W - 40, y: 40 });
  });

  it('cascades each further tile down and to the left', () => {
    const first = tilePosition(WORK_AREA, 0);
    const second = tilePosition(WORK_AREA, 1);
    expect(second.x).toBeLessThan(first.x);
    expect(second.y).toBeGreaterThan(first.y);
  });

  it('keeps every tile of a large fleet fully inside the work area', () => {
    for (let i = 0; i < 12; i++) {
      const { x, y } = tilePosition(WORK_AREA, i);
      expect(x).toBeGreaterThanOrEqual(WORK_AREA.x);
      expect(y).toBeGreaterThanOrEqual(WORK_AREA.y);
      expect(x + TILE_W).toBeLessThanOrEqual(WORK_AREA.x + WORK_AREA.width);
      expect(y + TILE_H).toBeLessThanOrEqual(WORK_AREA.y + WORK_AREA.height);
    }
  });

  // A laptop screen with a big fleet is the case that wraps.
  it('wraps rather than marching off a short display', () => {
    const short = { x: 0, y: 25, width: 1440, height: 700 };
    const positions = Array.from({ length: 8 }, (_, i) => tilePosition(short, i));
    for (const { y } of positions) expect(y + TILE_H).toBeLessThanOrEqual(725);
    // Wrapping must not stack two tiles in exactly the same place.
    expect(new Set(positions.map((p) => `${p.x},${p.y}`)).size).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/tileLayout.test.ts`
Expected: FAIL — `Failed to resolve import "../src/main/tileLayout"`.

- [ ] **Step 3: Implement the layout module**

Create `src/main/tileLayout.ts`. It must import nothing — no Electron, no Node — so a test can load it.

```ts
export const TILE_W = 430;
export const TILE_H = 480;


/** The rectangle part of an Electron `Display.workArea`, with no Electron types. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const TILE_MARGIN = 40;
const CASCADE_STEP = 32;

/**
 * Where the nth tile of a fleet goes, inside one display's work area.
 *
 * Anchored to the top right of *that display* — the co-ordinates are desktop
 * co-ordinates, so `workArea.x` is not zero on anything but the primary
 * monitor, and treating it as zero is exactly how a tile ended up at x=3370
 * on the wrong screen.
 *
 * Cascades down-and-left so each tile's header stays visible, and wraps back
 * to the top when the next step would push a tile off the bottom — a laptop
 * screen with a seven-agent fleet runs out of vertical room fast. The wrap
 * shifts the column left so a wrapped tile never lands exactly on top of an
 * earlier one.
 */
export function tilePosition(workArea: Rect, index: number): { x: number; y: number } {
  const perColumn = Math.max(
    1,
    Math.floor((workArea.height - TILE_MARGIN * 2 - TILE_H) / CASCADE_STEP) + 1,
  );
  const column = Math.floor(index / perColumn);
  const row = index % perColumn;
  const rawX = workArea.x + workArea.width - TILE_W - TILE_MARGIN - row * CASCADE_STEP - column * (TILE_W + CASCADE_STEP);
  const rawY = workArea.y + TILE_MARGIN + row * CASCADE_STEP;
  return {
    // Clamped so a fleet larger than the screen piles up in the corner rather
    // than walking off it. Piled-up tiles are still reachable; off-screen ones
    // are not.
    x: Math.max(workArea.x, Math.min(rawX, workArea.x + workArea.width - TILE_W)),
    y: Math.max(workArea.y, Math.min(rawY, workArea.y + workArea.height - TILE_H)),
  };
}
```

In `src/main/windows.ts`, delete the `TILE_W`/`TILE_H` declarations and re-export them from the new module so existing importers are unaffected:

```ts
import { tilePosition, TILE_H, TILE_W } from './tileLayout';

export { TILE_H, TILE_W };
```

Then replace `createTileWindow`'s first line and its `x`/`y`, and raise the window before returning:

```ts
export function createTileWindow(
  character: Character,
  profileId: string,
  index = 0,
): BrowserWindow {
  // The display holding the cursor, not the primary one. Onboarding finished on
  // a laptop screen used to put the tile on a 3840-wide external display.
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y } = tilePosition(workArea, index);
  const win = new BrowserWindow({
    width: TILE_W,
    height: TILE_H,
    x,
    y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { preload: join(__dirname, '../preload/tile.js') },
  });
  pinToItsOwnDocument(win);
  win.loadFile(join(__dirname, '../renderer/tile/index.html'), {
    query: { profile: profileId, character: JSON.stringify(character) },
  });
  // Nothing raised a tile on creation, so a frameless, transparent, chrome-less
  // window opened behind whatever the user had in front. `show()` on an
  // already-visible window raises it.
  win.show();
  win.focus();
  return win;
}
```

- [ ] **Step 4: Pass the index through the registry**

`TileDeps.createWindow` gains the index so a fleet cascades. In `src/main/tiles.ts`, change the interface and the call:

```ts
  createWindow(character: Character, profileId: string, index: number): TileWindow;
```

and in `launch`, `const win = this.deps.createWindow(character, profileId, this.tiles.size);`

In `src/main/index.ts`'s `createRegistry`, forward it:

```ts
    createWindow: (character, profileId, index) =>
      adaptTileWindow(createTileWindow(character, profileId, index)),
```

In `test/tiles.test.ts`'s harness, the `createWindow` fake already ignores its arguments, so no change is needed.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/tileLayout.test.ts test/tiles.test.ts && npm run typecheck`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add src/main/tileLayout.ts src/main/windows.ts src/main/tiles.ts src/main/index.ts test/tileLayout.test.ts
git commit -m "fix: open tiles on the display the user is looking at, in front

Two defects seen live on 2026-08-16 and invisible to the suite: tiles anchored
to getPrimaryDisplay(), so finishing onboarding on a laptop screen put the tile
at x=3370 on an external display; and nothing raised a tile on creation, so a
frameless transparent window opened behind whatever was in front.

The placement maths is extracted from the Electron call so the cascade's
wrap-around is actually tested."
```

---

### Task 8: Which profiles get a tile, and noticing new ones

**Files:**
- Create: `src/main/fleet.ts`
- Modify: `src/main/hermes/runtime.ts` (add `watchHome` to the interface), `src/main/hermes/real.ts` (implement it), `test/fake/hermes.ts` (fake it)
- Test: `test/fleet.test.ts` (create)

**Interfaces:**
- Consumes: `HermesRuntime`, `characterFor` (Task 4).
- Produces:
  - `HermesRuntime.watchHome(onChange: (relPath: string) => void): () => void`
  - `tileableProfiles(hermes: HermesRuntime): Promise<HermesProfile[]>`
  - `class FleetWatch` with `constructor(deps: FleetWatchDeps)`, `start(): () => void`

**Why a watch and not a tool (§4.3):** a Circe-provided capability for creating peers would mean an agent needs Circe to bring a peer into existence — a gentler form of the exact inversion constraint 10 exists to prevent — and it would fail the constraint's own test, since a profile created at a terminal would never get a tile.

**Why the readiness rule is `isRealSoul`:** `fs.watch` fires when a profile directory is created, before `SOUL.md` is written. Tiling then spawns an agent against a persona that does not exist yet — the same class of defect as commit `8733673`. §4.3: "tile a profile once it describes itself."

**Why the watch is recursive on the home:** `profiles/` does not exist on a fresh install with only `default`, so watching it directly fails with `ENOENT` and would need its own creation watched first. macOS is the only platform (constraint 1) and supports recursive `fs.watch` through FSEvents, so one watcher on the home covers both. Events are filtered to paths under `profiles/` because the home also carries `state.db`, logs and session files, which change constantly.

- [ ] **Step 1: Write the failing tests**

Create `test/fleet.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { FleetWatch, tileableProfiles } from '../src/main/fleet';
import { FakeHermes, INSTALLED_EMPTY, INSTALLED_WITH_AGENTS, SCAFFOLD_SOUL } from './fake/hermes';

describe('tileableProfiles', () => {
  it('lists a configured fleet', async () => {
    const ids = (await tileableProfiles(new FakeHermes(INSTALLED_WITH_AGENTS))).map((p) => p.id);
    expect(ids).toContain('default');
    expect(ids).toContain('ford');
  });

  // The readiness rule: a profile is tileable once it describes itself.
  it('omits a profile that is still the stock scaffold', async () => {
    const hermes = new FakeHermes({
      ...INSTALLED_WITH_AGENTS,
      files: { ...INSTALLED_WITH_AGENTS.files, 'profiles/ford/SOUL.md': SCAFFOLD_SOUL },
    });

    const ids = (await tileableProfiles(hermes)).map((p) => p.id);
    expect(ids).not.toContain('ford');
    expect(ids).toContain('default');
  });

  it('omits a profile with no SOUL.md at all', async () => {
    const hermes = new FakeHermes({
      ...INSTALLED_EMPTY,
      models: { default: 'claude-opus-5', ford: 'claude-opus-5' },
      files: { 'SOUL.md': '# Trillian — the one who keeps the plot\n' },
    });

    expect((await tileableProfiles(hermes)).map((p) => p.id)).toEqual(['default']);
  });
});

describe('FleetWatch', () => {
  /**
   * A function, not a shared const: these tests add a profile mid-run by
   * mutating `scenarioModels`, and a spread copies `models` by reference — so a
   * shared fixture would leak `ford` into `INSTALLED_EMPTY` itself and into
   * every other test file that imports it.
   */
  function configured() {
    return {
      ...INSTALLED_EMPTY,
      models: { ...INSTALLED_EMPTY.models },
      files: { 'SOUL.md': '# Trillian — the one who keeps the plot\n' },
    };
  }

  function watcher(hermes: FakeHermes, isOpen: (id: string) => boolean = () => false) {
    const opened: string[] = [];
    const watch = new FleetWatch({
      hermes,
      isOpen,
      onProfile: (profile) => {
        opened.push(profile.id);
      },
      debounceMs: 10,
    });
    return { watch, opened };
  }

  it('opens a tile for a profile that becomes real', async () => {
    const hermes = new FakeHermes(configured());
    const { watch, opened } = watcher(hermes);
    const stop = watch.start();

    hermes.scenarioModels.ford = 'claude-opus-5';
    await hermes.writeHomeFile('profiles/ford/SOUL.md', '# Ford — the one who finds the exit\n');
    hermes.fireHomeChange('profiles/ford/SOUL.md');
    await vi.waitFor(() => expect(opened).toEqual(['ford']));

    stop();
  });

  // fs.watch fires on directory creation, before SOUL.md exists. Tiling then
  // spawns an agent against a persona that is not there yet (cf. 8733673).
  it('does not tile a directory that has no persona yet', async () => {
    const hermes = new FakeHermes(configured());
    const { watch, opened } = watcher(hermes);
    const stop = watch.start();

    hermes.scenarioModels.ford = 'claude-opus-5';
    hermes.fireHomeChange('profiles/ford');
    await new Promise((r) => setTimeout(r, 40));

    expect(opened).toEqual([]);
    stop();
  });

  it('tiles it once the persona lands on a later event', async () => {
    const hermes = new FakeHermes(configured());
    const { watch, opened } = watcher(hermes);
    const stop = watch.start();

    hermes.scenarioModels.ford = 'claude-opus-5';
    hermes.fireHomeChange('profiles/ford');
    await new Promise((r) => setTimeout(r, 40));
    await hermes.writeHomeFile('profiles/ford/SOUL.md', '# Ford — the one who finds the exit\n');
    hermes.fireHomeChange('profiles/ford/SOUL.md');

    await vi.waitFor(() => expect(opened).toEqual(['ford']));
    stop();
  });

  it('never opens a second tile for a profile that already has one', async () => {
    const hermes = new FakeHermes(configured());
    const open = new Set<string>();
    const { watch, opened } = watcher(hermes, (id) => open.has(id));
    const stop = watch.start();

    hermes.scenarioModels.ford = 'claude-opus-5';
    await hermes.writeHomeFile('profiles/ford/SOUL.md', '# Ford — the one who finds the exit\n');
    hermes.fireHomeChange('profiles/ford/SOUL.md');
    await vi.waitFor(() => expect(opened).toEqual(['ford']));
    open.add('ford');

    hermes.fireHomeChange('profiles/ford/SOUL.md');
    await new Promise((r) => setTimeout(r, 40));

    expect(opened).toEqual(['ford']);
    stop();
  });

  it('coalesces a burst of events into one enumeration', async () => {
    const hermes = new FakeHermes(configured());
    const { watch, opened } = watcher(hermes);
    const stop = watch.start();
    hermes.scenarioModels.ford = 'claude-opus-5';
    await hermes.writeHomeFile('profiles/ford/SOUL.md', '# Ford — the one who finds the exit\n');

    for (let i = 0; i < 20; i++) hermes.fireHomeChange('profiles/ford/SOUL.md');
    await vi.waitFor(() => expect(opened).toEqual(['ford']));

    expect(opened).toEqual(['ford']);
    stop();
  });

  // The home also carries state.db, logs and session files, which change
  // constantly. Re-enumerating profiles on every one of those is waste.
  it('ignores changes outside the profiles directory', async () => {
    const hermes = new FakeHermes(configured());
    const { watch, opened } = watcher(hermes);
    const stop = watch.start();

    hermes.fireHomeChange('state.db');
    hermes.fireHomeChange('circe/state.json');
    await new Promise((r) => setTimeout(r, 40));

    expect(opened).toEqual([]);
    stop();
  });

  it('stops watching when told to', async () => {
    const hermes = new FakeHermes(configured());
    const { watch, opened } = watcher(hermes);
    const stop = watch.start();
    stop();

    hermes.scenarioModels.ford = 'claude-opus-5';
    await hermes.writeHomeFile('profiles/ford/SOUL.md', '# Ford — the one who finds the exit\n');
    hermes.fireHomeChange('profiles/ford/SOUL.md');
    await new Promise((r) => setTimeout(r, 40));

    expect(opened).toEqual([]);
  });

  // A watch that dies on one bad enumeration stops the core loop silently.
  it('survives an enumeration that throws', async () => {
    const hermes = new FakeHermes(configured());
    const { watch, opened } = watcher(hermes);
    const stop = watch.start();
    const realList = hermes.listProfiles.bind(hermes);
    hermes.listProfiles = async () => {
      hermes.listProfiles = realList;
      throw new Error('hermes exploded');
    };

    hermes.fireHomeChange('profiles/ford/SOUL.md');
    await new Promise((r) => setTimeout(r, 40));

    hermes.scenarioModels.ford = 'claude-opus-5';
    await hermes.writeHomeFile('profiles/ford/SOUL.md', '# Ford — the one who finds the exit\n');
    hermes.fireHomeChange('profiles/ford/SOUL.md');
    await vi.waitFor(() => expect(opened).toEqual(['ford']));

    stop();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/fleet.test.ts`
Expected: FAIL — `Failed to resolve import "../src/main/fleet"`.

- [ ] **Step 3: Add `watchHome` to the runtime interface**

In `src/main/hermes/runtime.ts`, add to `HermesRuntime`:

```ts
  /**
   * Watches the Hermes home for changes, calling back with the path that
   * changed, relative to the home. Returns a function that stops watching.
   *
   * Recursive, because `profiles/` does not exist on a fresh install and
   * watching a directory that is not there fails rather than waiting for it.
   * macOS only (constraint 1), which is where recursive watching works.
   */
  watchHome(onChange: (relPath: string) => void): () => void;
```

In `src/main/hermes/real.ts`, add the import `import { watch } from 'node:fs';` and the method:

```ts
  watchHome(onChange: (relPath: string) => void): () => void {
    let watcher: import('node:fs').FSWatcher;
    try {
      watcher = watch(this.p.home, { recursive: true, persistent: false }, (_event, filename) => {
        // `filename` is null on some events; there is nothing to attribute
        // them to, and the caller re-enumerates anyway on the ones we forward.
        if (filename) onChange(filename.toString());
      });
    } catch (err) {
      // A home that cannot be watched costs the live-update half of the fleet:
      // tiles still open at boot, new agents just need a restart to appear.
      // Failing the app over it would be worse.
      console.warn(`Could not watch the Hermes home; new agents will need a restart.`, err);
      return () => {};
    }
    watcher.on('error', (err) => {
      console.warn('Stopped watching the Hermes home.', err);
    });
    return () => watcher.close();
  }
```

In `test/fake/hermes.ts`, add the fake side:

```ts
  private homeWatchers = new Set<(relPath: string) => void>();

  /** Mutable so a test can add a profile mid-run, as `hermes profile create` would. */
  get scenarioModels(): Record<string, string> {
    return this.scenario.models;
  }

  watchHome(onChange: (relPath: string) => void): () => void {
    this.homeWatchers.add(onChange);
    return () => this.homeWatchers.delete(onChange);
  }

  /** Fires what a real `fs.watch` would fire. */
  fireHomeChange(relPath: string): void {
    for (const cb of this.homeWatchers) cb(relPath);
  }
```

`FakeHermes`'s constructor already takes `private scenario: Scenario`, so `scenarioModels` reaches it; change the constructor parameter to `public scenario: Scenario` if TypeScript objects to the getter's access.

- [ ] **Step 4: Implement `fleet.ts`**

Create `src/main/fleet.ts`:

```ts
import type { HermesProfile } from '../shared/types';
import type { HermesRuntime } from './hermes/runtime';

/**
 * The profiles that deserve a tile: the ones that describe themselves.
 *
 * `isReal` is Hermes-derived and is exactly "the SOUL.md has an H1" — spec
 * §5.4's realness rule. A profile that is still Hermes's stock scaffold has no
 * character to show and no persona for an agent to load, so tiling it would put
 * an unnamed grey window in front of the user.
 */
export async function tileableProfiles(hermes: HermesRuntime): Promise<HermesProfile[]> {
  return (await hermes.listProfiles()).filter((p) => p.isReal);
}

export interface FleetWatchDeps {
  hermes: HermesRuntime;
  /** True when this profile already has a tile. */
  isOpen(profileId: string): boolean;
  /** Called once per profile that has become tileable. */
  onProfile(profile: HermesProfile): void | Promise<void>;
  /** The prototype settles at 600ms; tests run it far shorter. */
  debounceMs?: number;
}

/**
 * Opens a tile when a new agent appears on disk.
 *
 * This is the visible half of the product's core loop: the orchestrator creates
 * a specialist through conversation and it materialises on the desktop. It is a
 * watch rather than a tool Circe exposes because an agent must not need a
 * Circe-provided capability to bring a peer into existence — that is constraint
 * 10's inversion in a gentler form, and it would leave a profile created at a
 * terminal with no tile (§4.3).
 *
 * Debounced because a profile's creation is several filesystem events — the
 * directory, then `SOUL.md`, then whatever else the creator writes — and
 * because the readiness condition is only met partway through. Every fire
 * re-enumerates from Hermes rather than trusting the event's path, so a burst
 * costs one enumeration and a half-written profile is simply not yet tileable.
 */
export class FleetWatch {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(private readonly deps: FleetWatchDeps) {}

  start(): () => void {
    const unwatch = this.deps.hermes.watchHome((relPath) => {
      // The home also carries `state.db`, logs, and session files, all of which
      // change constantly during a conversation. Only a profile directory can
      // produce a new agent.
      if (!relPath.startsWith('profiles/') && relPath !== 'profiles') return;
      this.schedule();
    });
    return () => {
      this.stopped = true;
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      unwatch();
    };
  }

  private schedule(): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.sweep();
    }, this.deps.debounceMs ?? 600);
  }

  private async sweep(): Promise<void> {
    if (this.stopped) return;
    let profiles: HermesProfile[];
    try {
      profiles = await tileableProfiles(this.deps.hermes);
    } catch (err) {
      // A watch that dies on one bad enumeration stops the core loop with no
      // sign to the user. The next event sweeps again.
      console.warn('Could not enumerate profiles; will try again on the next change.', err);
      return;
    }
    for (const profile of profiles) {
      if (this.stopped) return;
      if (this.deps.isOpen(profile.id)) continue;
      try {
        await this.deps.onProfile(profile);
      } catch (err) {
        console.warn(`Could not open a tile for profile "${profile.id}".`, err);
      }
    }
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/fleet.test.ts && npm run typecheck`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add src/main/fleet.ts src/main/hermes/runtime.ts src/main/hermes/real.ts \
        test/fleet.test.ts test/fake/hermes.ts
git commit -m "feat: notice an agent that appears on disk

A watch, not a tool Circe exposes: an agent must not need a Circe capability to
bring a peer into existence, and a profile created at a terminal has to get a
tile too. Readiness is the constraint itself — tile a profile once it describes
itself — because fs.watch fires on directory creation, before SOUL.md exists,
and tiling then spawns an agent against a persona that is not there (cf. 8733673).

Recursive on the home rather than on profiles/, which does not exist on a fresh
install; events outside profiles/ are filtered out because the home carries
state.db and logs."
```

---

### Task 9: Boot opens the fleet

**Files:**
- Modify: `src/main/index.ts` (`boot`, `openFleet`)
- Test: none new — `test/fleet.test.ts` and `test/tiles.test.ts` cover the parts that can be tested; the walkthrough covers this wiring.

**Interfaces:**
- Consumes: `tileableProfiles`, `FleetWatch` (Task 8); `characterFor` (Task 4); `TileRegistry` (Task 5).
- Produces: nothing new.

**Why the main operator opens last:** each `createTileWindow` calls `show()` and `focus()`, so with a seven-agent fleet the last one opened lands on top. The main operator is the one the user expects in front (§6.6), so it goes last.

- [ ] **Step 1: Implement**

In `src/main/index.ts`, replace the placeholder `openFleet` from Task 6 with:

```ts
let fleetWatch: (() => void) | null = null;

/**
 * Opens a tile for every agent on disk, and keeps watching for more.
 *
 * The main operator is opened last because `createTileWindow` raises each
 * window as it appears, so the last one lands in front — and that is the tile
 * the user expects to be looking at.
 *
 * Tiles open in sequence rather than in parallel: each one spawns a `hermes
 * acp` child and waits on a handshake, and a seven-agent fleet starting seven
 * subprocesses at once on a cold machine is how a launch turns into a stall.
 */
async function openFleet(mainProfileId: string): Promise<void> {
  let profiles = await tileableProfiles(hermes);
  const main = profiles.find((p) => p.id === mainProfileId);
  if (main) profiles = [...profiles.filter((p) => p !== main), main];

  for (const profile of profiles) {
    await tiles.launch(await characterFor(hermes, profile), profile.id);
  }

  fleetWatch?.();
  fleetWatch = new FleetWatch({
    hermes,
    isOpen: (id) => tiles.has(id),
    onProfile: async (profile) => {
      await tiles.launch(await characterFor(hermes, profile), profile.id);
    },
  }).start();
}
```

Add the imports:

```ts
import { FleetWatch, tileableProfiles } from './fleet';
```

And stop the watch when the app quits, beside the existing `window-all-closed` handler:

```ts
app.on('will-quit', () => {
  fleetWatch?.();
  fleetWatch = null;
});
```

- [ ] **Step 2: Typecheck and full suite**

Run: `npm run typecheck && npm test`
Expected: clean, all green.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: open the whole fleet at boot and keep watching

Tiles open in sequence, not in parallel: each spawns a hermes acp child and
waits on a handshake, and seven at once on a cold machine is a stall. The main
operator opens last so it lands in front."
```

---

### Task 10: Walk it through on the real runtime

**Files:** none. This task produces evidence and a record.

**Why it is a task:** twelve clean per-task reviews once shipped a Circe whose core function was broken, because no test crossed the transport-to-renderer boundary and no human had watched it run. `index.ts`'s wiring and the shipped renderer's update switch are still uncovered by the suite (§9), so the suite passing is not evidence this works.

- [ ] **Step 1: Build and launch against a fresh sandbox**

Follow `.claude/skills/run-circe/SKILL.md`. Confirm before starting that the operator's real home is untouched: record `shasum ~/.hermes/SOUL.md` and `ls ~/.hermes/profiles` and compare at the end.

- [ ] **Step 2: Onboard, and confirm placement**

Complete onboarding on a secondary display if one is attached, with the cursor there. Expected: the tile opens **on that display**, in front of other windows. This is §4.6's pair of defects; both were invisible to the suite.

- [ ] **Step 3: Confirm the profile now describes itself**

```bash
cat "$HERMES_HOME/SOUL.md" | head -3
cat "$HERMES_HOME/circe.json"
cat "$HERMES_HOME/circe/last-launch.json"
```

Expected: a `# Name — tagline` heading; a `circe.json` holding `{"version":1,"palette":{…}}` matching the tile's colours; and a last-launch record of exactly `{"version": 2, "mainProfileId": "default"}` — no `character` block.

- [ ] **Step 4: Create an agent at a terminal — constraint 10's own test**

With Circe still running, in a terminal with the same `HERMES_HOME`:

```bash
hermes profile create ford --description "finds the exit"
printf '# Ford — the one who finds the exit\n\nYou are **Ford**.\n' > "$HERMES_HOME/profiles/ford/SOUL.md"
printf '{\n  "version": 1,\n  "palette": { "bg": "#123524", "border": "#a7f3d0", "accent": "#34d399" }\n}\n' > "$HERMES_HOME/profiles/ford/circe.json"
```

Expected: within about a second of the `SOUL.md` write, **a second tile appears**, named Ford, in green, cascaded from the first, on the display holding the cursor, without a restart. No agent fact was supplied to Circe. If this works, constraint 10 holds in practice and not just on paper.

- [ ] **Step 5: Confirm the half-written case does not tile**

```bash
hermes profile create zaphod --description "two heads"
```

Expected: **no tile appears** — the directory exists but has no persona. Then write its `SOUL.md` and confirm the tile appears only now.

- [ ] **Step 6: Confirm each tile speaks only for itself**

Type a message into the Ford tile. Expected: Ford answers, in Ford's tile. The orchestrator's tile is unchanged — no bubble, no streaming, no turn-end.

- [ ] **Step 7: Have the orchestrator create a specialist**

Ask the orchestrator for a new agent, agree to its proposal, and watch. Expected: it runs `hermes profile create`, writes `SOUL.md` and `circe.json`, and a themed tile appears on its own. This is the product's thesis, end to end.

- [ ] **Step 8: Quit and cold-start**

Expected: every tile reopens, each on its own conversation (Phase 1's restore, now per profile), the main operator in front.

- [ ] **Step 9: Exercise the two Phase 1 paths no one has watched**

- **`circe/replay-abandoned`:** edit `circe/state.json` to hold a session id the agent does not have, and cold-start. Expected: the tile opens on a fresh session with the notice "Couldn't reopen the previous conversation — starting a new one." and no orphaned transcript above it. Note that Phase 1's `session/list` check means a *nonexistent* id is caught before any replay is drawn; to see the notice itself, use an id belonging to a different profile's real session.
- **Held messages:** type into a tile the instant it opens, before the agent answers. Expected: the message is drawn once, answered once, and not duplicated.

- [ ] **Step 10: Confirm the real home is untouched**

Re-run the `shasum` and `ls` from Step 1. Expected: identical. No `circe/` directory in the real home.

- [ ] **Step 11: Record what you saw**

Append a "Phase 2 walkthrough" section to `docs/build-decision-record-2026-08-14.md`, in the shape Phase 1's uses: what was **observed by eye**, and — separately and plainly — **what this walkthrough did not verify.** The suite still does not cover `index.ts`'s wiring or the shipped renderer's update switch; say so.

- [ ] **Step 12: Commit**

```bash
git add docs/build-decision-record-2026-08-14.md
git commit -m "docs: record the phase 2 walkthrough"
```

---

## Self-Review

**Spec coverage:**

| Spec | Task |
|---|---|
| §3 ownership model — record shrinks, no palette, no character | 4 |
| §3.1 how a profile describes itself | 1, 2 |
| §4.3 fleet tiles, watch, readiness, quit behaviour | 8, 9 |
| §4.3.1 registry seam, supersession, focus-don't-reopen, sender routing | 5, 6 |
| §4.6 active display, raise on creation | 7 |
| §4.7 wizard writes `circe.json`, skill documents it | 2, 3 |
| §6 registry coverage list | 5 |
| §6 Phase 2 walkthrough subset | 10 |

Not covered, deliberately and per §9: §4.2 tabs, §4.4 permissions, §4.5 chrome (Phases 3–4), and the renderer's update switch, which Phase 3 rewrites.

**Gaps found and closed while reviewing:**

- The v1-record palette migration (Task 4) was not in the spec. Without it an existing install silently loses its colours, since a v1 record holds the only copy and there is no `circe.json` yet.
- Two different `DEFAULT_PALETTE` constants existed (Task 1). The fallback path becomes common in this phase, so they had to be reconciled first.
- `registerIpc` is now reachable twice, because `activate` re-runs `boot` when nothing is open. `ipcMain.on` would double every handler; guarded in Task 6.
- Sequential rather than parallel tile launch at boot (Task 9): seven concurrent `hermes acp` handshakes is a stall, and nothing in the spec said which.

**Open risk to state plainly:** `src/main/index.ts` remains untested after this plan. Tasks 5–9 move the *behaviour* out of it, so what stays is wiring — factory construction, IPC registration, `boot`'s sequence — but "the wiring is right" is still verified only by Task 10 and by reading it. That is the same shape of gap Phase 1 closed for `restore.ts` and could not close for its caller.
