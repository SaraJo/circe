# ADR 0003 — Image-generation capability detection

**Date:** 2026-08-03
**Status:** Accepted — implementation deferred to Phase 2
**Spec reference:** §5.3

## Question

Avatars may be model-generated (§4.6). Circe therefore needs to know whether the
profile's resolved provider and model can generate an image, so the Generate option is
offered only when it would work. How is that determined?

## Options considered

- **A — Capability probing.** Ask the provider at runtime, or send a trial request and
  see what happens.
- **B — Conservative hard-coded allowlist.** Ship a short list of known image-capable
  models, read the profile's resolved model from `hermes profile show <id>`, and hide
  the Generate option for anything not on the list.

## Decision

**B**, matching the spec's own stated bias toward conservatism.

v1 recognizes as image-capable:

- OpenAI — `gpt-image-1`, `dall-e-3`
- xAI — `grok-2-image`

Detection reads the resolved provider and model from `hermes profile show <id>`, which
prints `Model: <model> (<provider>)`. Anthropic is text-only, so the Generate option is
hidden. There is no capability probing.

**Phase 1 implements none of this.** The decision is recorded now because §5.3 requires
it settled before implementation; the code lands in Phase 2.

## Reasoning

A trial request costs the user money and latency to answer a question the UI needs
before it can render. It also has no clean failure mode: a refusal, a rate limit, and a
genuine "cannot generate images" are hard to tell apart from the outside, so probing
buys an answer that is both expensive and unreliable.

The failure modes of an allowlist are asymmetric in the right direction. A missing entry
hides an option the user could have had — recoverable, and they can still upload an
avatar, which is the other half of §4.6. A wrong-positive would offer Generate on a
model that cannot do it, producing an error the user cannot act on. Conservative
listing biases toward the recoverable failure.

Reading the model from `hermes profile show` rather than from Circe's own state keeps
Hermes as the single source of truth for what a profile is actually configured to use,
which is the same principle as ADR 0002.

## How this can break

The `hermes profile show` output format is unversioned — [compat notes](../compat-notes.md) §8.
If it changes, detection returns nothing and Generate is hidden everywhere: the
conservative default degrades to "upload only", which is a working app.

The allowlist goes stale by construction. New image-capable models will not be offered
until the list is updated, and a model removed upstream would be offered until Circe
notices. Neither is silent — both surface as an option that is missing or that errors
on use — but the list needs a review each time provider support changes.
