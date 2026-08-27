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
3. Existing users choose agents individually for Circe tiles, then accept or
   reject each fandom-based name and colour suggestion independently. Excluded
   agents stay untouched in Hermes, and profile ids never change.
4. New users are asked what fandom, universe, or community they love.
5. Asks your model to pick the coordinator from that world, and three colours
   drawn from them.
6. Writes that character into your Hermes default profile's `SOUL.md`, along with
   a governance persona covering how to grow an agent network without it
   sprawling.
7. Installs the `circe-orchestrator` skill and its Circe operating guide into
   that profile.
8. Opens a tile, themed by the character, with an opening message.
9. Opens tiles for existing profiles and notices new profiles created while it
   is running.

Circe versions its own installed orchestrator resources. On launch it updates
copies that still match what Circe previously installed and leaves customized
copies untouched.

To revisit fleet selection, fandom identities, or coordinator choice, choose
**Circe → Run Onboarding Again…** from the macOS menu bar. Circe backs up its
onboarding record and preserves agents, personas, conversations, and tab history.

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

Prerequisites:

- macOS on Apple Silicon
- Node.js 20 or newer and npm
- Hermes installed and a model provider configured

Clone the repository, install the locked dependencies, and start Electron:

```bash
git clone git@github.com:SaraJo/circe.git
cd circe
npm ci
npm run dev
```

By default Circe uses `~/.local/bin/hermes` and `~/.hermes`. Override either
location when needed:

```bash
CIRCE_HERMES_BIN=/path/to/hermes HERMES_HOME=/path/to/hermes-home npm run dev
```

Running against the default Hermes home can change profiles when onboarding is
accepted. To exercise onboarding without touching the real Hermes home, point
Circe at a temporary one while continuing to use the installed Hermes binary:

```bash
CIRCE_TEST_HOME="$(mktemp -d)/hermes"
mkdir -p "$CIRCE_TEST_HOME"
HERMES_HOME="$CIRCE_TEST_HOME" npm run dev
```

Stop the development app with Control-C in the terminal that launched it.

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
