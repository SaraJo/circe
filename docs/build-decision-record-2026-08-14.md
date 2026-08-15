# Build decision record — 2026-08-14

Circe Desktop was built in twelve tasks, each implemented by a separate agent against its own brief,
each reviewed and fixed before the next began, and the whole branch reviewed at the end.

This file is the execution ledger from that run, preserved because it holds the reasoning behind
decisions the code cannot explain — 36 rulings, the deferred findings nobody fixed and why, and the
one class of defect that twelve clean per-task reviews could not see.

**The headline lesson.** Every per-task review passed. The whole-branch review then found that the
tile could never display an agent reply: `session/update` was unwrapped one level too shallow, and the
completion event the renderer waited for does not exist in ACP. No test crossed the `acp.ts` →
renderer boundary and no human had watched the app run, so twelve careful reviews of twelve correct
modules missed a broken product. Boundaries between modules need their own tests, or their own pair of
eyes.

---


Spec: `/Users/sarachipps/Code/circe-oss-spec.md` (read, 727 lines). Branch:
`build-onboarding-and-orchestrator`, off `2ec99f3` (plan commit, repo otherwise empty).

## Pre-flight conflict scan

### Cross-task pairs (shared file or interface)

| Pair | Produces → Consumes | Finding |
|---|---|---|
| T1 → T2 | `test/fake/hermes.ts` dynamically imports `isRealSoul`/`displayNameFor`; `real.ts` statically imports them | **CONFLICT** — T1 cannot go green or typecheck until T2 lands. Ruling P1. |
| T1 → T3 | `soulPath(home,id)` used as `soulPath('',id)` to derive home-relative paths | Clean. `path.join('','SOUL.md')` → `SOUL.md` (no leading slash), so the `.replace(/^\//,'')` in both sites is a harmless no-op. Consistent across T1's fake and T3's `writeSoul`. |
| T2 → T3 | `isRealSoul` guards the backup branch in `writeSoul` | Clean, but see P2 — H1/separator parsing is duplicated between the two modules. |
| T1 → T4 | `HermesRuntime.query` | Clean. |
| T4 → T8 | `deriveCharacter(hermes, fandom)` | Clean. T8's fake keys replies on the substring `coordinator`, which `DERIVATION_PROMPT` contains. |
| T1 → T4/T6/T11 | `Character.fandom` field | Clean. Added in T1, populated in T4, read by T6 and T11. |
| T5 → T11 | `paletteVars` imported by `src/renderer/tile/main.ts` | Allowed. `palette.ts` has no Electron import, so Global Constraint 2 is not violated; renderer-imports-from-main is a layering smell, noted not blocking. |
| T6 → T7 | T6 Step 5 creates an empty `SKILL.md`; T7 Step 1 fills it | Clean — flagged inline at both ends in the plan. |
| T6 → T8 | `renderOrchestratorSoul`, `loadTemplate` | Clean. |
| T7 → T8 | `installOrchestratorSkill(hermes,'default')` | Clean. |
| T9 → T11 | T9's `index.ts` launching-placeholder replaced by T11's `launchTile` | Clean — flagged inline. |
| T9 → T11 | `createTileWindow(character, profileId)` | Clean. |
| T10 → T11 | `AcpClient` | Clean. |

### Per-task self-consistency

| Task | Finding |
|---|---|
| T1 | Fixtures agree with assertions (`default` + 7 crew = 8). Ends with a red test by design — see P1. |
| T2 | Clean. |
| T3 | Clean. `backupSuffix` uses UTC getters; the test's expected `20260814-093000` matches the `Z` input. |
| T4 | Clean. Verified `toProfileId` truncation by hand: the 43-char Slartibartfast input slices to `slartibartfast-of-magrathea-the-` then trims the trailing hyphen, matching the assertion exactly. |
| T5 | Clean. Key-order assertion relies on object-literal insertion order, which is guaranteed for string keys. |
| T6 | **DEFECT** — Step 5 specifies an edit to `electron.vite.config.ts` without saying where the `plugins` array goes, and dangles a bare `import` line. Ruling P3. |
| T7 | **DEFECT** — `resolveSkill()` contains `rel.replace('resources/','resources/')`, a no-op the review rubric will correctly flag as dead code. Ruling P4. |
| T8 | Clean. All five routes (no runtime, no provider, fresh, configured-default, derive failure) have assertions. |
| T9 | Clean. |
| T10 | Clean. |
| T11 | Clean. `ipcMain.on` handlers registered inside `launchTile`, which is called once. |
| T12 | Minor — `extraResources` duplicates what `files: out/**/*` already ships. Ruling P6. |
| T8 / T11 | **DEFECT** — stated cumulative test counts (66, 75) are both wrong; actual totals are 69 and 78. Ruling P5. |

## Pre-flight rulings

- **P1 — Ruling:** Task 1 may end with a failing `test/runtime.test.ts`; Tasks 1 and 2 are a matched pair and T2 Step 4 runs both to green. Carried into both dispatches so neither implementer "fixes" it by inlining the heuristic, and into T1's review so the reviewer does not score it as an incomplete task. — *Why:* the alternative is duplicating the realness rule into the fake, which is the exact drift the single seam exists to prevent. — *Cost if wrong:* one task sits red on the branch until T2 commits; recoverable by reordering.
- **P2 — Ruling:** the H1-and-separator duplication between `profiles.ts` and `soul.ts` stands. — *Why:* `soul.ts` imports `isRealSoul` from `profiles.ts`, so the reverse import would create a module cycle; a shared third module for two regexes is worse than the duplication. — *Cost if wrong:* the two separator regexes drift and a heading parses differently in the two places. Mitigation: reviewers are told the duplication is ruled, so they will flag *divergence* rather than the duplication itself.
- **P3 — Ruling:** the `copy-resources` plugin goes inside the `main` config object's `plugins` array in `electron.vite.config.ts`, and the `node:fs` import goes at the top of that file. Carried verbatim into T6's dispatch. — *Why:* the plan's Step 5 is under-specified and would otherwise be guessed. — *Cost if wrong:* the packaged build cannot find `SOUL.template.md`; caught by T12's dist verification.
- **P4 — Ruling:** T7's `resolveSkill()` drops the no-op `.replace()` and reads `join(__dirname, '..', rel)`. — *Why:* it is dead code the plan mandated by accident, and shipping it invites a review finding I would then have to overrule. — *Cost if wrong:* none; the expression is provably identical.
- **P5 — Ruling:** the cumulative test counts in T8 Step 6 and T11 Step 8 are non-binding. The binding requirement is that the full suite passes and every test named in the task's own brief exists. — *Why:* I miscounted when writing the plan; correct totals are 69 after T8 and 78 after T11. — *Cost if wrong:* none — a stricter reading would only cause a spurious spec-❌.
- **P6 — Ruling:** T12's `extraResources` block stays as written. — *Why:* redundant with `files: out/**/*` but harmless, and removing it risks breaking the packaged resource path that T6's `resolveTemplate()` depends on. — *Cost if wrong:* a few KB duplicated inside the installer.

## Progress

### Task 1

- Dispatched sonnet implementer; commit `ea77eba`. Report `task-1-report.md`. 4/6 pass, 2 red by ruling P1 (expected).
- Task review (sonnet): spec ✅ on file content (verbatim vs brief), 2 Important, 3 Minor, 2 ⚠️.
- **⚠️ resolved by controller — "regexes never checked against real `hermes` output".** I ran the real
  binary read-only and checked each regex against what it actually prints:
  - `VERSION` — real output `Hermes Agent v0.14.0 (2026.5.16)` matches. OK.
  - `PROFILE_ROW` — real `hermes profile list` emits NO ANSI when piped (not a TTY), rows look like
    `  deep-thought    claude-opus-4-7   stopped ...` and the active row is `◆default` with no space
    after the bullet. The regex handles all three (bullet optional, `\s*` allows zero gap), the header
    `Profile` is excluded by the lowercase-start class, and the `───` rule row by the same. OK.
  - `hasProvider()` — **BROKEN.** See Ruling T1-a.
- **⚠️ resolved by controller — "constraint 4 has no representation in `writeHomeFile`".** Correct and
  intended: `writeHomeFile` is a raw primitive; the confirm+backup rule lives in Task 3's `writeSoul`,
  which is the only caller that overwrites a persona, and Task 8's tests assert both the backup and the
  decline-writes-nothing path. Not a gap.
- **Ruling T1-a:** `hasProvider()` is rewritten to parse `hermes status` for a `Provider:` line instead
  of calling `hermes auth status`. — *Why:* `hermes auth status` takes a required `provider` positional,
  so the plan's argv exits non-zero on every machine, `exec` throws, and `hasProvider()` returns false
  unconditionally. Task 8 branches the wizard on this, so every user would be parked on the
  provider-missing screen forever — the plan defect would have shipped as "the product does not work."
  Real output confirms `hermes status` prints `Provider:     Anthropic`. — *Cost if wrong:* if a machine
  prints that line in another shape, provider detection false-negatives and the user sees the
  provider screen with a working provider — visible, non-destructive, and fixable in one regex.
- **Ruling T1-b:** the ANSI-strip regex gains its missing `\x1b`, and row parsing is extracted to an
  exported `parseProfileRows()` with a test over both real captured output and a colourised variant.
  — *Why:* the plan's regex was a mis-transcription of the prototype's `/\x1b\[[0-9;]*m/g` (the
  prototype had it right); and the one piece of real parsing in this task has zero coverage because
  every test drives the fake. This is the reviewer's finding, upheld against the plan text. — *Cost if
  wrong:* one small exported function more than the plan's file structure names.
- Task 1: minor (deferred): `types.ts` documents `profileId` as `[a-z0-9-]` while `PROFILE_ROW` accepts `[a-z0-9_-]`; the two should agree.
- Task 1: minor (deferred): `hasProvider()` has no assertions in `test/runtime.test.ts` (trivial pass-through on the fake).
- **Root cause of finding 2, found while patching the plan:** the plan file on disk contained a
  *literal* ESC byte (0x1b) in the regex rather than the text `\x1b`. It rendered invisibly, so the
  implementer's transcription silently dropped it — the plan was correct and unreadable at the same
  time. Plan now carries a visible `\x1b`. Swept the whole plan for other Cc/Cf/invisible characters:
  none. Plan corrections committed separately so the code diff stays reviewable.
- Fix round 1/5 (3 addressed, 0 open; commits `ea77eba`..`3aa2572`). Re-review verdict: all findings
  addressed, no new Critical/Important breakage.
- Re-reviewer judged the unrequested static→dynamic `import('../profiles')` in `real.ts` **acceptable,
  not breakage**: a static import to a not-yet-existing module makes `real.ts` unloadable in vitest, so
  the new colocated pure-function tests could not have run at all; behavior, error surface, and the
  expected `TS2307` are all preserved. **Carry-forward into Task 2: revert it to a static import once
  `profiles.ts` exists.**
- Task 1: minor (deferred): dead `if (id === 'profile' || id === 'name') continue` guard in
  `parseProfileRows` — `PROFILE_ROW`'s lowercase anchor already excludes the capitalised header.
- Task 1: minor (deferred): the header/rule-row exclusion assertion in `profileRows.test.ts` is weak —
  those rows fail the lowercase anchor independently of the ANSI fix.
- **Task 1: complete (commits 2ec99f3..3aa2572, review clean)**

### Task 2

- Dispatched sonnet implementer; commit `17d2b42`. 17/17 on the two named files, 25/25 full suite.
- Implementer's DONE_WITH_CONCERNS was the brief's "14 tests" vs the actual 17 — covered by Ruling P5
  (plan test counts are non-binding, I miscounted). Not a defect.
- Task review (sonnet): spec ✅ including both controller instructions (Task 1 unblocked, dynamic import
  reverted), 1 Important **plan-mandated**, 1 Minor.
- **⚠️ resolved by controller — "typecheck clean is asserted, not visible in the diff".** Ran
  `npm run typecheck` myself: exit 0, no output. The `TS2307` that had stood since Task 1 is gone.
- **Ruling T2-a — the realness rule is widened, and the plan is wrong.** The reviewer proved by
  execution that `isRealSoul` returns `false` for a setext heading (`Trillian\n========`) and for YAML
  front matter followed by an ATX H1, because it only ever inspects the first non-blank line. Both are
  personas a human could plausibly write. I am upholding the finding against the plan text that mandated
  it. — *Why:* the two error directions are not symmetric. A false positive (scaffold judged real) costs
  a fresh-install user one extra click on a confirm screen. A false negative (real persona judged
  scaffold) means Task 3's `writeSoul` takes no backup *and* Task 8's wizard never shows the confirm
  screen — the user's hand-written persona is destroyed silently. That is the single worst outcome this
  product has, and Global Constraint 4 exists to prevent exactly it. A rule guarding a destructive write
  must fail toward "real". The Hermes scaffold is bare prose with no heading of any kind, so widening to
  "any ATX H1 anywhere, or any setext H1, after skipping front matter" still classifies a fresh install
  correctly and keeps the primary flow intact. — *Cost if wrong:* a scaffold-like file containing a
  stray `# ` line gets treated as real, and the user sees the claim-default screen on a fresh install.
  Visible, one click, non-destructive — the right direction to be wrong in.
- **Ruling T2-b — carried into Task 3.** `soul.ts`'s `parseSoulHeading` must agree with
  `displayNameFor` about *which line* is the heading, or the two diverge in the way Ruling P2 said was
  the real risk of the accepted duplication. Task 3's dispatch carries this, plus a warning that
  `withSoulHeading` replaces the first non-empty line and would corrupt a front-matter file.
  — *Cost if wrong:* the name shown in the UI disagrees with the name written to disk.
- Task 2: minor (folded into the fix, since the same function is being rewritten): the
  `if (/^#{2,}/.test(first)) return false` guard is dead — `H1_LINE` already rejects `##`.
- Fix round 1/5 (1 addressed — all six sub-parts and all seven required tests verified — 0 open;
  commits `17d2b42`..`150dbd5`). Re-review: no new Critical/Important breakage. Scaffold, whitespace-only,
  and `##`-only inputs all confirmed still `false` by execution, so the widening did not overshoot into
  breaking the fresh-install path.
- Task 2: minor (deferred): `findH1` is not fence-aware, so a `#` line inside a fenced code block reads
  as a heading. New surface created by scanning the whole document. Fails toward "real" — one extra
  confirm click, never data loss — so it is on the correct side of Ruling T2-a's asymmetry.
- **Task 2: complete (commits 3aa2572..150dbd5, review clean)**
- **Ruling T3-a — supersedes the duplication half of Ruling P2.** P2 accepted duplicated H1/separator
  parsing between `profiles.ts` and `soul.ts` on the grounds that the reverse import would cycle. That
  premise was only ever true in one direction: `soul.ts` already imports `isRealSoul` *from*
  `profiles.ts`, and `profiles.ts` imports nothing from `soul.ts`. So `soul.ts` can simply consume the
  heading finder rather than redeclare it, and there is no cycle to avoid. Task 3 will export
  `findH1`/`splitHeading` from `profiles.ts` and build `parseSoulHeading` on them. — *Why:* T2-a made
  `profiles.ts`'s parsing materially smarter (front matter, setext, whole-document scan) while
  `soul.ts`'s copy stayed first-line-only, so the two would now disagree on exactly the inputs T2-a was
  written to protect. Duplication I accepted as harmless has become live divergence. — *Cost if wrong:*
  `soul.ts` gains a dependency on `profiles.ts` beyond `isRealSoul`; if the two modules ever need to
  split, one small function moves.

### Task 3

- Dispatched sonnet implementer with two controller overrides; commit `86b2024`. 49/49 full suite,
  typecheck clean.
- Task review (sonnet): spec ✅ on both overrides, task quality **Approved**, but 1 Important
  **plan-mandated** and 1 Minor. Reviewer verified `test/profiles.test.ts` has zero diff lines — the
  strongest available evidence that the `profiles.ts` export refactor changed no behavior.
- Reviewer traced both `writeSoul` failure modes I asked about and found no path that destroys the
  original with no backup: a failed backup write aborts before the overwrite, and a failed main write
  leaves the original intact with a redundant backup. Good.
- **Ruling T3-b — the backup-collision finding goes into the fix loop, over the reviewer's own
  "Approved".** `backupSuffix` has one-second resolution and `writeSoul` writes the backup path with no
  existence check, so two `writeSoul` calls in the same UTC second send both backups to the *same*
  path. Second call reads the already-overwritten content as "existing", and because Circe's own output
  always carries an H1 it is judged real and backed up over the first backup — the user's hand-written
  persona becomes unrecoverable. — *Why:* a double-click on the "Replace it" button in Task 8's
  claim-default screen is enough to trigger it, and this is the single destructive write in the entire
  product. Global Constraint 4 is the reason that screen exists; a backup that a double-click deletes
  does not satisfy it. The reviewer graded the task Approved because the defect came from code I
  mandated be copied verbatim — correct about the provenance, but provenance does not make a data-loss
  path acceptable, and the rubric is explicit that plan authorship does not grade its own work.
  — *Cost if wrong:* about eight lines and one test more than the plan called for, and backup filenames
  that can carry a `-2` suffix.
- Task 3: minor (deferred): `withSoulHeading` splits on `/\r?\n/` and rejoins with `\n`, so a
  CRLF-authored SOUL.md would be normalised whole-file rather than preserved byte-for-byte. Pre-existing
  pattern, not a regression, POSIX-only in practice.
- Fix round 1/5 (1 addressed, all four sub-parts and both required tests verified, 0 open; commits
  `86b2024`..`8ebed78`). Re-review: no new breakage. Confirmed the throw fires *before* any write, that
  the counter scheme is plain/`-2`/`-3` rather than `-1`-based (the two new tests together pin the
  convention, so they cannot both pass under the wrong one), that the no-collision common case still
  yields the bare suffix, and that an empty-string backup file is treated as taken rather than free.
- **Task 3: complete (commits 150dbd5..8ebed78, review clean)**

### Task 4

- Dispatched sonnet implementer; commit `b28dc2b`. 11/11 new, 62/62 full suite, typecheck clean.
- Task review (sonnet): spec ✅, **no Critical or Important** — first task to clear on the first pass.
  Reviewer traced the untrusted-output paths I flagged and found them sound: `"!!!"`, `"---"`,
  `"Θάνατος"`, `"デス"` all collapse to an empty id and hit the user-facing error rather than reaching
  `hermes profile create`; `.`, `..`, leading hyphens and slashes cannot survive `toProfileId`; the
  luminance gate is applied to `bg` only; the sRGB transfer function and Rec.709 coefficients are
  correct; `retries: 0` gives exactly one attempt and surfaces the real error. The `coordinator`
  cross-task substring is exercised by a real assertion, not merely present in the text.
- Task 4: minor (deferred): `extractJson`'s outermost-braces strategy false-rejects a reply whose
  *prose* contains a `{`, or one containing two JSON objects. Fails closed, not open — the user sees
  "could not read" and can retry. Untested.
- Task 4: minor (deferred): nothing stops a derived name normalising to `default`. Benign in this
  build because the wizard writes to `default` by name and never uses `character.profileId` to create a
  profile — but that also means `Character.profileId` is currently unused by the wizard flow. Flag to
  the final review as possible YAGNI, and as a real collision risk for whoever later has the
  orchestrator create specialists.
- Task 4: minor (deferred): no test covers both retry attempts failing and asserting the *last* real
  error surfaces rather than the generic fallback. Code reading confirms it is correct.
- **Task 4: complete (commits 8ebed78..b28dc2b, review clean)**

### Task 5

- Dispatched haiku implementer (pure transcription, complete code in the brief); commit `feb82a8`.
  5/5 new, 67/67 full suite.
- Task review (haiku): spec ✅, no issues. Verified value-by-value against the brief — all four alphas,
  every fixed rgba string, and the ten-key insertion order matching the array the test asserts.
- **Gap in that review, resolved by controller.** I asked the reviewer to state whether `hexToRgb` is
  guarded against malformed hex and it did not answer. Checked myself: `derive.ts:87` is the *only*
  place in the codebase that constructs a `Palette` (grepped all of `src`), and `derive.ts:83` gates all
  three channels on `/^#[0-9a-fA-F]{6}$/` before it does. An unvalidated hex cannot reach `hexToRgb`,
  so the unguarded `parseInt` is safe as written. Worth re-checking if a second `Palette` producer is
  ever added.
- **Task 5: complete (commits b28dc2b..feb82a8, review clean)**

### Task 6

- Dispatched sonnet implementer; commit `5d25a6b`. 7 new tests, 74/74 full suite, typecheck clean.
- **Plan defect the implementer found, and handled well.** `npm run build` cannot succeed at this point
  in the sequence: Task 6 Step 5 adds a resource-copy plugin to `electron.vite.config.ts`, but the
  config's `main`/`preload`/`renderer` entry points are not created until Task 9. Rather than skip the
  verification I asked for, it temporarily stubbed the missing entries, ran the real build, confirmed
  `out/resources/orchestrator/SOUL.template.md` landed byte-identical at 6945 bytes and the empty
  `SKILL.md` placeholder landed too, then removed every stub before committing. That is the right call.
- **Ruling T6-a:** full-build verification for the copy plugin is deferred to Task 9, and Task 12's
  `npm run dist` step is the binding gate for it. — *Why:* the plan interleaved a build-config change
  ahead of the code that makes the build runnable; re-ordering tasks now would cost more than carrying
  the check forward. — *Cost if wrong:* a packaging bug hides until Task 12, where the plan already
  requires opening the built app.
- **Controller verification of the persona's commands.** The template instructs a real agent to run
  real commands, so I checked each against the installed Hermes rather than trusting the prose:
  `hermes chat -q` exists (`-q QUERY`, single-query non-interactive) so `hermes -p <name> chat -q "..."`
  is valid; `hermes skills config` exists as a subcommand; bare `hermes tools` really is the interactive
  configuration UI the template describes; `hermes profile create <id> --description "..."` was
  confirmed earlier. No invented commands.
- Task review (sonnet): spec ✅, **no Critical or Important**. Verified the template is byte-for-byte
  identical to the brief across all 170 lines (line-by-line, not spot-checked), all four Step 5
  requirements individually confirmed, the placeholder `SKILL.md` is the canonical empty blob
  `e69de29`, and — the load-bearing claim — no build stubs survived into the commit.
- **Ruling T6-b — controller finding neither reviewer could see, goes into the fix loop.** Task 7's
  skill instructs the orchestrator to "record the new agent in your own SOUL.md under the list of
  specialists", and the reference persona at `~/.hermes/SOUL.md` has exactly that (`## The sub-agents`,
  listing all seven with their domains). My template has no such section, so the skill points at
  somewhere that does not exist and the agent has to invent a location. — *Why:* the roster is how the
  coordinator keeps a current picture of who exists and what they own; it is the mechanism behind
  "route work to the right agent" and "synthesize across domains", both of which the template already
  claims as jobs. Without it, an orchestrator that creates six specialists over six weeks has no
  record of them in the one file it always reads. This is a gap I created by writing the template and
  the skill in separate tasks. — *Cost if wrong:* about twelve lines of template that a user could
  delete.
- Task 6: minor (folded into the T6-b fix, same function): `renderOrchestratorSoul` passes replacement
  strings to `replaceAll`, so a `$&`, `$$`, `` $` `` or `$'` in a model-generated name or tagline would
  splice in matched text rather than the literal characters.
- Task 6: minor (deferred): `resolveTemplate()` runs at module load and returns a nonexistent path when
  neither candidate exists; the failure surfaces later as `ENOENT` from `loadTemplate()` rather than
  fail-fast at import.
- Fix round 1/5 (2 addressed, 0 open; commits `5d25a6b`..`3a96848`). Re-review verdicted all five
  required content points of the new `## The network` section individually present (not just
  similar-sounding), placement correct, register consistent, no forbidden "fleet" framing, and — the
  regression check that mattered — the template diff is a single pure 19-line insertion with nothing
  else reworded. Confirmed the `$&` test genuinely fails against the old string-replacement form.
- **Ruling T7-a — resolve a prose ambiguity in Task 7 rather than reopening Task 6.** The re-reviewer
  noticed that the template now says editing the roster follows propose→approve→log, while Task 7's
  skill will tell the orchestrator to record each new agent there. Read literally that is two approval
  cycles for one action, and an agent might re-prompt. — *Why:* the cost of the ambiguity is the
  orchestrator asking one redundant question; the cost of another Task 6 fix round is a full
  dispatch-plus-review cycle on a file whose every other line is verified verbatim. The skill is the
  more specific instruction and is where the creation procedure lives, so it is the right place to say
  the creation confirmation covers the roster entry. — *Cost if wrong:* the orchestrator asks "shall I
  also record this in my network list?" once per agent. Deferred to the final review as a minor.
- **Task 6: complete (commits feb82a8..3a96848, review clean)**
- Controller verification for Task 7: `hermes mcp` is real, with `add` (flags `--url`, `--command`,
  `--args`, `--auth {oauth,header}`, `--preset`, `--env`), `list`, `test <name>`, `configure`, `login`,
  `catalog`, `install`. The skill can name these safely.

### Task 7

- Dispatched sonnet implementer with three amendments; commit `d9fc367`. 81/81 full suite, typecheck clean.
- Task review (sonnet): spec ✅, **no Critical or Important**. All three amendments verified
  individually; both guardrail strings character-exact; the placeholder was genuinely filled with no
  dropped or reordered sections; every MCP flag matches the surface I verified against the real binary.
- Notable: the implementer also patched the "What not to do" list to reference the Amendment 2
  carve-out. Without that the skill would have contradicted *itself* — the creation section permitting
  the roster write while the prohibition list forbade it unconditionally. It caught that unprompted.
- **⚠️ resolved by controller — "is `profileId` validated before it reaches the write path?"** The
  reviewer noted `installOrchestratorSkill` interpolates `profileId` into a home-relative path with no
  format check, so a `..` or `/` would escape the profile directory. Checked reachability: the only
  callers in this build are Task 8's `accept()`, which passes the **literal string `'default'`** to both
  `writeSoul` and `installOrchestratorSkill`. Nothing model-derived reaches either. Unreachable as
  designed — but I am carrying an explicit instruction into Task 8's dispatch that the profile id stays
  a hardcoded literal, so a later edit cannot quietly make it reachable.
- Task 7: minor (deferred): no defence-in-depth id validation at the write layer in
  `skill.ts`/`soul.ts`. Worth adding if the orchestrator ever creates profiles through Circe code
  rather than through the `hermes` binary.
- Task 7: minor (deferred): `SOUL.template.md`'s roster rule is stated unqualified while the skill
  carves out the bundled roster entry. Ruling T7-a accepted this; the skill is the more specific
  document and is read at the moment of action. Flag to the final review.
- **Task 7: complete (commits 3a96848..d9fc367, review clean)**

### Task 8

- Dispatched sonnet implementer; commit `53bdaf2`. 12/12 route tests, 93/93 full suite, typecheck clean.
- Task review (sonnet): spec ✅ on all three controller instructions — `'default'` is a literal at both
  call sites and `character.profileId` is never read in the file; provider check precedes fandom; all
  12 brief-named tests present. All 10 `WizardStep` variants confirmed both produced and reachable.
  Reviewer also confirmed the decline-path snapshot is a genuine `new Map(...)` clone rather than a
  reference copy — that assertion would really catch a stray write.
- **Ruling T8-a — two plan-mandated concurrency defects go into the fix loop.** Neither `accept()` nor
  `submitFandom()` guards against being called twice, and both sit on the destructive path.
  - `accept()` re-entrancy: two calls before the first resolves both run. The second re-reads the
    `SOUL.md` the first just wrote, sees a real heading, and takes a spurious backup of Circe's own
    output. Task 3's collision fix means the user's original survives as `-1`, so this is clutter
    rather than loss — but it also fires `installOrchestratorSkill` and the `launching` transition
    twice.
  - `submitFandom()` staleness: this one is worse. Two overlapping derivations race, and whichever
    *resolves* last wins regardless of which was *issued* last. A slow first answer landing after a
    fast second one silently swaps the character on the meet screen — potentially moments before the
    user clicks accept. The user would then create an agent they did not see. That defeats the entire
    purpose of the meet screen.
  — *Why:* both are reachable by a double-click, which is the single most ordinary user input there is,
  and the second one breaks the consent model rather than just making a mess. Both trace to reference
  code I wrote. — *Cost if wrong:* a generation counter and two state guards, roughly fifteen lines.
- Task 8: minor (folded into the fix, same methods): `accept()` doesn't check `state.kind`, so a future
  renderer wiring a button to it from `claim-default` would bypass the explicit-confirm step.
- Fix round 1/5: implementer returned DONE_WITH_CONCERNS, having pushed back on my instruction that
  `submitFandom` proceed only from `fandom`/`derive-failed`. It was right to push back: JS
  run-to-completion means the first call synchronously reaches `deriving` before any second call's
  guard runs, so a strict two-state guard would block every overlapping call and make the generation
  counter unreachable and its required test unwritable.
- **Ruling T8-b:** accept the widened entry set (`fandom`, `derive-failed`, `deriving`). — *Why:* the
  counter then guards a reachable path and is genuinely tested, which is worth more than saving a
  hypothetical duplicate model call — and there is no UI path that can trigger one, since the deriving
  screen is a spinner with no input. — *Cost if wrong:* if a future screen adds a resubmit affordance
  during derivation, two model calls run concurrently and the user is billed for both; the stale one is
  discarded correctly either way.
- Checked the thing I actually feared, which the implementer had already handled: `retryDerivation`
  calls the private `runDerivation` directly instead of going through `submitFandom`, so "Try another
  character" from the `meet` screen — the escape hatch spec §6.2 Step 5 calls the one that matters —
  is not blocked by the entry guard. It documented that choice in a comment.
- Task 8: minor (deferred): with `deriving` in the entry set, a future resubmit affordance would issue
  a second concurrent model call rather than reusing or cancelling the first.
- Fix round 1/5 (2 addressed, 1 open; commits `53bdaf2`..`8a9b5a0`). Both original findings cleanly
  fixed and all four new tests verified as genuinely interleaving and genuinely RED against `53bdaf2`
  — the re-reviewer traced each rather than trusting the report. **But consequence check 4 failed:**
  rerouting `retryDerivation` around `submitFandom`'s new entry guard (which was necessary to keep
  "Try another character" working) left `retryDerivation` itself with no guard at all. It can fire a
  real model call from `launching` — `accept()` sets `launching` synchronously, `this.character` is
  still set, so `retryDerivation()` falls through to it — knocking state back to `deriving` mid-write
  and re-opening a variant of the very race round 1 closed. Reachable with two unawaited public calls.
- Fix round 2/5 (1 addressed, 0 open; commits `8a9b5a0`..`eccb028`). Re-review: both required changes
  present, escape hatch intact for the third round running, generation token still supersedes correctly
  from `deriving`, and clearing `this.character` broke nothing downstream (every remaining read traced
  and shown unreachable-or-unaffected). The re-reviewer also confirmed the original proof-of-concept is
  closed in the *unawaited* case, not just the sequential one the new test covers.
- **The `provider-missing` variant was real, and wider than my finding described.** `start()` never
  clears `this.character`, so a legitimate second `start()` after a provider drops out lands on
  `provider-missing` with a character still held from an earlier successful derivation — pre-fix, a
  retry from there fired a real model call. The implementer found this by testing the edge I told it to
  drop if it proved unreachable, and it verified the fake reads `hasProvider` live rather than
  snapshotting, so the test is a faithful simulation rather than a contrivance.
- **Task 8: complete (commits d9fc367..eccb028, review clean, 2 fix rounds)**

### Task 9

- Dispatched sonnet implementer; commit `9ea801a`. 101/101 suite, typecheck clean, `npm run build`
  succeeds.
- **The implementer caught a Global Constraint 7 violation in my own brief copy** — the
  `runtime-missing` screen read "Circe runs **your agents** on Hermes…", which literally contains the
  banned phrase. It fixed it to "Circe runs on Hermes…" and flagged the deviation rather than silently
  transcribing a violation. Exactly right.
- **Ruling T6-a is now closed.** Rebuilt from a clean `out/`: all five outputs land, and the two
  resource files the packaged app needs are present and non-empty (`SOUL.template.md` 7798 bytes,
  `SKILL.md` 3974 bytes). The copy plugin works.
- **⚠️ resolved — "was the second placeholder really necessary?"** Yes. `electron.vite.config.ts:31`
  lists `tile: src/preload/tile.ts` as a preload input, so the build genuinely fails without it. The
  placeholder is `export {};` plus a comment — inert.
- Task review (sonnet): wiring table verified row by row, **all six correct**, including the two I
  flagged as traps ("Try another character" → `retryDerivation`, "Replace it" → `confirmClaimDefault`
  and never `accept`). 3 Important, all plan-mandated.
- **Ruling T9-a — keep "A home for your AI agents" on the welcome screen.** The reviewer flagged it as
  echoing the banned phrasing. It is the spec's own wording (`circe-oss-spec.md:222`), and Constraint 7
  exists to stop Circe *claiming the user already has a fleet* — "your fleet is ready", "you have N
  agents". A sentence describing what the product is for, immediately followed by "you'll meet your
  first one", makes no such claim. — *Cost if wrong:* one line of welcome copy reads slightly
  ahead of what the user has.
- Fix round 1/5 (4 addressed, 0 open; commits `9ea801a`..`2f74c5d`). Re-review swept **every** `el()`
  call site rather than only the two flagged lines and found no third instance; confirmed the
  `deriving` copy still reads correctly with the placeholder span inline; confirmed the sole live
  `openExternal` caller is `https:` and is not now refused by its own fix; confirmed the `never`
  assertion is the strict assignment form that really fails `tsc`; confirmed the null check
  short-circuits before `isDestroyed()`.
- **Task 9: complete (commits eccb028..2f74c5d, review clean)**
- **OPEN, carried to the final report:** the manual GUI walkthrough has not been performed by anyone.
  The implementer tried twice — healthy process tree, no errors, no window visible via `screencapture`
  or Accessibility from a headless shell — and reported that honestly both times rather than inventing
  a result. Every screen's rendered appearance is therefore unverified by test or by eye. This needs a
  human to run `npm run dev`.

### Task 10

- Dispatched sonnet implementer; commit `d44e37a`. 105/105 suite, typecheck clean, build succeeds.
- Implementer returned DONE_WITH_CONCERNS on a real question: the prototype loads the profile's `.env`
  into the spawn environment before starting `hermes acp`; my port does not.
- **Ruling T10-a — the omission is correct, and is an improvement on the prototype.** Verified on the
  real install: every per-profile `.env` under `~/.hermes/profiles/*/` is a **symlink to the root
  `~/.hermes/.env`**, and `hermes -p default status` resolves provider and API keys on its own with no
  environment help from the caller. The prototype's `loadProfileEnv` was defensive plumbing (its own
  comment describes diagnosing auth/env issues), not a requirement. — *Why:* reading a user's API keys
  out of their `.env` in order to re-inject them into a subprocess that already reads that same file is
  both redundant and a direct violation of Global Constraint 1 — Hermes owns credential resolution and
  Circe does not touch secrets. Not loading them is the better design, not a gap. — *Cost if wrong:* if
  some future Hermes version stops sourcing its own `.env` under `-p`, the tile fails to authenticate
  with a visible provider error at first prompt, and the fix is one line.
- Task review (sonnet): spec ✅, both controller instructions honoured (no mock-subprocess harness, no
  permission gate). 2 Important **plan-mandated**, 2 Minor. Reviewer confirmed the framing handles a
  message split across arbitrarily many chunks and a boundary landing exactly on the newline, because
  `onData` re-parses the whole accumulated buffer rather than doing stateful incremental parsing.
- Reviewer also found the port *improves* on the prototype in one place: the prototype's unlocked mode
  falls back to `opts[0]` and even fabricates `optionId: 'allow'` when there are no options, whereas the
  port cancels. Cancelling is the safer reading and matches the instruction.
- **Ruling T10-b — add the double-start guard.** The prototype has `if (this._child) return
  this._ready;` and my brief dropped it. Without it, a second `start()` spawns a second child while the
  first is neither killed nor unhooked, and because `pending`/`nextId` are shared, the orphan's eventual
  exit rejects the *live* session's in-flight requests and fires `onExit` for a session still running.
  — *Cost if wrong:* one line.
- **Ruling T10-c — time out the handshake, not the prompt.** The reviewer wants a per-request timeout
  because an unanswered request hangs forever behind the product's only conversation. Half right. A
  stalled `initialize` or `session/new` is unambiguous and should time out. A long `session/prompt` is
  **normal** — an agent turn legitimately runs for minutes — so a timeout there would abort real work,
  and any value large enough to be safe is too large to be useful. So: bound the handshake, leave the
  prompt unbounded, and rely on child-exit rejection plus surfacing the exit to the tile. — *Why:*
  killing a working agent mid-thought is a worse failure than a stalled handshake, and the handshake is
  where a genuine hang actually shows up. — *Cost if wrong:* a hung agent turn still requires the user
  to close the tile; no data is at risk.
- Fix round 1/5 (3 addressed, 1 NEW Important; commits `d44e37a`..`7651377`). All three original
  findings fixed and verified — the idempotence test spies on the private `doStart` and asserts it ran
  exactly once, so it proves no second spawn rather than merely that two calls returned. Timer cleanup
  verified on all three settle paths (reply, timeout, child exit).
- **But the restructure introduced a regression the re-review caught:** `stop()` nulls `child` but never
  clears the new `startPromise` cache. After `stop()`, `start()` returns the stale settled promise and
  never respawns; `sessionId` survives, so `prompt()` passes its guard, writes to a null child via
  optional chaining, enqueues a pending entry, and hangs forever — no exit event will ever fire to
  reject it. The prototype avoids this because its guard checks `_child`, the exact field `stop()`
  nulls. Currently unreachable in this build (nothing restarts a client), but it is a landmine and the
  fix is two lines.
- Re-reviewer also demonstrated the handshake timeout **was** testable without a subprocess fake —
  `request()`'s only touch on the child is optional-chained, so calling it directly with fake timers
  exercises the real rejection path. The implementer's "untestable" rationale did not hold.
- Fix round 2/5 (2 addressed, 1 NEW Important; commits `7651377`..`718dcba`). Both findings closed:
  `stop()` clears all three guard fields, `prompt()` after `stop()` now rejects rather than hanging, the
  failed-start caching decision is documented and sound, and both new timeout tests drive the real
  private `request()` under fake timers — the "no timeout arms no timer" test proves genuinely-pending
  via a `settled` flag flipped only by a real callback.
- **Round 2's own fix made a previously-unreachable race reachable.** Round 1's stale-`startPromise`
  bug had accidentally prevented any second `doStart()`, so nobody could restart. Now that restart
  works: `stop()` still leaves `this.pending` and `this.buffer` stale, and the `exit` closure has no
  identity check against the child it was registered on. A fast stop-then-restart lets the *old* child's
  delayed `exit` reject the *new* child's live handshake and fire `onExit` for a running session; a
  partial line left in `buffer` also corrupts the new session's first frame.
- **Ruling T10-d — fix it, and cap Task 10 at this round.** Unreachable in the shipped build (nothing
  calls `start()` after `stop()`; the tile's close handler stops and closes), but it is a landmine in
  the transport behind the product's only conversation and the fix is three lines: an identity guard on
  the exit closure plus clearing `pending`/`buffer` in `stop()`. — *Why:* cheap, standard, and correct;
  and a transport that cannot be safely restarted constrains every future feature that would want to.
  But the findings are now about paths this build never takes, so this is the last hardening round on
  this task — anything further gets parked for the final review rather than looped on.
- Fix round 3/5 (1 addressed — all three parts — 0 open; commits `718dcba`..`f9c9a29`). Re-review
  confirmed the identity guard compares against the captured local rather than a re-read field, that
  synchronous rejection in `stop()` creates no re-entrancy window (continuations are microtasks, and
  `stop()` has no yield point), and that both new tests genuinely fail against `718dcba`.
- **Task 10: complete (commits 2f74c5d..f9c9a29, review clean, 3 fix rounds)**
- Task 10: parked for final review: the `stdout`/`stderr` data handlers did not get the same
  child-identity guard the `exit` handler did, so a killed-but-unreaped child's buffered stdout can
  still feed the live session's buffer. Same one-line pattern would close it.
- Task 10: parked for final review: a handshake-timeout rejection does not kill the still-running
  child, so a caller that does not also `stop()` leaks one `hermes acp` process per timed-out `start()`.
  Confirmed not worse than described — a process leak, not corruption. **Carried into Task 11's
  dispatch**, since Task 11 is the caller.
- Task 10: parked for final review: all three failure paths are distinguished only by message string,
  with no error type or code for callers to branch on.

### Task 11

- Dispatched sonnet implementer with four amendments; commit `e9cdd45`. 115/115 suite, typecheck clean,
  build succeeds.
- Task review (sonnet): all four amendments verdicted individually — 1, 2, 4 compliant; 3 partial.
  **1 Critical, 2 Important.** Reviewer credited the implementer with exceeding the brief on Amendment 1:
  it added a `sendToTile`/`queued` mechanism that guarantees the failure message survives even when
  `start()` rejects before `did-finish-load` fires — a message-loss race the brief's own code had.
- **Ruling T11-a — the Critical is real and goes straight into the loop.** `launchTile` never registers
  `tileWin.on('closed')`, so the only path that calls `acp.stop()` is the in-app `×` button. A user
  closing the tile with the native red button or Cmd+W — the instinctive way to close a floating window
  — leaves the `hermes acp` subprocess running indefinitely. This is precisely the leak Amendment 1 was
  written to prevent, reached by the far more common trigger, and no test or manual pass would have
  caught it. — *Cost if wrong:* one line.
- **Ruling T11-b — render the opening message as text, not Markdown.** The reviewer found `c.name` and
  `c.fandom` interpolated into `openingMessage`, which the renderer runs through `marked.parse` into
  `innerHTML`. The fandom is *user-typed* and the name is model-derived, so a `<` in either becomes
  markup. CSP blocks execution, so the ceiling is layout and link injection inside the user's own tile —
  but the fix is better than containment: the opening message is Circe's own prose with two
  interpolations and has no reason to be Markdown at all. Render it with `textContent`. — *Why:* removes
  the injection path entirely rather than relying on CSP to blunt it, and costs nothing — there is no
  Markdown in that message to lose. — *Cost if wrong:* if the copy ever wants emphasis or a link, it has
  to be built as elements instead of markup.
- Fix round 1/5 (3 addressed, 0 open; commits `e9cdd45`..`c1c14ce`). Re-review walked all four close
  paths and confirmed each reaches `stop()` at least once, that the `×` path's double call is harmless
  because `stop()` is idempotent by construction, and — the part I asked to be verified rather than
  assumed — that `.msg { white-space: pre-wrap }` really is in `tile.css` and really does cover the
  `textContent` message's hard newlines. Only one `innerHTML` write survives, on completed agent
  replies, operating on the bubble's own accumulated text rather than on interpolated prose.
- **Task 11: complete (commits f9c9a29..c1c14ce, review clean)**
- Task 11: parked for final review: the `closed` handler nulls `tileWin`, which re-opens the
  `launchTile` guard. A hypothetical second `launching` transition would register a *second* pair of
  `ipcMain` listeners on top of the first (which are process-global and never removed), reproducing the
  doubling the guard exists to prevent. Unreachable today — the wizard fires `launching` once per run —
  and disclosed in the implementer's own comment.
- Task 11: parked for final review: the `closed`-handler wiring and the `launchTile` guard are verified
  only by inspection; a refactor that dropped either would not fail `npm test`.

### Task 12

- Dispatched sonnet implementer; commit `01da204`. 117/117 suite, typecheck clean, `npm run dist` built
  a 93MB unsigned arm64 dmg on the first attempt.
- **Controller verification of the one check that decides whether the product works when packaged.**
  I inspected the bundle myself rather than trusting the report: inside `app.asar`, `/out/main/index.js`
  sits alongside `/out/resources/orchestrator/SOUL.template.md` and the skill, so
  `resolveTemplate()`'s `join(__dirname, '../resources/...')` resolves at runtime and the packaged app
  can write the orchestrator's persona. Ruling P6's `extraResources` copy also lands at
  `Contents/Resources/resources/orchestrator/` — unused by the resolver, harmless as predicted.
- Task review (sonnet): spec ✅, **no Critical or Important**. The reviewer audited every factual claim
  in the README against source — each numbered first-run step against `wizard.ts`, the derivation
  description against `DERIVATION_PROMPT`, the "never touches a real Hermes install" test claim by
  grepping `test/` for `RealHermes`/`execFile`/`spawn` (zero hits), and the three fake scenarios against
  `test/fake/hermes.ts`. No false statement found.
- Task 12: minor (deferred): `mac.identity: null` was added beyond the brief's literal text — correct
  and justified for an unsigned build, but undocumented as a deliberate deviation.
- **Task 12: complete (commits c1c14ce..01da204, review clean)**

## All twelve tasks complete. Final whole-branch review next.

## Final whole-branch review (opus)

Verdict: **Merge after Critical fixes.** Three Criticals, seven Importants. Triaged all 20 deferred
items; only #20 (the never-performed GUI walkthrough) was called fix-before-merge, and it is the root
cause of the two headline defects.

- **C1 confirmed by controller against the prototype.** `session/update` params are
  `{sessionId, update:{sessionUpdate, content}}`. The prototype does `const u = params.update; const
  kind = u.sessionUpdate` (`renderer.js:372,377`). Ours reads `sessionUpdate` directly off `params`
  (`tile/main.ts:85`), one level too shallow, so it is always `undefined` and **no agent reply ever
  renders**. Compounding it, `agent_message_complete` is not an ACP update kind at all — turn
  completion comes from `session/prompt` resolving with `{stopReason}`. Both inherited from my plan's
  Task 11 listing, which contradicted the reference implementation Task 10 was told to port.
- C2: the tile window has no `will-navigate`/`setWindowOpenHandler` guard, `marked` renders live links
  from agent output, the preload re-exposes `window.circe` on navigation, and `acp.ts` auto-approves
  every permission request — an arbitrary page could drive a fully-permissioned agent.
- C3: `commitAccept` sets `launching` *before* writing the persona and skill, and `set()` notifies
  synchronously, so the ACP child spawns against the old `SOUL.md`.
- I1 (elevated by controller to Critical for the fix wave): `readFileOrNull` swallows every error, not
  just `ENOENT`, so an unreadable-but-present persona reads as absent → no backup, no confirm, silent
  destruction. The last hole in Constraint 4.
- **Why twelve clean task reviews missed C1:** no test crosses the `acp.ts` → renderer boundary, and no
  human ever watched it run. Each agent verified its own module against its own brief. That is exactly
  the failure mode the final whole-branch pass exists for.

## Final fix wave + scoped re-review

- One fix wave (opus) covering all ten findings; commits `01da204`..`0e8318f`. 136 tests (was 117),
  typecheck and build clean.
- Scoped re-review (opus): **all ten ADDRESSED, no new Critical/Important breakage. Mergeable.**
  Protocol shape verified line-for-line against the prototype; synthetic `circe/*` update kinds proven
  non-colliding (real ACP discriminators are snake_case, no `/`); both navigation guards confirmed on
  both windows and before `loadFile`; `setWindowOpenHandler` shown to cover `target=_blank` as well as
  `window.open`; the re-entrancy guard confirmed to still refuse a second `accept()` across the new
  `saving` state.
- **Ruling F-1 — park the `write-failed` copy overclaim, do not open a second fix wave.** The screen
  says "nothing was changed and no agent was started. Your existing setup is untouched." That is untrue
  on one path: if `installOrchestratorSkill` fails *after* `writeSoul` succeeded, the persona has been
  replaced (with a backup taken). — *Why:* the process allows exactly one fix wave, and this is one
  sentence of copy on a path that requires a mid-write filesystem failure. But it is a false statement
  to the user about their own data, and someone who reads it will not go looking for the backup that
  does exist — so it is surfaced to the user rather than buried in a minor list. — *Cost if wrong:* on a
  rare failure, a user believes their persona is intact when it was replaced; the backup is on disk
  either way.
- **Ruling F-2 — park the report's overstated test claim.** The implementer wrote that "every new
  regression test was verified to fail against the pre-fix code"; the re-reviewer checked and found the
  eight enumerated ones genuinely do, while five others would pass either way. The tests are valid
  regression guards, just not all discriminating. — *Cost if wrong:* five tests provide less assurance
  than the report implies; no code is affected.
