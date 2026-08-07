# ADR 0005 — Coding profiles default to a locked gate

**Date:** 2026-08-03
**Status:** Accepted
**Spec reference:** §5.5, §6.4

## Question

An agent that writes files should not start in a state where it can do so unattended.
§5.5 wants coding profiles to open with the permission gate **locked**. Two sub-questions
follow: how does Circe know a profile is a coding profile, and where does that fact live?

## Options considered

For determining the role:

- **A — Explicit answer only.** Ask in the Screen 5 walkthrough; anything Circe finds
  already on disk gets the neutral default.
- **B — Inference only.** Read `SOUL.md` and guess.
- **C — Explicit wins, inference as fallback.** Ask in the walkthrough; infer only for
  pre-existing profiles that never went through it.

For storage:

- **D — Write the role into the Hermes profile.**
- **E — Keep it in Circe's own state file.**

## Decision

**C and E.** Explicit opt-in wins. The role is Circe UI metadata, stored in Circe's own
state file, and **never written into the Hermes profile**.

Phase 1 ships the storage and the gate-default wiring. The Screen 5 role picker UI is
Phase 2.

The inference fallback, applied only to profiles Circe finds on disk that never went
through the walkthrough, uses:

```
CODING_RE = /\b(cod(e|ing)|engineer|developer|repo|git|filesystem|shell)\b/gi
```

against this rule (`profiles.ts`, `inferCodingProfile`):

- a keyword in the **`SOUL.md` heading** (name or tagline) is **decisive** — one match
  is enough;
- in the **body**, it takes **two distinct** keywords.

The walkthrough answer always wins when both signals exist.

> **Note:** this is not the rule as originally planned. The plan specified a single
> match against the heading or first body paragraph. That rule shipped, was found wrong
> against real data, and was replaced in commit `37ca6ef` — see Reasoning.

## Reasoning

**Why explicit wins (C over B).** Inference is a guess about intent from prose written
for a different purpose. Where the user has stated the answer, there is nothing to
guess. Inference exists only to give pre-existing profiles a sensible starting gate.

**Why Circe's state, not the profile (E over D).** §4.9 is absolute: Circe never
modifies a profile the user did not explicitly ask it to modify in this session.
Writing a `role` key into someone's `SOUL.md` to remember a UI preference would violate
that for every profile Circe merely *looked at*. The role is a fact about how Circe
displays an agent, not a fact about the agent, so it belongs in Circe's file.

**Why the two-keyword body rule.** The original single-match rule was verified against
the real machine on 2026-08-04 and was **1-for-1 wrong**. Its only positive was a false
one: the `eddie` profile — a podcast agent — matched the single word `repo` inside
"a project, demo, repo, weird hack" (`SOUL.md:34`), which is the podcast's *subject
matter*, not the agent's role. Because the heuristic only ever pre-checks a box, that
would have delivered every user on this machine a mislabelled agent.

The first proposed fix — match the heading only — was also wrong. `profiles.test.ts`
already asserts that `'# Data — helper\n\nYou manage the git repo.'` infers true, so
body scanning is deliberate spec, not an oversight. The real distinction is not
*heading vs. body*; it is **stated role vs. passing mention**. A heading is where a
persona declares what it is, so one keyword there is decisive. A body is prose, where a
single domain word can appear by accident — but two *distinct* ones rarely do.

The rule is deliberately biased toward false negatives. §5.5 only pre-checks a box the
user can set, so a miss costs one click, while a false positive silently mislabels an
agent and — because the mislabel *locks the gate* — makes it look broken.

## How this can break

The bias is the mitigation, but it is also the limitation: after the fix, **all eight**
profiles on the development machine infer `false`. The real machine confirms the absence
of a false positive but offers **no true positive** — none of these is a coding agent.
True-positive behaviour rests on fixtures alone. If a coding profile ever lands in
`~/.hermes`, re-run the check.

If a persona names its role only in prose and only once — "I help you write code" with
no other keyword and no keyword in the heading — it infers false and opens unlocked.
That is the accepted cost of the bias, and the user can set the gate in one click.

Because the role lives in Circe's state, deleting that state loses every explicit answer
and falls back to inference for everything.
