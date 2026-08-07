# ADR 0011 — The orchestrator may grow the fleet

**Date:** 2026-08-03
**Status:** Accepted — **deliberate departure from §6.5** — implementation deferred to Phase 2
**Spec reference:** §6.5, §5.7, §6.6

## Question

§6.5 scopes the orchestrator handoff to wiring **MCP servers and integrations**. Adding
an agent is §6.6's job, through the fleet management surface. Should the orchestrator
also be able to propose *new agents*?

## Options considered

- **A — Hold the §6.5 line.** The orchestrator wires integrations. Adding an agent is a
  UI action the user takes deliberately, through Screen 5.
- **B — Let the orchestrator create agents freely**, as one more thing it can do when
  the user describes a workflow.
- **C — Let the orchestrator _propose_ agents**, with the UI retaining the decision.

## Decision

**C**, requested by the product owner. This is a **deliberate departure from §6.5**, not
an oversight or a reading of it.

**Phase 1 implements none of it.** No code in this phase creates an agent at an agent's
suggestion. This entry exists so Phase 2 inherits the decision, the reasoning, and — most
importantly — the guardrails, rather than rediscovering them.

The agreed guardrails, all three binding:

1. **Always-ask, regardless of gate state.** Creating an agent is an always-ask action.
   It ignores the tile's permission gate — an unlocked tile does **not** silently grant
   it.
2. **The orchestrator proposes and Screen 5 disposes.** The agent can suggest; the user
   confirms through the normal character walkthrough. There is no path from a model's
   output to a created profile that skips the UI.
3. **One agent per confirmed request. No batching.** A single confirmation creates a
   single agent.

## Reasoning

The case for departing: §6.5's own framing is that the orchestrator's job is to turn
"what are you trying to do" into working setup. When the honest answer to a user's
workflow is "this deserves its own agent," a strict §6.5 orchestrator has to stop and
tell the user to go find a menu — which breaks the conversation at the moment it was
being most useful.

The case against, which the guardrails answer: agent creation writes to `~/.hermes`.
Letting model output reach the filesystem is a different category of action from wiring
an integration, and option B would make it reachable from generated text.

Each guardrail is load-bearing:

**Why always-ask ignores the gate.** The gate's three states are about *this agent's own
tool use* — reading a file, running a command. Unlocking a tile means "I trust you with
your own work," not "I trust you to add members to my fleet." Letting unlocked imply
consent here would silently widen a permission the user granted for something narrower,
which is the failure mode the gate exists to prevent.

**Why Screen 5 disposes.** The user has to see the character, the palette, and the
coding-role question before an agent exists — those are choices only they can make
(ADR 0005). Routing through the same walkthrough as a manual add means there is exactly
one code path that creates agents, so §4.9 and §10.6 hold for both.

**Why no batching.** "Set me up for engineering work" could plausibly justify four
agents. One confirmation producing four profiles is not a confirmation the user gave.
One-per-request keeps consent proportional to what it authorizes.

## How this can break

The guardrails are process, not yet code. Nothing in Phase 1 enforces them, and nothing
will until Phase 2 builds this — so the first real risk is that Phase 2 implements the
capability and forgets a guardrail, most likely #1, because reusing the gate is the
obvious shortcut.

Guardrail #2's protection depends on Screen 5 being a genuine decision point. If Phase 2
adds a "create as proposed" shortcut that pre-fills and auto-confirms, the departure
quietly becomes option B while still appearing to honour this ADR.

If §6.5 is ever revised upstream to cover fleet growth explicitly, this entry should be
re-read rather than deleted — the guardrails were the condition of the departure, and
they should survive it becoming the rule.
