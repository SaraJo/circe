# ADR 0010 — Profile id and display name are distinct

**Date:** 2026-08-03
**Status:** Accepted
**Spec reference:** §1.2 gap — §5.4

## Question

An agent has a name the user reads and a name Hermes takes on the command line. Are
these one thing or two? And what does Circe validate a new profile id against?

## Options considered

For the identity model:

- **A — One name.** Derive the Hermes profile id from the display name, or show the id
  as the display name.
- **B — Two fields.** A lowercase profile id and a free-form display name, stored
  separately.

For validation:

- **C — Validate against `hermes profile create --help`**, which says names are
  "lowercase, alphanumeric".
- **D — Validate against what Hermes actually accepts**, observed on real installs.

## Decision

**B and D.**

- The **profile id** is what `hermes -p <id>` takes: `ford`, `deep-thought`. Lowercase.
- The **display name** is the level-1 heading in `SOUL.md`: `# Ford — Career`. Free-form,
  parsed into name and tagline by `soul.ts`.

Circe validates ids against observed behaviour, not the help string:

```
ID_RE = /^[a-z0-9][a-z0-9_-]*$/
```

— lowercase alphanumerics, plus hyphens and underscores after the first character.

Implemented in `src/main/hermes/soul.ts` (display name) and
`src/main/hermes/create.ts` (`validateProfileId`).

## Reasoning

**Why two fields.** They answer to different masters. The id is a filesystem path
component and a CLI argument, so it is constrained by Hermes and must stay stable — it
is how every future `hermes -p` invocation and every `~/.hermes/profiles/<id>/` path
finds the agent. The display name is what the tile header shows, and §6 wants it
expressive: a character name and a tagline, per locale, changeable on a whim. Collapsing
them means either an ugly id showing in the UI or a rename that breaks every path
pointing at the profile.

Storing the display name in `SOUL.md` rather than in Circe's state is deliberate and
separate from ADR 0005's reasoning. The persona heading is *about the agent* and Hermes
already owns that file; the gate role is *about Circe's UI* and belongs in Circe's file.
The dividing line is whose fact it is.

**Why observed behaviour over the help string.** Because the help string is wrong.
`hermes profile create --help` says "lowercase, alphanumeric", but `deep-thought` exists
on real installs and works — a hyphen, which the help text excludes. Validating against
the documentation would reject an id the user can create from their own terminal, and
would make Circe look broken relative to the tool it wraps. Where documentation and
behaviour disagree, behaviour is what the user will actually hit.

## How this can break

Recorded in [compat notes](../compat-notes.md) §6.

Circe's `ID_RE` is a **guess at Hermes's validation, not a copy of it** — Hermes is a
Python CLI and Circe cannot import its rule. If real Hermes is *stricter* than `ID_RE`,
Circe accepts an id Hermes then rejects, and the user sees the CLI's stderr surfaced
from `create.ts`. If real Hermes is *looser*, Circe rejects an id that would have worked
— the safer direction, but still a false refusal.

A subtler consequence: the mock Hermes fixture's validation pattern is **byte-identical**
to `ID_RE` by construction, so no test input can pass one and fail the other. That makes
the mock's rejection path unreachable through `createProfile`'s public API and leaves
the divergence above untested by anything in CI. It can only be checked against a real
install.
