# Onboarding and agent behavior

[← Back to the README](../README.md)

## Setting up your crew

1. Checks that [Hermes](https://hermes-agent.nousresearch.com) is installed and
   that a model provider is connected.
2. Detects whether this is a new setup or an existing fleet that has not yet
   made its Circe choices.
3. Existing users choose agents individually for Circe tiles, then accept or
   reject each fandom-based name and colour suggestion independently. Excluded
   agents stay untouched in Hermes, and profile ids never change. Accepted names
   update the agent's Hermes persona and explicit self-introduction. Shown agents
   receive a shared roster of current names and old-name aliases so they can
   refer to each other consistently.
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

During onboarding, Circe asks Hermes to generate a retro RPG pixel-art portrait
with crossed arms, warm directional lighting, and a rust-to-burgundy background.
Hermes inspects a character image from Wikipedia or Fandom when available and
uses its visual details in the generation prompt; otherwise it uses the character
name, universe, and description. This requires working image generation in Hermes.
The result is cropped and sized to 1024×1536 and saved with its reference URLs and
generated treatment recorded beside it. Generated-image licensing is recorded as
unknown. If generation fails, Circe falls back to the sourced 32×32 avatar or
initials. Existing saved avatars are preserved.

Circe versions its own installed orchestrator resources. On launch it updates
copies that still match what Circe previously installed and leaves customized
copies untouched.

To revisit fleet selection, fandom identities, or coordinator choice, choose
**Circe → Run Onboarding Again…** from the macOS menu bar. Circe backs up its
onboarding record and preserves agents, personas, conversations, and tab history.

When Hermes requests approval for a tool action, Circe shows the command in the
tile and offers allow-once, allow-for-session, or deny. Circe never chooses a
permanent approval option.

Use the **＋** beside a tile's message field to attach one PNG, JPEG, WebP, or
GIF image up to 5 MB. Review the preview, add an optional message, and select
**Send**. Images require a Hermes agent and model that support image input.
Image previews in reopened conversations depend on what Hermes returns during
history replay; some Hermes versions replay only the text.

Circe never wires up an MCP server itself. That is a conversation you have with
your orchestrator, which is what the skill teaches it to do.

## What it does not do

It does not reimplement anything Hermes already does. Installing the runtime,
authenticating providers, creating profiles, and running conversations all go
through the `hermes` binary.

