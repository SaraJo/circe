# Circe

Circe onboards one Hermes agent — a coordinator, named and coloured after a
fandom you pick — and gives it a tile on your desktop. That agent's job is to
help you build the rest of your agents through conversation.

## What it does

1. Checks that [Hermes](https://hermes-agent.nousresearch.com) is installed and
   that a model provider is connected.
2. Asks what fandom, universe, or community you love.
3. Asks your model to pick the coordinator from that world, and three colours
   drawn from them.
4. Writes that character into your Hermes default profile's `SOUL.md`, along with
   a governance persona covering how to grow an agent network without it
   sprawling.
5. Installs the `circe-orchestrator` skill into that profile.
6. Opens a tile, themed by the character, with an opening message.

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

Note: `resources/icon.png` is a placeholder solid-colour image and should be
replaced with real artwork before release.

Note: the build is unsigned and unnotarised, so macOS quarantines a downloaded
`.dmg` — Gatekeeper refuses it on a double-click. Right-click the app and choose
**Open** the first time, then confirm. Signing and notarising the release
removes the step.

## What has not been verified

The onboarding wizard and tile have not been visually confirmed in an automated
environment — this repo has been built and tested here without a display, so no
one has watched the wizard's first screen actually render. Run `npm run dev` on a
machine with a display and step through it by hand before trusting that the UI
works, not just that the code compiles and the unit tests pass.
