# ADR 0001 — Hermes install and setup integration

**Date:** 2026-08-03
**Status:** Accepted
**Spec reference:** §5.1

## Question

Hermes ships an interactive `hermes setup` flow. Circe's wizard needs to detect a
Hermes install, and to create a profile on first run. Does Circe drive `setup`, or
does it reach for narrower non-interactive commands?

## Options considered

- **A — Drive `hermes setup`.** Spawn it, parse its prompts, and answer them from the
  wizard. One command covers install and first-profile in a single flow.
- **B — Never touch `setup`.** Detect with `hermes --version`, create with
  `hermes profile create <name>`, and shell out to Hermes's official managed-install
  path when Hermes is absent.

## Decision

**B.** Circe never drives the interactive `hermes setup`.

- Detection is `hermes --version`, checking `$PATH` first, then `~/.local/bin/hermes`.
- Profile creation is `hermes profile create <name> [--description ...]`, which is
  fully non-interactive and takes flags — verified against Hermes 0.14.0.
- Installation shells out to Hermes's official managed-install path, streams
  stdout/stderr into the wizard's live log, and confirms success by **re-running
  `hermes --version`** rather than by parsing installer output.
- On failure the wizard shows the raw log plus "run the installer in a terminal, then
  click retry."

## Reasoning

Parsing an interactive prompt sequence means coupling to unversioned, human-facing
text at its most volatile point. `hermes setup` exists to talk to a person; its
wording, ordering, and prompt count are free to change without notice, and a
misparse would leave Circe blocked mid-flow with no clean recovery.

`profile create` and `--version` are the opposite: narrow, non-interactive, flag-driven,
and each with a single well-defined success signal. Confirming an install by re-running
`--version` means the check is the same one Circe already trusts everywhere else, rather
than a second, weaker inference drawn from installer chatter.

This also honours §4.7 — Circe does not reimplement anything Hermes ships. Driving
`setup` from a GUI is a reimplementation of setup with extra steps.

## How this can break

The managed-install URL and the `--version` output format are both unversioned. Both
are recorded in [compat notes](../compat-notes.md) §2 and §5.

If `profile create` gains a required interactive prompt, creation hangs until the 60s
timeout in `create.ts` and surfaces the CLI's own stderr. If the `--version` string
changes shape, `locate.ts` reports `unreadable-version` and refuses to run with an
actionable message rather than a stack trace — Circe fails closed, not silently.
