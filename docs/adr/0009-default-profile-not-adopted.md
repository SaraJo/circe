# ADR 0009 — Screen 4a creates a profile; it never adopts `default`

**Date:** 2026-08-03
**Status:** Accepted
**Spec reference:** §1.2 gap — §4.9, §5.4

## Question

A fresh Hermes install already has a `default` profile. Screen 4a is where the user
creates their first agent. Does Circe **adopt** the existing `default` — writing the
chosen persona into it — or **create** a new named profile alongside it?

## Options considered

- **A — Adopt `default`.** Write the new persona into the profile that is already there.
  No second profile, no unused scaffolding left behind.
- **B — Create a new named profile.** Leave `default` untouched.

## Decision

**B.** Screen 4a always creates a new named profile via `hermes profile create <id>`.
It never adopts the scaffold `default`.

Implemented in `src/main/hermes/create.ts`.

## Reasoning

The decisive fact is a path. `hermes profile show default` reports its path as
**`~/.hermes`** — the Hermes home *root* — while named profiles live at
`~/.hermes/profiles/<id>/`.

So "adopting `default`" is not writing to a profile directory. It is writing into the
user's root Hermes configuration, on first run, before the user has any sense of what
Circe does. §4.9 forbids exactly this: Circe never modifies a profile the user did not
explicitly ask it to modify in this session. A user who launches Circe to try it out has
not asked for their root Hermes config to be rewritten, and there is no undo.

The blast radius is not hypothetical. On the development machine the root profile's
`SOUL.md` is `# Trillian — Central Coordinator` — a real, user-authored persona. Adoption
would overwrite it. ADR 0004's realness rule exists in part to make sure Circe can *see*
that case, but seeing it is only useful if Circe also refuses to write to it.

Option A's appeal is tidiness: no leftover scaffold. That is a cosmetic gain traded
against an irreversible write to a file Circe does not own. The leftover scaffold is
harmless — ADR 0004 classifies it as unreal, so it never appears in the fleet.

The §10.6 non-destruction E2E test asserts this directly: a run that *does* create a
profile leaves the root `SOUL.md` byte-identical.

## How this can break

If Hermes changes where `default` lives — moving it under `profiles/default/` like every
other profile — the reasoning weakens, because writing there would no longer touch the
Hermes root. The decision would still stand on §4.9 grounds (it is still a profile Circe
was not asked to modify), but the argument would be the weaker of the two.

The failure to watch for is a regression in `createProfile` that writes outside
`~/.hermes/profiles/<id>/`. §10.6's hash comparison over the whole Hermes home is the
detector, and it only works if the comparison stays whole-home rather than being
narrowed to the new profile's directory.
