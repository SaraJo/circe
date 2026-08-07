# ADR 0002 — Provider OAuth for Screen 6

**Date:** 2026-08-03
**Status:** Accepted
**Spec reference:** §5.2

## Question

Screen 6 connects a model provider. Hermes already implements provider auth. How does
Circe get the user through it without building an OAuth client of its own?

## Options considered

- **A — Implement the OAuth flow in Circe.** Register Circe as a client, run the
  redirect, store tokens in Circe's state.
- **B — Subprocess-capture `hermes login`.** Spawn Hermes's own login in device-code
  mode, scrape the verification URL and user code out of stdout, render them in the
  wizard, and let Hermes own the tokens.

## Decision

**B.** Circe drives
`hermes login --provider <nous|openai-codex|xai-oauth> --no-browser` as a subprocess.

This is an OAuth **device authorization flow**: Hermes prints a verification URL and a
user code, Circe scrapes both from stdout and renders them, the user completes the
flow in a browser, and the process exits 0.

Success is confirmed by **exit code 0 _and_ a follow-up `hermes status` check** — never
by the printed text alone.

The "Skip — I'll connect a provider later" path is always available, and it is the only
path Phase 1 must have working end to end.

## Reasoning

Option A would make Circe a credential holder. That contradicts §4.7 (do not
reimplement what Hermes ships) and §4.5 (single-user, local-only, no Circe accounts),
and it would put provider tokens in Circe's state file, where they are Circe's problem
to protect and rotate. Hermes already stores them; there is no version of A where
Circe's copy is safer than Hermes's.

The two-signal success check is the load-bearing part. Scraped stdout is untrusted —
that is the whole reason this is in compat notes. A process can print something that
looks like success and still exit non-zero, and it can change its success wording
between releases. Exit code plus an independent `hermes status` query means the
confirmation never depends on the text Circe is least able to rely on.

Skip is always available because provider auth is the one step in the wizard that
depends on a third party being reachable and cooperative. §6.3 makes each tile the app;
a wizard that can dead-end at Screen 6 would make an unreachable provider into an
unrecoverable first run. Tiles launch either way; chat simply does not work until a
provider is connected.

## How this can break

The scraped stdout shape is unversioned — [compat notes](../compat-notes.md) §7.

If `parseDeviceCode` stops matching, it returns `null`, the wizard shows the raw log,
and the user can still take the Skip path. If the `--provider` value set changes, the
affected choice fails with Hermes's own error surfaced. If `hermes status` changes its
exit semantics, a genuinely successful login could be reported as failed — a false
negative, which costs the user a retry, rather than a false positive that would strand
them with a provider that does not work.
