# Circe: Current Build

**This is the authoritative product and implementation summary.** The dated
documents under `docs/superpowers/` and `docs/build-decision-record-2026-08-14.md`
are historical records. They explain earlier decisions but are not a backlog
and must not override the checked-in code or this document.

## Product

Circe is a small macOS desktop companion for Hermes. It can create a themed
coordinator for a new setup or adopt an existing Hermes fleet, then gives each
usable profile its own lightweight conversation tile.

Hermes remains responsible for providers, profiles, sessions, tools, and agent
data. Circe owns onboarding, desktop windows, presentation, and the small amount
of state needed to reopen a conversation.

## What works now

- Detects Hermes and whether a model provider is available.
- Keeps the opening explanation on screen until the user explicitly starts the
  setup review.
- Onboards the default profile from a fandom or universe chosen by the user.
- Detects unadopted existing fleets and inventories them without writing.
- Includes Hermes's root `default` agent in an adopted fleet even when its
  existing `SOUL.md` has no Circe-style H1 heading.
- Lets the user choose which existing agents receive Circe tiles without
  deleting or modifying excluded Hermes profiles.
- Can propose role-aware fandom names and palettes for the selected fleet in one
  model call. Tile inclusion is chosen first; every suggestion then has its own
  keep-or-use control. Profile ids stay fixed, and each changed `SOUL.md` is
  backed up before its heading changes.
- Lets an existing user keep every name, install orchestration on one chosen
  agent, create a separate cloned coordinator, or skip orchestration.
- Provides **Circe → Run Onboarding Again…**, with confirmation and a timestamped
  setup-record backup, so fleet visibility, identities, and coordinator choice
  can be revisited without deleting agents, conversations, or tab history.
- Writes the coordinator persona and installs the `circe-orchestrator` skill.
- Turns portraits into face-focused 32×32 pixel-art avatars while preserving
  source and treatment provenance, and lets users click any tile avatar to
  replace it with a local PNG or JPEG.
- Installs a Circe operating reference with that skill, covering automatic tile
  discovery, profile file locations, theming, private state, and troubleshooting.
- Records the chosen orchestrator separately from the foreground tile and safely
  refreshes unchanged Circe-managed skill/reference files on later launches;
  customized copies are preserved.
- Opens existing usable profiles as separate themed desktop tiles.
- Notices profiles created while Circe is running and opens their tiles.
- Streams messages and tool activity through Hermes ACP.
- Gives each tile a persistent conversation tab strip when Hermes supports
  session loading: create blank tabs, replay earlier tabs, and close Circe's
  bookmark without deleting the Hermes conversation.
- Shows friendly tool labels instead of raw tool-call identifiers.
- Presents an inline permission card when Hermes asks for approval.
- Supports allow-once, allow-for-session, and deny; it never selects permanent
  approval options. Missing UI, malformed requests, timeout, and window close
  all fail closed.
- Builds an Apple Silicon `.app` and `.dmg`.

## Deliberate boundaries

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
- `circe/last-launch.json` records the foreground profile, excluded tile
  profiles, and whether a profile was explicitly chosen as orchestrator.
- The repository's `src/` and tests are authoritative when an old document
  disagrees with current behavior.

## Release status

Automated tests, TypeScript checking, the production build, DMG creation, and a
packaged onboarding-window launch pass on the development machine.

Before public release:

1. Exercise a real Hermes permission request through every card action.
2. Sign and notarize the macOS app and DMG.
3. Test clean onboarding and every existing-fleet adoption branch against real
   multi-profile Hermes homes.

## Next product milestone

Run a small beta. Fix failures in onboarding, permission handling, restoration,
and multi-window placement before adding new surfaces. Window arrangement is the
first likely product improvement because a larger fleet currently creates many
independent windows with no management view.

Use [BETA_TEST.md](BETA_TEST.md) for the guided session and feedback questions.
The current unsigned build is suitable only for a small trusted group.

## Working rule for coding agents

Prefer the smallest change that improves the current product. Do not implement a
dated plan task merely because it is unchecked, and do not add architecture for
a speculative later phase. Update this document when the shipped product boundary
changes.
