# Circe operating guide

Bundled guide version: 5. Circe refreshes an installed guide when it is still
byte-for-byte Circe-managed. If the user or agent edits the guide, Circe leaves
that copy alone.

Circe is a desktop interface over the user's local Hermes profiles. Each usable
Hermes profile is an agent; Circe presents that agent as a tile and talks to it
through Hermes ACP. Circe is not Hermes Desktop and does not use Hermes Desktop's
gateway registry.

## What Circe handles automatically

- On launch, Circe asks Hermes for the local profiles and opens one tile per
  usable profile.
- Circe watches the Hermes home for new named profiles. Once a new profile has a
  configured `SOUL.md`, its tile appears without a restart or registration step.
- A tile takes its visible name and tagline from the first H1 in `SOUL.md`.
- A tile takes its colours from the profile's `circe.json`; without that file it
  uses Circe's neutral palette.
- Circe stores and restores its own conversation-tab state. That state is not a
  registry of agents.
- During existing-fleet adoption, the user chooses which profiles receive Circe
  tiles. An excluded profile remains intact and usable through Hermes; Circe
  simply does not open it as a tile.

Do not start `hermes serve`, add a gateway, or edit `circe/state.json` to create
or reveal a tile. Those actions solve different problems and cannot register a
Circe agent.

## Tile lifecycle and vocabulary

- A **profile** is the durable Hermes agent on disk. A **tile** is Circe's
  window onto that profile. Closing a tile never deletes its profile, persona,
  memory, or Hermes conversations.
- Closing a tile keeps it closed for the rest of the current Circe run. Quitting
  and reopening Circe rediscovers the profile and opens its tile again.
- The profile id is a stable routing name. The H1 in `SOUL.md` is the visible
  character name and can change without changing the id.
- Circe asks Hermes to restore the last usable conversation. Its state file is a
  bookmark; Hermes remains the owner of the conversation itself.
- Each tile can hold several conversation tabs. The `+` button, Command-T, or
  Control-T adds a blank Hermes conversation; selecting a tab asks Hermes to
  replay that conversation. Entering `/clear` replaces the conversation inside
  the current tab, without adding a tab or sending `/clear` to the agent.
- The `×` on a tab removes only Circe's bookmark. It does not delete the Hermes
  conversation. Closing the last tab immediately creates a new blank one so the
  agent tile remains usable.
- Tab controls pause while the agent is answering or asking for approval. Finish
  the turn or answer the permission card before switching conversations.

## Profile file locations

Resolve the Hermes home once with:

```bash
echo "${HERMES_HOME:-$HOME/.hermes}"
```

Use the absolute result as `<home>` below.

| Profile | Persona | Theme | Avatar | Orchestrator skill |
| --- | --- | --- | --- | --- |
| `default` | `<home>/SOUL.md` | `<home>/circe.json` | `<home>/avatar.png` | `<home>/skills/circe-orchestrator/` |
| named `<id>` | `<home>/profiles/<id>/SOUL.md` | `<home>/profiles/<id>/circe.json` | `<home>/profiles/<id>/avatar.png` | `<home>/profiles/<id>/skills/circe-orchestrator/` |

The default profile is the Hermes home itself. Never invent a
`profiles/default/` directory.

Circe's own files are:

- `<home>/circe/last-launch.json`: records that onboarding/adoption finished,
  which profile should be foregrounded, and which existing profiles the user
  chose not to show as Circe tiles.
- `<home>/circe/state.json`: remembers tile conversation tabs and active-tab
  indexes. It does not determine which profiles get tiles.

Do not edit either file to add, rename, theme, or delete an agent. Do not edit
them to include or exclude a tile either; that choice belongs to onboarding.

## Existing-fleet adoption

Circe inventories existing Hermes agents without changing them, then keeps two
decisions separate for every agent:

- **Show in Circe** controls whether the profile receives a tile. Turning it off
  does not delete, disable, or edit the Hermes profile.
- **Use suggested identity** changes the visible H1 and palette after the user
  confirms it. Turning it off preserves the agent's existing name and persona.

Name suggestions are based on the chosen fandom and a bounded excerpt of the
agent's existing persona, so the proposed character should fit the work the
agent already does. The profile id never changes. At least one profile must be
shown in Circe, and only shown profiles can be selected as the coordinator.

To revisit these choices, use **Circe → Run Onboarding Again…** in the macOS
menu bar. After confirmation, Circe moves `last-launch.json` to a timestamped
backup and reopens adoption. Profiles, personas, Hermes conversations, and
Circe's tab history remain in place. Do not manually remove profile files to
restart onboarding.

## Create a tile

A request for a new Circe tile is a request for a new Hermes agent. Apply the
skill-versus-specialist decision and approval rules in the parent skill first.
After approval:

1. Create one cloned named profile with `hermes profile create` as documented in
   the parent skill.
2. Replace the cloned persona with a configured `SOUL.md` whose first H1 is
   `# <Name> — <domain>`.
3. Write its optional `circe.json` palette.
4. Finish the skill and tool pruning required by the parent skill.

Circe opens the tile automatically through its fleet watcher. Do not perform a
fifth "register tile" step. If Circe is not running, the tile appears the next
time it launches.

## Rename or recolour an existing tile

The profile id is stable and is not the tile's display name.

- To rename a tile, change only the first H1 in that profile's `SOUL.md`. Preserve
  the rest of the file and make a backup before writing.
- To recolour it, write a profile-local `circe.json`:

  ```json
  {
    "version": 1,
    "palette": {
      "bg": "#1e2952",
      "border": "#c7d2fe",
      "accent": "#a5b4fc"
    }
  }
  ```

  Each colour must be a six-digit hex value. Use a dark background, light
  border, and bright accent with readable contrast.

Renaming, recolouring, or changing another agent's instructions is a write and
requires the user's approval. Never rename the on-disk profile directory as a
shortcut for changing the visible name.

## Add or replace an avatar

An avatar is an optional PNG named `avatar.png` at the profile location shown
above. Circe falls back to initials when it is absent or unreadable. A manually
supplied image must be converted to PNG before writing; changing a filename to
`.png` does not convert its bytes. Reopen the tile after changing an avatar.

Circe-generated avatars may also have an `avatar.json` beside them recording
their source and licence. Keep that provenance with the image. A user-supplied
avatar does not need invented provenance.

Adding or replacing an avatar is a profile write: show the source and target,
obtain approval, and preserve the previous image with a backup when one exists.

## Safe changes and recovery

Before changing a profile, inspect the exact target files, explain the proposed
change, and wait for approval. A troubleshooting hypothesis is not permission
to edit a file.

- For a rename or instruction edit, back up `SOUL.md` first. Change only what
  was approved; a rename changes the first H1 and preserves the remaining body.
- To undo a rename or persona change, show the available `SOUL.md.bak-*` files
  and restore the user-selected one only after approval. Back up the current
  file before restoring so recovery itself remains reversible.
- To remove custom colours, move `circe.json` to a named backup after approval;
  Circe then uses its neutral palette. Do not replace it with guessed JSON.
- To recover a replaced avatar, restore its backup together with the matching
  `avatar.json` provenance when one exists.

Never edit `circe/state.json` as a speculative fix. If its restoration bookmark
is corrupt, Circe already falls back to an empty tile while the Hermes
conversation remains intact.

## Current product boundaries

Circe currently has no fleet dashboard, profile editor, profile-deletion UI,
gateway registry, or MCP configuration screen. Use Hermes for profile and MCP
operations as directed by the parent skill; Circe will reflect supported local
profile changes. Do not invent buttons, menus, APIs, or remote-gateway steps.

Deleting an agent is outside ordinary tile management and is destructive. If a
user asks, explain that the Hermes profile is the agent, identify the exact
profile and consequences, and obtain explicit confirmation before using Hermes's
profile-removal workflow. Closing a tile is the non-destructive alternative.

## Inspect and troubleshoot

Start with Hermes's own profile truth:

```bash
hermes profile list
hermes profile show <id>
```

Then verify the persona and theme at the locations above.

- Profile missing from `hermes profile list`: it is not a Circe discovery
  problem; fix or create the Hermes profile.
- Named profile listed but no tile: verify its real `SOUL.md` exists and has an
  H1. A half-created named profile is intentionally not tiled.
- Default profile missing: verify `hermes profile show default` and
  `<home>/SOUL.md`; do not look under `profiles/default/`.
- Neutral-grey tile: the profile's `circe.json` is absent or invalid.
- Initials instead of a face: verify `avatar.png` is a readable PNG at the
  profile location above, then reopen the tile.
- Tile does not immediately reflect a root/default-file edit: quit and reopen
  Circe; the default profile's files are outside the named-profile watch path.

If these checks contradict the running app, report the exact profile list,
resolved paths, and observed Circe behavior. Do not substitute instructions for
Hermes Desktop gateways or guess at undocumented Circe state fields.
