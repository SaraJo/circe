# Circe: Current Build

**This is the authoritative product and implementation summary.** The dated
documents under `docs/superpowers/` and `docs/build-decision-record-2026-08-14.md`
are historical records. They explain earlier decisions but are not a backlog
and must not override the checked-in code or this document.

## Product

Circe is a small macOS desktop companion for Hermes. It helps someone turn the
Hermes default profile into a themed coordinator, then gives each usable Hermes
profile its own lightweight conversation tile.

Hermes remains responsible for providers, profiles, sessions, tools, and agent
data. Circe owns onboarding, desktop windows, presentation, and the small amount
of state needed to reopen a conversation.

## What works now

- Detects Hermes and whether a model provider is available.
- Onboards the default profile from a fandom or universe chosen by the user.
- Writes the coordinator persona and installs the `circe-orchestrator` skill.
- Opens existing usable profiles as separate themed desktop tiles.
- Notices profiles created while Circe is running and opens their tiles.
- Streams messages and tool activity through Hermes ACP.
- Restores the most recent conversation for each profile when Hermes supports it.
- Shows friendly tool labels instead of raw tool-call identifiers.
- Presents an inline permission card when Hermes asks for approval.
- Supports allow-once, allow-for-session, and deny; it never selects permanent
  approval options. Missing UI, malformed requests, timeout, and window close
  all fail closed.
- Builds an Apple Silicon `.app` and `.dmg`.

## Deliberate boundaries

- One visible conversation per tile. There is no tabs interface in this build.
- No fleet dashboard, global command bar, or in-app profile editor.
- No persistent Circe permission mode. Hermes decides when approval is needed;
  Circe safely presents and answers requests that Hermes sends.
- No MCP server configuration UI. The coordinator helps with that in conversation.
- No automatic permanent command allowlisting.

These are boundaries, not unfinished promises. Promote one into the roadmap only
after user feedback demonstrates the need.

## State and ownership

- Personas and profile configuration live in the Hermes home.
- Circe-specific profile presentation lives beside the profile.
- `circe/state.json` stores only window/session restoration facts.
- The repository's `src/` and tests are authoritative when an old document
  disagrees with current behavior.

## Release status

Automated tests, TypeScript checking, the production build, DMG creation, and a
packaged onboarding-window launch pass on the development machine.

Before public release:

1. Exercise a real Hermes permission request through every card action.
2. Replace the placeholder icon.
3. Sign and notarize the macOS app and DMG.
4. Test onboarding on a clean Mac and startup against an existing multi-profile
   Hermes home.

## Next product milestone

Run a small beta. Fix failures in onboarding, permission handling, restoration,
and multi-window placement before adding new surfaces. Window arrangement is the
first likely product improvement because a larger fleet currently creates many
independent windows with no management view.

## Working rule for coding agents

Prefer the smallest change that improves the current product. Do not implement a
dated plan task merely because it is unchecked, and do not add architecture for
a speculative later phase. Update this document when the shipped product boundary
changes.
