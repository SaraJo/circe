# ADR 0004 — The "real profile" heuristic

**Date:** 2026-08-03
**Status:** Accepted
**Spec reference:** §5.4

## Question

A fresh `hermes` install already has a `default` profile on disk, scaffolded by Hermes
itself. Screen 3 must tell a genuinely fresh install (route to Screen 4a, create a
first agent) from one the user has already configured (route to Screen 4b, show what
they have). How does Circe decide which profiles are **real**?

## Options considered

- **A — Hash the scaffold.** Ship a hash of Hermes's `DEFAULT_SOUL_MD` and treat any
  `SOUL.md` matching it as unreal.
- **B — Name blocklist.** Treat the profile id `default` as unreal, always.
- **C — Structural heuristic on the content.** Key on a structural property that the
  scaffold lacks and every user-authored persona has.

## Decision

**C.** A profile is **real** if either:

- it lives in `~/.hermes/profiles/<id>/` — i.e. it was created by an explicit
  `hermes profile create` — **or**
- it is the root `default` profile *and* its `SOUL.md` has a level-1 heading (`# ...`)
  as its first non-empty line.

Hermes's scaffold template (`hermes_cli/default_soul.py` → `DEFAULT_SOUL_MD`) is bare
prose with **no Markdown heading**. Every user-configured profile observed on disk
begins with a level-1 heading.

A fresh Hermes install therefore yields **zero** real profiles.

Implemented and tested in `src/main/hermes/profiles.ts` (`isRealProfile`).

## Reasoning

Option A is brittle in the worst way: a single whitespace or wording change to the
upstream scaffold silently flips every fresh install to "already configured", and the
break is invisible until a user reports it. It also means vendoring a copy of someone
else's file content and keeping it in sync forever.

Option B is wrong rather than brittle. A user who edits the root `default` profile into
a genuine persona — which is exactly what happened on the development machine, where
`default` is `# Trillian — Central Coordinator` — would have their real agent
classified as scaffolding and hidden from Screen 4b.

Option C keys on a property that follows from *how the file came to exist* rather than
from its exact bytes. The scaffold is machine-written prose; a persona is human-written
and starts by naming the character. That distinction survives upstream rewording of the
scaffold, because any rewording that stays prose stays headingless.

The directory half of the rule needs no content check at all: creating a profile under
`~/.hermes/profiles/<id>/` requires an explicit `hermes profile create`, so the user's
intent is already established by the file's location.

**Verified against the real machine (2026-08-04)**, read-only: 8 profiles enumerated,
8 classified real, routing to Screen 4b. Root `default` is
`# Trillian — Central Coordinator`; all seven named profiles begin with a `#` heading.

## How this can break

Recorded in [compat notes](../compat-notes.md) §3 and §4.

The sharp edge is the scaffold. If Hermes ever seeds a `SOUL.md` that *starts with* a
level-1 heading — say `# Hermes Agent` — every fresh install would be misclassified as
having a real profile, and new users would land on Screen 4b staring at boilerplate
instead of creating their first agent. The "fresh install produces zero real profiles"
unit test is the detector; it fails the moment the fixture is refreshed against a newer
Hermes.

If the profile directory layout changes, `enumerateProfiles` returns nothing and every
user is routed to Screen 4a as if fresh. That is the safe direction — Circe offers to
create rather than silently acting on profiles it has misread — but it would be an
obvious regression for anyone with an existing fleet.
