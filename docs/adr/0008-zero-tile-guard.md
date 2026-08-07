# ADR 0008 — The zero-tile guard

**Date:** 2026-08-03
**Status:** Accepted
**Spec reference:** §1.2 gap — §6.3, §6.3.4

## Question

What happens when the fleet would launch **zero** tiles? The user can mark every profile
"leave alone" on Screen 4b, or every profile on disk can be malformed. The spec has no
answer.

## Options considered

- **A — Launch zero tiles.** Honour the user's choices literally.
- **B — Force at least one tile.** Override the user and launch something.
- **C — Refuse to proceed, and say why.** Block the transition and offer a way out.

## Decision

**C.** Screen 7 refuses to close on an empty fleet. It shows **"No agents to launch"**
with two actions: *Add an agent* and *Back*.

The same guard runs at fleet boot on later launches, not only in the wizard.

Implemented in Task 15 (`src/main/fleet.ts`).

## Reasoning

This is a **soft-lock**, and it follows from two spec statements that are individually
fine and jointly fatal. §6.3 says each tile *is* the app — there is no separate main
window to fall back to. §6.3.4 says closing the last tile quits. Together: zero tiles
means no UI, and no UI means no way to get back to a non-zero state. The user would
quit into a state that reproduces itself on every subsequent launch. Nothing in the app
could recover it; only editing Circe's state file by hand, or `hermes profile create`
from a terminal, would.

Option A is therefore not "honouring the user's choice" — it is honouring a choice whose
consequence the user cannot see and cannot undo. Option B avoids the lock but violates
§4.9's spirit by acting on a profile the user explicitly said to leave alone, and it
would be baffling: an agent appears that you just declined.

Option C is the only one that keeps the user's choices intact *and* leaves the app
usable. It also fails at the right moment — at the point of the decision, while the
context is still on screen and *Back* still means something — rather than on the next
cold launch.

Running the same guard at fleet boot matters because the empty state can arrive without
passing through Screen 7 at all: profiles can be deleted or corrupted outside Circe
between runs. A guard that only lives in the wizard would leave the exact soft-lock it
was written to prevent.

## How this can break

The guard's correctness depends on *Add an agent* actually being reachable and working
from the empty state. If that path ever depends on an existing tile — for a window
parent, a palette source, or state that is only populated once a tile exists — the guard
becomes a dead end that is worse than the original lock, because it looks like a
recovery and is not.

The E2E zero-tile test is what holds this. It must drive the empty state and then
successfully create an agent from it, not merely assert that the guard message appears.
