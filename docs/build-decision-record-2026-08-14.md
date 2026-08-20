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

---

## Phase 1 walkthrough — session restore (2026-08-16)

Run against a sandboxed `HERMES_HOME` via `.claude/skills/run-circe`, on the real Hermes 0.14.0
with real credentials. The operator's `~/.hermes/SOUL.md` was `2e13512a` before and after, mtime
still Jul 29, all seven profiles intact, and no `circe/` state was written to the real home.

**Observed by eye, not inferred:**

- Fresh sandbox (stock Hermes boilerplate persona) opened the wizard. Derivation from "Terry
  Pratchett's Discworld" produced Lord Havelock Vetinari; accepting opened the tile with the
  opening handoff.
- A live exchange worked: "In one sentence: what is your job here?" drew a reply.
- **Quit and cold-started.** The tile opened directly onto the agent — no wizard — and the prior
  exchange was drawn: the user message in one bubble, the agent reply in another, in Vetinari's
  palette. The onboarding greeting was *not* replayed, which is correct: it is Circe's own prose
  and was never part of the conversation.
- **The user message rendered as a single bubble, not fragmented.** This was the open question
  from Task 3's review — whether one message could replay as several chunks. It does not.
- **The agent had its context back.** Asked "What did I just ask you, and what did you answer?"
  after the restart, it recalled both correctly. So `session/load` restores Hermes' own memory,
  not merely the pixels — the transcript and the agent agree.
- `circe/state.json` held exactly `{"version":1,"profiles":{"default":{"tabs":["07b1a3fd…"],
  "activeIndex":0}}}` — one session id, no message text, no agent facts (constraint 10).

**Not verified by this walkthrough, stated plainly:**

- The launch-supersession fix (closing a tile mid-restore and reopening) was not exercised by hand.
  It is timing-dependent. It now has a test — but of the decision's *guard*, not of the real
  interleaving; see the coverage note below. See also the Phase 1 ledger.
- The renderer's own update switch is still covered only by a hand-maintained copy in
  `test/restore.test.ts`, not by importing the shipped module. This walkthrough is what verified
  the real renderer; a regression in it would not fail the suite.

### What the Phase 1 fix wave changed about that coverage (2026-08-16)

The final whole-branch review found that the "boundary" test crossed neither boundary: it drove the
real `AcpClient.handle` between two *reimplementations* — the harness reproduced `index.ts`'s
session filter, and the `circe/replay-start` / `circe/replay-end` bracket was hand-pushed into the
expected array rather than emitted by the code that ships. Deleting either emit from `index.ts`
left all 183 tests green. The fix wave extracted the restore decision into `src/main/restore.ts`,
which takes its collaborators as parameters and imports no Electron, and tested it for real.

**Now covered by tests** (`test/restore.test.ts`, `describe('restoreOrCreateSession')`, against a
fake client and `FakeHermes`):

- The shipped code emits `circe/replay-start` before `session/load` and `circe/replay-end` after
  it — demonstrated load-bearing by deleting each emit and watching the suite go red.
- The session id is routable *before* the load, which is what makes the replay reach this tile.
- The `circe/replay-abandoned` notice on the fallback path, and on a load that throws.
- All three fresh-session paths (no prior id, `canLoadSession` false, `loadSession` false) end in
  `session/new` and persist exactly `{tabs:[id], activeIndex:0}`.
- The launch-window holding pen: a message typed while `session/load` is in flight is held rather
  than routed into the session being replayed, and is sent once a session exists.
- The supersession guard: a superseded call emits nothing, creates nothing, and writes nothing.

**Still not covered by any test:**

- **Nothing in `src/main/index.ts` is.** No test imports it — it pulls in `electron` at module
  scope. That leaves untested: `launchTile`'s window and client wiring, the `onUpdate` session
  filter and `onExit` handler, the `closed` handler's reset, the launch-failure copy and its report
  of unsent messages, `tile:prompt`'s dispatch on the route, `tile:close`, the `sendToTile` queue,
  and the `activate`/`boot` paths. What moved to `restore.ts` is covered; what stayed is not, and
  `index.ts` calling `restoreOrCreateSession` with the right collaborators is itself unverified
  except by the walkthrough above and by reading it.
- **The shipped renderer's update switch, still.** `test/restore.test.ts`'s `render()` is a
  hand-maintained copy of `src/renderer/tile/main.ts`'s switch; the walkthrough remains the sole
  evidence for the real one. The wave deliberately did not extract it — that is parked for the
  phase that rewrites the renderer.
- **The `circe/replay-abandoned` case in the renderer has never been seen running.** It postdates
  the walkthrough. Its main-process half is tested; the half that clears the log and writes
  "Couldn't reopen the previous conversation — starting a new one." is covered by neither a test
  nor an eye. Same for the held-message flow end to end: the holding pen is unit-tested, but no one
  has watched a message typed during a real launch arrive at a real agent.

---

## Phase 2 walkthrough — the core loop (2026-08-18)

Run against a sandboxed `HERMES_HOME` via `.claude/skills/run-circe`, on the real Hermes with real
credentials, at commit `ed174db`. Baseline recorded first: `~/.hermes/SOUL.md` was `2e13512a`, mtime
Jul 29 14:24, seven profiles, no `circe/` directory. All ten of Task 10's steps were attempted; two
of them did not produce what the plan predicted, and the reasons are recorded below rather than
smoothed over.

**Observed by eye, not inferred:**

- **Onboarding.** A fresh sandbox (stock Hermes boilerplate persona) opened the wizard. Derivation
  from "Ursula K. Le Guin's Earthsea" produced *Master Patterner — Keeper of the Immanent Grove*.
  Accepting opened the tile with the handoff message.
- **The opening copy no longer solicits a fleet.** The tile opened with what the agent can *do*
  ("Draft the email you've been avoiding… Small and real is a good place to start"), and promised to
  introduce a specialist only "as we go… when that happens" — the 2026-08-17 fix (`1b9e2f8`,
  `ed174db`) is live in the shipped product, not just in the source.
- **The profile describes itself (Step 3).** `SOUL.md` carried `# Master Patterner — Keeper of the
  Immanent Grove`; `<profile>/circe.json` held `{"version":1,"palette":{…}}` matching the tile;
  `circe/last-launch.json` held exactly `{"version":2,"mainProfileId":"default"}` — no character
  block. Constraint 10 holds on disk.
- **An agent created at a terminal tiles itself (Step 4).** `hermes profile create ford` plus a
  hand-written `SOUL.md` and `circe.json` produced a second tile within about a second, in Ford's
  green, cascaded 32px from the first, with no restart and no agent fact supplied to Circe.
- **A half-written profile does not tile (Step 5) — and for a reason the plan did not state.**
  `hermes profile create zaphod` produced *no* tile. The plan expected this because the directory
  "has no persona", but Hermes in fact writes a stock boilerplate `SOUL.md` at create time. It does
  not tile because that boilerplate has **no H1**, and the readiness rule is `isReal` = "the SOUL.md
  has an H1". Writing `# Zaphod — two heads, no plan` made the tile appear immediately. The rule is
  right; the plan's reasoning for it was wrong.
- **Missing `circe.json` degrades to presentation only.** Zaphod, created with no `circe.json`, tiled
  in `DEFAULT_PALETTE` (`#1c1c1e`/`#8a8a8e`/`#c9c9ce`) with its name and tagline intact.
- **Each tile speaks only for itself (Step 6).** A message typed into Ford's tile was drawn in Ford's
  tile and nowhere else; the orchestrator's tile showed no bubble, no streaming, no turn-end. The
  orchestrator answered its own question live in its own tile.
- **The orchestrator creates a specialist through conversation (Step 7) — the product's thesis.**
  Given a real stated need (email triage), it proposed **one** agent, named from the chosen fandom
  (*Ogion*), with a pruned loadout (cheap model, email skills only, no browser/terminal/code) and
  read-and-draft-only authority on day one, and it asked for confirmation before creating anything.
  On approval it ran `hermes profile create` honouring `HERMES_HOME`, wrote a persona whose own text
  says "You do not roleplay him", wrote `circe.json`, and **a fourth tile appeared on its own**.
- **The `HERMES_HOME` fix holds (C1/R1).** The orchestrator's writes landed in the sandbox. No
  directory named `${HERMES_HOME:-$HOME/.hermes}` was created anywhere.
- **Cold start (Step 8).** Quit and relaunch opened no wizard and reopened all four tiles, each on its
  own conversation, with the main operator launched last. The orchestrator's four-exchange transcript
  replayed in order; the onboarding greeting was correctly not replayed.
- **The real home is untouched (Step 10).** `~/.hermes/SOUL.md` still `2e13512a`, mtime still Jul 29,
  still seven profiles, still no `circe/` directory, and neither `master-patterner` nor `ogion`
  appears in it. The real home's only changes during the run were its own running Hermes' doing —
  `kanban.db-wal`/`-shm`, `channel_directory.json`, `cron/.tick.lock`, and a `hermes-agent` git fetch.

### Two defects this walkthrough found

**D1 — an orchestrator-created specialist tiles in the wrong colours.** Ogion's tile opened in
`DEFAULT_PALETTE` grey, not the brown-and-gold in the `circe.json` the orchestrator had just written
for it. Mechanism: `isReal` becomes true the moment `SOUL.md` lands, the 600ms-debounced sweep
launches the tile immediately, and the palette is read once at launch. A real agent writes the two
files as two separate tool calls — observed four seconds apart (`SOUL.md` 10:49:15, `circe.json`
10:49:19) — so `circe.json` does not exist yet when the tile reads it, and once the profile is in the
watch's `tiled` set nothing re-reads it. **Step 4 hid this** because a human writes both files inside
one shell command, well within a single debounce window; only a real agent is slow enough to expose
it. It self-heals on the next cold start — verified: after restart Ogion's tile was correctly
`rgba(43,36,22,.85)` with accent `#c8a24a`. So: wrong identity colours for the whole first session of
every agent the orchestrator creates, which is the one moment the agent is being introduced.

**D2 — the specialist could not hold a conversation.** Both the terminal-created Ford and the
orchestrator-created Ogion answered their first message with `API call failed after 3 retries:
Parameter validation failed: Invalid length for parameter modelId, value: 0`. The `default` profile
answered normally throughout, so nothing about Circe's transport is implicated — Circe spawns
`hermes -p <id> acp --accept-hooks`, Hermes' own supported mechanism. The difference is on disk: the
operator's working profiles each carry their own `config.yaml` and `auth.json`, while a profile fresh
from `hermes profile create` carries neither (the CLI says so at creation: "This profile has no API
keys yet. Run 'setup' first, or it will inherit keys from your shell environment"). Copying the home's
`config.yaml`, `auth.json` and `.env` into the profile changed the error rather than fixing it —
`(ValidationException) … ConverseStream`, i.e. it then resolved to Bedrock. **Caveat, stated plainly:**
the sandbox inherits the operator's real and unusually complex `config.yaml`, which carries Bedrock
settings. Whether a newcomer with a plain Anthropic key hits this is **not known from this run**. What
is known is that the core loop can end in a correctly-created, correctly-tiled agent that errors on
its first message, and that nothing in Circe or in the orchestrator skill runs profile setup.

### Corrections to the plan itself

- **Step 5's rationale was wrong** (see above): `hermes profile create` does write a `SOUL.md`; the
  H1 is what does the work.
- **Step 9's recipe for `circe/replay-abandoned` does not trigger it.** The plan suggested using "an
  id belonging to a different profile's real session" to get past the `session/list` check. Hermes
  scopes sessions per profile, so another profile's real id fails `canLoadSession` exactly like a
  nonexistent one. Verified: pointing `default`'s tab at Ford's real session id and cold-starting
  produced a fresh session (`0f3fdda9…` replaced it in `state.json`) and an empty tile — correct
  behaviour, no orphaned transcript, but **no notice, and no way to see one.**

### What this walkthrough did not verify

- **The `circe/replay-abandoned` notice has still never been seen running** — now for a documented
  reason rather than an oversight. Its main-process half is unit-tested; the renderer half that
  clears the log and writes "Couldn't reopen the previous conversation — starting a new one." remains
  covered by neither a test nor an eye.
- **The holding pen was not conclusively exercised.** A message fired at the tile the instant launch
  returned was drawn once and answered once, with no duplicate — but whether it actually landed while
  `session/load` was in flight could not be established from outside, so this is evidence of no
  duplication, not evidence the holding pen ran.
- **Multi-display placement is unverified.** The machine had a single 3840×1600 display, so "opens on
  the display holding the cursor" could not be distinguished from "opens on the only display". Tiles
  did open at the expected top-right anchor and cascade (3370,65 → 3338,97).
- **Nothing in `src/main/index.ts` is covered by a test, and neither is the shipped renderer's update
  switch.** Unchanged since Phase 1. This walkthrough is again the only evidence for both.
- **Ford's error reply did not survive a restart** — after cold start only the user message replayed.
  Consistent with the error being an ACP-level failure rather than a transcript entry, but not
  confirmed against Hermes' storage.
- **A tool call renders as a raw id.** During the Ogion creation the orchestrator's transcript drew
  `⚙ toolu_01VsyAkmt8QqNFMnbPNhP96g`. Cosmetic, unreviewed, recorded here because it was seen.

### D1 fixed (2026-08-18)

The fleet watch now reports profiles that already have tiles, not just new ones: `FleetWatchDeps`
gains `onKnownProfile`, which `index.ts` wires to the same `characterFor` read the launch does, and
`TileRegistry.retheme` pushes the result to that tile over a new `tile:character` channel — but only
when the name, tagline or palette actually differ, since an agent mid-conversation writes under its
own profile constantly. The renderer's initial application became `applyCharacter`, called for the
character in the URL and again on every update; a malformed update is ignored so a bad read cannot
reset a correctly-themed tile.

Verified by hand against the original repro rather than only by the suite: a profile created at a
terminal, its `SOUL.md` written, and its `circe.json` written **19 seconds later** — the tile opened
in `DEFAULT_PALETTE` grey and recoloured to `rgba(59,13,46,.85)`/`#ec4899` on its own, with no
restart. Renaming the H1 in that same `SOUL.md` afterwards changed the tile's heading and its
composer placeholder live, which is the "disk wins" rule the wizard already follows.

`isOpen`, not the watch's `tiled` set, decides who gets re-read: a tile the user closed has no window
to send to, and re-reading its files on every unrelated write would be cost with no effect. The
renderer half remains untested by the suite for the reason recorded above — this is again evidence by
eye.

### D2 fixed (2026-08-18), and what it turned out to be

D2 reproduced through the plain CLI with Circe not running: `hermes -p ford chat -q "say ok"` on a
bare-created profile auto-detected provider `bedrock` and failed `AccessDeniedException`, while the
`default` profile answered normally. A profile created bare inherits neither the home's provider
config nor its keys. Hermes already ships the fix — `hermes profile create --clone` copies
`config.yaml` and `.env` from the active profile — and a cloned profile answered first try.

Cloning also copies the source profile's skills, and the source is the orchestrator itself, so the
skill now deletes `circe-orchestrator` from the clone: one coordinator, not a franchise.
`--no-skills` cannot be used instead — Hermes rejects it as mutually exclusive with `--clone`.

**The larger finding.** Changing the skill was not enough. Asked for a specialist twice — once on a
deliberately clean session with no precedent in context — the orchestrator created the profile from
memory both times: a correct `SOUL.md`, but no `--clone` and no `circe.json`, the latter a step that
predates this work and had succeeded that morning. The cause was not model variance. The **persona
carried its own competing copy of the procedure**: step 4 of `SOUL.template.md` said to run
`hermes profile create <id> --description "…"` and write `~/.hermes/profiles/<id>/SOUL.md`. The
persona is always in context; a skill has to be chosen and loaded. The orchestrator followed the
persona, exactly as written — bare create, no colours file. That literal `~/.hermes` is also C1
again, living in a second place nobody checked when C1 was fixed in the skill.

Step 4 is now "load the `circe-orchestrator` skill and follow it", and the template is tested for
both the pointer and the absence of a literal `~/.hermes`. One procedure, in one place; the persona
says only when to reach for it.

**Verified by eye on a fresh sandbox**, onboarding through to a created specialist (*Killick*, from
Patrick O'Brian): `profiles/killick/` carries `config.yaml` and `.env` (so `--clone` ran), carries
its own `circe.json`, and no longer carries `circe-orchestrator` (so the removal ran). `hermes -p
killick chat -q "say ok"` answered **ok** — the thing D2 said was impossible. The real home was
untouched throughout.

Worth recording together: Killick's tile *launched* in `DEFAULT_PALETTE` — its window URL still
carries `#1c1c1e` — and was corrected live to `rgba(58,42,20,.85)` when `circe.json` landed seconds
later. That is D1's fix and D2's fix visible in the same run.

### The deferred meet-screen question, decided (2026-08-19)

The voice plan left one thing to the product owner: whether the meet screen shows a line in the
character's voice before the user clicks. **Yes**, as `Character.intro`.

What settled it was not the screen but the button next to it. Everything the meet screen shows is
Circe describing the character in the third person — the lead, the tagline, `why` — and that register
is identical for every candidate. So "Try someone else" was a choice without a difference: it
swapped one neutral description for another, while the voice, the only thing that really
distinguishes two candidates, stayed hidden until after the user had committed to one.

The intro is deliberately **not** the greeting, and the prompt says so in those words. The greeting
is written to someone who has already accepted this agent; the intro is spoken to someone still
deciding. Asked without that distinction, a model returns the greeting twice.

**The height finding.** The first bound was 200, copied from `voiceCheck`. That was wrong, and the
arithmetic rather than the eye caught it: `voiceCheck` lands in a scrolling tile conversation, while
the intro renders inside the wizard's fixed 640x560 next to the lead, the avatar block, `why` and
both buttons. At 17px in a 38ch column, 200 characters is six lines — about 75px past the bottom of
the window, taking the primary action with it. That is the same defect class as the 624px-in-a-520px
window this project already shipped once. The bound is 120, and `wizard.css` caps the element at
three lines under M7's pinned-px rule as well, so the failure mode if a wide script wraps to four is
a scroll and not a vanished button.

**Verified against the real runtime**, on the sandbox: "Clueless" derived Cher Horowitz, whose intro
came back as *"Okay so I already have a hunch about where to start, but you go first."* — 76
characters, two balanced lines, quotation marks in her accent, both buttons well clear of the bottom
edge. `~/.hermes/SOUL.md` was byte-identical before and after, and still had its seven profiles.

### No em dashes in Circe's own copy (2026-08-19)

A standing copy constraint from the product owner. The em dash is the house tell of machine-written
prose, and onboarding is the copy that most has to read as though a person wrote it. Five wizard
leads and `plainCheck` lost theirs; a rule over `Object.values(COPY)` in the §1.4 block holds the
line, so a new screen inherits it by being added to the object rather than by anyone remembering.

**Scoped to what Circe writes, on purpose.** `greeting`, `voiceCheck` and `intro` are the model's
words. `derive.ts` asks for them without em dashes and does not strip them, so one can still reach
the tile — the accepted cost of not editing the character's voice on its behalf. The `SILVER`
fixture keeps its em dash to hold that line in place.

### The raw tool-call id, fixed (2026-08-19)

The last of the Phase 2 walkthrough's loose ends: `⚙ toolu_01VsyAkmt8QqNFMnbPNhP96g`, recorded then
as "cosmetic, unreviewed, recorded here because it was seen".

It was neither the model nor Hermes. ACP requires `title` on `tool_call` and makes every field except
`toolCallId` optional on `tool_call_update` — "only the fields being changed need to be included" —
so a tool reporting a status change legitimately sends no title. The renderer answered a missing
title with the `toolCallId`, a line inherited verbatim from the prototype
(`~/Code/circe/renderer.js:398`). The bubble therefore named the tool correctly while it ran and
replaced that name with a raw id the moment it finished, which is why it was only ever seen after
the fact.

Worth noting for the class: the correct rule was already written down twelve lines away in the same
file, on the re-theme path — "losing an update costs colours; applying a bad one costs identity". The
tool bubble was applying a bad one. A rule stated once in a comment does not generalise itself to the
next branch down.

The decision now lives in `toolLabel.ts` so a test can reach it, the move `copy.ts` already made on
the wizard side. Eight tests on a renderer file that previously had none, against the coverage hole
two walkthroughs have flagged.

**Verified against the real runtime** on the sandbox, on the scenario that produced it. Asked to read
its own `SOUL.md`, the agent ran two tools; the bubble drew `⚙ terminal: hermes profile show default`
and then `⚙ read: …/SOUL.md`, and still read `⚙ read:` once the turn was over. No `toolu_` in the
transcript. The real `~/.hermes` was byte-identical before and after.

Incidentally confirmed in the same run: the agent's own reply contained "I'll grab it — one sec".
That is the em dash rule's boundary working as designed — the character's words are its own.

## Avatar sourcing built (2026-08-19)

Six tasks on `avatar-sourcing`, executed subagent-per-task with a review after each and a
whole-branch review at the end. 473 tests. What the process caught is more interesting than the
feature.

### The bug six passing reviews could not see

Every task passed its own review. The whole-branch review then found a defect that lives entirely
between two of them: `lookUpFace`'s re-emit was guarded only by the derivation `generation` counter,
which `accept()` does not bump — so an avatar lookup resolving **after** the user accepted re-emitted
`{kind: 'launching'}`, and `index.ts` treats every `launching` emission as "launch the tile now". A
second `tiles.launch` raised and focused the window, re-shelled `hermes profile list`, re-raised
every other open tile, and stopped and restarted the fleet watch, seconds into the user's first
conversation. In the same interleaving the face was found, held, and never written, so a
fast-accepting user got initials permanently.

Task 3 introduced the first re-emit of an existing state in this codebase. Task 4 wired a listener
that assumed `launching` fires once. **Both were correct in isolation, and each had a reviewer.**
The seam had none until the final pass. This is the concrete instance of the failure mode this
project already suspected, and it is worth keeping as the argument for why the whole-branch review
is not optional.

### What the guardrails caught in the wild

Walking onboarding on the real runtime, "Star Trek: The Next Generation" derived **Data** — and the
bare name resolves to Wikipedia's article about *information*, which is `type: standard` and **has a
thumbnail**. Only rule 4, the requirement that the extract mention the user's fandom, stopped a stock
illustration of data being written to disk and presented as the user's coordinator. The dangerous
case is not hypothetical; it appeared on the second fandom tried.

### The hit rate is lower than the design measured, and why

The design's probe found thumbnails for nine of thirteen characters. That probe used **full,
unambiguous names** chosen by hand ("Hermione Granger", "Tyrion Lannister"). Derivation produces
short display names, and Wikipedia disambiguates most fictional characters with a parenthetical:

- "Data" is the information article; **"Data (Star Trek)"** is the character, and has a usable image.
- "Mrs. Hudson" is a real article that mentions Sherlock Holmes but carries no image at all.
- "Cher Horowitz" redirects to *List of Clueless characters*.

Three live fandoms produced one face. The obvious follow-up is a second attempt at
`"<name> (<fandom>)"` on a miss, which would likely recover much of the gap. Deliberately not built:
it is a design change, not a defect, and it was found after the plan was approved.

### Open, deliberately, for the product owner

- **The `claim-default` screen shows no face.** A returning user confirms replacing their agent, and
  a face is written that they never saw. Not a spec violation — the design names two display sites,
  the meet preview and the tile header — but it makes the "held in memory while you decide" design
  meaningless on that path. Adding it was declined during the fix wave as unreviewed UI invented in a
  fix round. The coupled latent bug (a declined character's face lingering) was fixed, so adding the
  face later cannot produce a stale-face flash.
- **The tile header's layout.** The avatar sits hard left, the display name hard right, and at 22px
  the face reads as a coloured dot rather than a portrait. §6.3 names the header's parts without
  fixing their arrangement, so this was the implementation's call and wants an eye.
- **The design's single retry on 429/5xx was never built**, and its own test list names a test for it
  that does not exist. Low impact — real usage is one lookup per onboarding — but the design and the
  code disagree.


## The face lookup actually finds faces (2026-08-20)

Branch `avatar-lookup-recall`, four commits, 511 tests. This closes the first and third of
the three items the avatar-sourcing entry left open for the product owner, and one it did not
know it was leaving.

### The measured baseline was wrong, and wrong in the direction that hides the problem

The avatar-sourcing design probed thirteen characters and found thumbnails for nine. That probe
typed the names by hand: "Hermione Granger", "Tyrion Lannister". Derivation does not produce
those names. It produces "Hermione" and "Tyrion", and re-running the same guardrails over
realistic derived names across twelve fandoms finds **one** face, not nine.

So the feature shipped believing it worked three quarters of the time while working roughly
one time in twelve. The previous entry already suspected the hit rate was "lower than the design
measured" and named the cause correctly; what it did not do was re-measure, and the gap between
"lower" and "1 in 12" is the difference between a rough edge and a feature that does not work.

**Worth keeping as a class:** a probe that supplies its own inputs measures the probe. The
inputs have to come from the thing that will really supply them.

### The follow-up the last entry proposed does not work

That entry recommended "a second attempt at `<name> (<fandom>)` on a miss, which would likely
recover much of the gap", and offered `Data (Star Trek)` as the evidence. Checked against the
live endpoint, `Data (Star Trek: The Next Generation)` is not an article and returns an error.
The real title is `Data (Star Trek)`, and the only reason the entry could name it is that a
human had already found it by hand. The rule that would have had to produce it does not exist,
because Wikipedia's disambiguator is not the fandom string and nothing derives one from the
other.

A recommendation written from a worked example, where the example was worked by a person, and
the rule was never stated. It looked like a plan and was a wish.

### Search finds the character, and cannot be trusted with the rules that exist

Searching `en.wikipedia.org` for `"<name> <fandom>"` does find `Data (Star Trek)` and
`Trillian (character)` at the top, which is the class of article no name reaches, since
Wikipedia disambiguates most fictional characters.

It also answers a question nobody asked. Rules 1 to 5 were written for a lookup by exact name,
where the only question was whether the article was trustworthy. They pass the show, the film,
the episode and the actor, because all four are standard articles that carry a free image and
mention the fandom, and rule 4 asks for nothing more. Measured over the same twelve fandoms,
search behind the existing rules takes a **wrong face in eight of them**:

- "Kaylee Frye Firefly" returns `Firefly (TV series)` and, one place later, **Jewel Staite**.
- "Samwise Gamgee Lord of the Rings" returns **Sean Astin**.
- "Willow Buffy the Vampire Slayer" returns `Oz (Buffy the Vampire Slayer)` — the right show,
  the wrong character.
- "Mrs. Hudson Sherlock Holmes" returns a photograph of 221B Baker Street.

Two of those are photographs of living people, which would have been written into the user's
profile and presented as their coordinator. The module's founding asymmetry, that a wrong face
is worse than no face, is not a slogan here: search without new rules is a feature that
confidently assigns strangers' faces to two thirds of its users.

### Two rules, and both are load-bearing

**Rule 6 reads the title.** Strip a trailing disambiguator, and what remains must be a name we
asked for or extend it on a word boundary. This is what separates the character from the show
and from the actor, and it is a title check rather than a prose check because prose about
Firefly legitimately mentions Firefly.

**Rule 7 reads the article's own description.** Rule 6 cannot reach `Janet(s)`, the tenth
episode of The Good Place season 3, whose title honestly is the character's name plus a
parenthetical. Its description, "10th episode of the 3rd season", is the only thing that gives
it away.

Neither applies to the two direct lookups. Applied there, rule 6 rejects "Vimes" reaching
`Sam Vimes` by redirect, which is a case that works today. The rules exist to judge an article
nobody asked for by name, and the direct path asked for it by name.

Over the twelve: **1 face before, 7 after, no wrong faces.** The five that still miss are
characters with no article of their own (Cher Horowitz and Kaylee Frye both redirect to a
character list, Janet is a disambiguation page) or with an article carrying no free image
(Mrs. Hudson, Samwise Gamgee). Nothing recovers those, and every near miss for them is one of
the hazards above, so ending in initials is the design working.

### The retry was in the design, absent from the code, and demonstrated by accident

The avatar-sourcing design specified a single retry on 429/5xx and its test list named a test
for it. Neither was built, and the previous entry recorded the disagreement as low impact
because real usage was one lookup per onboarding.

Search changes that: a miss now costs several requests, and misses run at 7 of 12. The
demonstration came free — **the probe that produced every number above was itself 429ed by
Wikipedia, and reported the throttling as twelve characters having no face.** The tool measuring
the failure mode reproduced it. A user who hits the same limit gets initials, silently, exactly
as §10.7 requires and exactly as invisibly.

A 404 is deliberately not retried: it is the ordinary answer for a character with no article,
and retrying it would double the cost of every miss.

### The seam, again

`retrying` only recognises an `HttpError`. The real fetch layer lived in `index.ts` and threw a
plain `Error`, which would have left every retry test green and the retry inert in production —
the same shape as the defect the last branch's whole-branch review caught between two tasks that
had each passed their own review. Building the real deps as `httpDeps` in `avatar.ts` puts the
error type under test.

The user agent stays in `index.ts`, because it carries a project URL and the provenance test
reads every hostname in `avatar.ts` as an outbound destination. That test was written to be
blunt on purpose and it caught this on the first run; the right move was to move the string, not
to teach the guard about exceptions.

### And the half of a known bug that was never fixed

`accept()` reads `pendingAvatar` once, as it runs. A lookup still in flight when it passed left
the face found, held in memory, and never written. The last entry described this exact
interleaving and fixed the half that double-launched the tile; the half that silently dropped
the face was described and left.

It was survivable at one request per lookup. At up to eleven, each with an eight second ceiling,
it would have quietly undone the entire point of this branch, because a face found and then
dropped is indistinguishable from a face never found — including in any measurement we would
have taken afterwards.

`committed` marks the moment the persona reaches disk, which is exactly when constraint 9 stops
applying. Both write paths now go through one `writeAvatar`: two copies of that procedure are
two chances for the late path and the accept path to disagree about where a face goes, which is
the same lesson as the SOUL template carrying its own stale copy of a skill's procedure.

### Verified against the live endpoint, through this code

Ten fandoms, the real `findAvatar` and the real `httpDeps` against live Wikipedia: six faces,
four initials, **every single result the one predicted**, no wrong faces. `Data (Star Trek)`,
`Hermione Granger`, `Tyrion Lannister`, `Trillian (character)`, `Sam Vimes`, `Willow Rosenberg`;
initials for Kaylee, Janet, Cher Horowitz and Samwise.

### Still open

- **The `claim-default` screen still shows no face.** Untouched by this branch, and still the
  one display site the design names that does not display.
- **The tile header's layout** still wants an eye: avatar hard left, name hard right, 22px.
- **Hit rate above 7 in 12 needs a different source.** The remaining misses are Wikipedia not
  having the material, not the lookup failing to find it. A character-wiki source would be a
  new outbound host and a constraint 4 decision, not an implementation one.

## A second source, and three things only the live one could tell us (2026-08-20)

Same branch, two more commits, 536 tests. The product owner's call: "having both Wikipedia and
Fandom seems to work in most cases." Constraint 4 now permits two more destinations, any
`*.fandom.com` wiki and `static.wikia.nocookie.net`.

**Wikipedia keeps first refusal** because it is the only source that says anything about an
image's licence. Fandom is asked only on a miss, and its faces are recorded as `unknown` rather
than guessed at, which is the honest answer: Fandom exposes no machine-readable licence at all.
The licensing question the avatar-sourcing entry flagged as a release blocker is narrower than
it looked. Circe hosts nothing and ships nothing; the repo bundles zero images, the fetch happens
on the user's machine, and the file lands in their own profile directory.

### The model names the wiki

Nothing derives `lotr.fandom.com` from "The Lord of the Rings" or `bakerstreet.fandom.com` from
"Sherlock Holmes", and Fandom's own wiki-search endpoint answers 403. The model knows both, and
it is already being asked for the character, so it is asked for the wiki in the same call. The
same move as the full name, and it generalises: **when a lookup needs a key that only a human
would know, the model is already holding it.**

That also makes it the one model-supplied value that chooses where Circe connects to, so it is
bounded twice by the same anchored pattern: in `derive.ts`, where anything that is not a plain
Fandom subdomain becomes `''`, and again in `fandom.ts`, which is what actually opens the
connection. A host check that lives only in the validator is one refactor from being gone, and
the provenance test now pins both.

### Three defects the documentation could not have shown, and one that hid the others

**The placeholder.** `bakerstreet.fandom.com` answers "Mrs. Hudson" with `Silhouette-female.png`.
Right host, right page, right character's article, and a grey outline. Every rule on the branch
passes it. This is a different failure class from the wrong-subject ones the Wikipedia rules
catch: not the wrong person, a non-person, and it is the more dangerous of the two because **it
counts as a hit in any measurement of how often a face was found.** A source that answers every
query with a silhouette would have measured as perfect.

**The format.** Fandom serves WebP for every image, whatever the URL extension says. `Kaylee.jpg`
returns `image/webp`, and so does the same URL requested with `Accept: image/png,image/jpeg`,
with `image/*`, with a scaling path, and with `format=jpg`. `nativeImage` decodes PNG and JPEG
only. So the first live run found a face for all five characters and dropped all five at the
final conversion, silently, presenting exactly as a source that has no pictures. `format=original`
is the one parameter of the six tried that returns the real JPEG.

**The size.** The original is the full upload. Janet's is 1.6MB, for a face drawn at 22 pixels in
a tile header, and it would have been converted to PNG and written into the user's profile at
that size. `scale-to-width-down/256` returns the same image at 16KB, a hundredfold difference
nobody would have noticed until a profile directory did.

**And the one that hid them.** The first live run of the two-source chain returned initials for
every case, including two that had passed minutes earlier. Reading it as "the second source does
not work" would have been wrong twice over: the WebP defect was real, and the Wikipedia
regressions in the same run were rate limiting, the same 429 the retry exists for. A failing
verification run had two independent causes and one of them was noise. Walking it by hand, one
request at a time, was what separated them.

### The rule this keeps proving

Every defect in this entry was found by running the real code against the real source, and not
one of them was reachable from the API's documentation or from any test written against a
fixture. The fixtures in `fandom.test.ts` are all *derived from* live responses for this reason;
a fixture written from the docs would have described a JPEG at a `.jpg` URL and been wrong in the
same way for both the format and the size.

### Where it stands

Verified end to end against both live sources: **10 of 12**, five from Wikipedia and five from
Fandom, every image a JPEG between 10 and 59KB. The two remaining misses are both correct
behaviour - `clueless.fandom.com` genuinely has no page for Cher Horowitz, and Mrs. Hudson is the
silhouette being refused.

One property worth recording: the split between the two sources is **not stable run to run**.
"Vimes" came from Wikipedia in one verification run and from Fandom in the next, because the
Wikipedia lookup was rate limited. The face is right either way, which is the point of having
two, but any future measurement of "how many come from where" needs more than one run to mean
anything.

## Provenance, the blocker that was one line of plumbing (2026-08-20)

Branch `avatar-provenance`, 545 tests. The avatar-sourcing entry recorded that "the design
claimed provenance is written alongside the image and leaned on that to justify the licensing
decision. It is not written anywhere." That stayed true through two further branches.

The shape of it is worth naming. `findAvatar` computed the article URL, the title and the
licence, `AvatarFind` carried all three through every layer, and `wizard.ts` destructured
`bytes` and `contentType` and dropped the rest on the floor. Nothing was missing, nothing was
wrong, and no test failed. **The data was collected correctly and then discarded by the last
caller**, which is a failure mode no unit test looks for, because every unit was doing its job.

Adding Fandom sharpened it rather than changing it. Those images carry no machine-readable
licence, so `unknown` is the only honest record, and writing nothing at all meant a profile held
a likeness from an unnamed wiki under an unstated licence.

### Where it lives, and why not in `circe.json`

`avatar.json`, beside `avatar.png`, inside the profile. Constraint 10 settles the location:
which article a likeness came from and under what licence is a fact about that profile and about
nothing else. Not a field in `circe.json`, for two reasons: that file is the palette and is
rewritten on every re-theme, and a face and its provenance have to move together or the record
starts describing a previous agent.

### One call writes both

`saveAvatar` now takes what the lookup found rather than loose bytes. That is the whole point:
two write sites would be two chances for the face and its record to disagree, the same argument
that put both accept paths through one `writeAvatar` on the previous branch, and the same
argument the SOUL template lost when it kept its own copy of a skill's procedure.

The image is written first, and a failure to write the record afterwards is swallowed. The face
is already on disk and is what the user sees; failing the save at that point would trade a
working avatar for its paperwork, and §10.7 keeps every avatar failure silent.

The ordering matters in one direction only: a record with no image is refused, because it is a
claim about a file nobody can check. An image with no record is merely the state everything
shipped in until today.

### Verified live, both sources

- `Data (Star Trek)` records `en.wikipedia.org`, licence `commons`.
- `Samwise Gamgee` records `lotr.fandom.com`, licence `unknown`.

### Still open

- **The `claim-default` screen shows no face.** Named in the avatar-sourcing entry, untouched
  since. A returning user confirms replacing their agent and is given a face they never saw.
- **The tile header's layout.** Avatar hard left, name hard right, 22px.
- **Attribution is recorded but never shown.** Deliberate: the file makes the licensing position
  auditable, which is what the blocker needed. Whether a user should *see* where their agent's
  face came from is a question about the meet screen and the tile header, not about records.
