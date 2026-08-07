# ADR 0007 — The orchestrator handoff skill

**Date:** 2026-08-03
**Status:** Accepted — implementation deferred to Phase 2
**Spec reference:** §5.7, §6.5

## Question

§6.5 assumes a "Circe-provided skill" is loaded into the main operator agent, mapping
user workflows (email, calendar, coding, …) to specific MCP servers and Hermes
integrations. That skill does not exist. Ship one, or ship the opening message without
it?

## Options considered

- **(a)** Ship a v1 skill covering 2–3 workflows honestly — recommended set: **coding,
  email, notes** — and document the skill's shape so more can be added later.
- **(b)** Ship the scripted opening message with no skill, let the orchestrator
  improvise, and file the skill as a later deliverable.

## Decision

**(a)**, the spec's own recommendation, taken without a reason to depart.

The v1 skill covers **coding, email, notes**. It is extended — per ADR 0011 — to also
propose new agents, under the guardrails stated there.

Skill shape and installation into the main operator's profile are **Phase 2
deliverables**. Phase 1 implements neither the skill nor the opening message.

## Reasoning

The spec puts it well: a small, honest skill beats a promise, and two or three workflows
that actually work beat eight that half-work.

Option (b) is worse than it looks. §6.5 makes the handoff "Circe's most important
behavior after the wizard" — the moment the user goes from *set up* to *useful*. An
improvising orchestrator at that moment will confidently propose MCP configuration it
has not verified, and the user has no way to tell a real integration path from a
plausible one. The failure lands precisely where the product can least afford it.

Three workflows is the right size because §5.7's real deliverable is the **shape**, not
the coverage. Contributors add workflows; the schema for a workflow entry, and the
install path into the main operator's profile, are what they cannot add for themselves.
Three entries is enough to prove the shape generalizes and few enough that each can be
verified end to end.

Deferring to Phase 2 follows §12.3 — Phase 1 does not scaffold Phase 2 files. The
decision is recorded now so Phase 2 inherits both the choice and its reasoning.

## How this can break

The skill maps workflows to specific MCP servers, which are third-party and versioned
independently of both Circe and Hermes. A server that is renamed, deprecated, or whose
config shape changes turns a skill entry into confidently wrong advice — the same
failure mode as option (b), just narrower and fixable in one place.

§6.5 requires the orchestrator **verify an integration works before declaring it done**.
That verification step is what keeps a stale entry from reading as success, so it is not
optional polish; it is the mitigation for this whole class of breakage.

If the workflow-entry schema is not documented clearly enough to be extended, the skill
stops at three workflows forever and the decision quietly becomes option (b) with extra
steps.
