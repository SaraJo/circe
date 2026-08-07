# ADR 0006 — UI primitives: reuse vs. build

**Date:** 2026-08-03
**Status:** Accepted
**Spec reference:** §5.6

## Question

Circe needs a small set of UI primitives — button, input, segmented control, loader,
empty state, error state. §4.7 says Circe does not reimplement anything Hermes ships.
Does Hermes ship a UI layer Circe should depend on?

## Options considered

- **A — Depend on a Hermes UI package**, if one exists, so the two products look like
  one family from day one.
- **B — Adopt a third-party component library.**
- **C — Build Circe's own minimal primitive set.**

## Decision

**C.** Checked first: Hermes Agent is a **Python CLI distribution**. There is no
consumable JavaScript UI package in `~/.hermes/hermes-agent` to depend on, so option A
is not available — §4.7 has nothing to bind here.

Circe builds its own minimal primitive set in `src/renderer/ui/`. Visual harmonization
with Hermes is a future concern, not a v1 blocker.

The one hard constraint: primitives must be **internally consistent**. No two buttons
with two visual languages.

## Reasoning

Option A was the preferred answer and was ruled out by inspection rather than by
argument. Recording that inspection is the point of this ADR — the next person to read
§4.7 will ask the same question, and the answer is a fact about how Hermes is
distributed, not a matter of taste.

Option B trades a small amount of writing for a large dependency, a bundle, a
theming system to fight, and an upgrade treadmill. Circe's primitive set is six
components rendered inside two windows with a strict CSP (`default-src 'none'`, §8.4).
A component library is not a good fit for that surface, and the §4.4 zero-telemetry
constraint means every dependency's network behaviour becomes Circe's to audit.

The internal-consistency requirement is the real deliverable. Hand-rolled primitives
fail by drifting — one screen's button diverging from another's — not by being hard to
write. Naming that up front makes it reviewable.

## How this can break

If Hermes ever ships a JavaScript UI package, this decision should be revisited rather
than defended; the reason for building was availability, and that reason would be gone.
Migrating would be a real cost by then, so the trade would need arguing on its merits.

Drift is the ongoing risk. There is no automated check that two buttons look alike —
this rests on review.
