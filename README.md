# Circe

Circe creates or adopts a Hermes fleet and gives each usable profile a tile on
your desktop. New users can make a fandom-themed coordinator; existing users
can keep their setup, selectively rename and skin agents from a fandom, and
choose whether an existing or new agent should coordinate.

For the authoritative implementation status and near-term roadmap, see
[docs/CURRENT_BUILD.md](docs/CURRENT_BUILD.md). Dated plans and specs are
historical records, not an implementation backlog.

For a small trusted test, use the guided [beta checklist](docs/BETA_TEST.md).

## What it does

1. Checks that [Hermes](https://hermes-agent.nousresearch.com) is installed and
   that a model provider is connected.
2. Detects whether this is a new setup or an existing fleet that has not yet
   made its Circe choices.
3. Existing users can preserve everything, preview fandom-based names and
   colours per agent, and choose an orchestrator without changing profile ids.
4. New users are asked what fandom, universe, or community they love.
5. Asks your model to pick the coordinator from that world, and three colours
   drawn from them.
6. Writes that character into your Hermes default profile's `SOUL.md`, along with
   a governance persona covering how to grow an agent network without it
   sprawling.
7. Installs the `circe-orchestrator` skill into that profile.
8. Opens a tile, themed by the character, with an opening message.
9. Opens tiles for existing profiles and notices new profiles created while it
   is running.

When Hermes requests approval for a tool action, Circe shows the command in the
tile and offers allow-once, allow-for-session, or deny. Circe never chooses a
permanent approval option.

Circe never wires up an MCP server itself. That is a conversation you have with
your orchestrator, which is what the skill teaches it to do.

## What it does not do

It does not reimplement anything Hermes already does. Installing the runtime,
authenticating providers, creating profiles, and running conversations all go
through the `hermes` binary.

## Running from source

```bash
npm install
npm run dev
```

To try onboarding without touching your real Hermes setup:

```bash
export HERMES_HOME="$(mktemp -d)/hermes" && mkdir -p "$HERMES_HOME" && npm run dev
```

## Tests

```bash
npm test
npm run typecheck
```

The tests never touch a real Hermes install. `test/fake/hermes.ts` implements the
same `HermesRuntime` interface the app uses, backed by three scenarios — a machine
with no Hermes, a fresh Hermes install, and an install that already has seven
configured agents. That is how the off-machine cases are covered.

## Building installers

```bash
npm run dist
```

The application icon is generated from `resources/icon-v4.png`, whose warm,
flat visual style matches the onboarding experience. Earlier concepts remain at
`resources/icon-v2.png`, `resources/icon-v3.png`, and `resources/icon.png` for
comparison.

Note: the build is unsigned and unnotarised, so macOS quarantines a downloaded
`.dmg` — Gatekeeper refuses it on a double-click. Right-click the app and choose
**Open** the first time, then confirm. Signing and notarising the release
removes the step.

## Verification status

The automated suite, typecheck, production build, DMG creation, and packaged
onboarding-window launch have been verified. A complete onboarding run on a
clean Mac and a real Hermes permission-card walkthrough remain release checks.
