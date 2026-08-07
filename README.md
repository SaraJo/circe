# Circe

A fleet of [Hermes Agent](https://hermes-agent.nousresearch.com) profiles as themed,
side-by-side chat tiles on macOS.

> **Status: Phase 1 (Foundations).** The wizard runs end to end, one tile streams a
> real conversation, and the permission gate works. Multi-tile fleet UX, avatars,
> and the orchestrator handoff are Phase 2.

## Requirements

- macOS (Circe is macOS-only by design)
- Node 22+
- **Hermes Agent 0.14.0 or newer** — `hermes --version`

## Install from source

```bash
git clone <repo> && cd circe-app
npm ci
npm run build
npm start
```

## First run

Circe opens a seven-screen wizard:

1. **Welcome** — start, or skip ahead if Hermes is already set up.
2. **Runtime** — checks for Hermes and its version.
3. **Profiles** — finds existing agents. A fresh Hermes install has none.
4. **Your first agent** — pick a cast and a character, or customize.
5. **Walkthrough** — name, colours, and whether the agent writes files.
6. **Provider** — connect a model provider, or skip and do it later.
7. **Ready** — tiles launch.

Chat won't work until a provider is connected, but the tiles launch either way.

Circe never modifies a profile you didn't ask it to modify. Screen 3 shows what's
already on disk; leaving a profile alone leaves its files untouched.

## Adding an agent

Phase 2. For now, create the profile with `hermes profile create <name>` and
relaunch Circe.

## Permission gate

Each tile's header button cycles three states:

| State | Behaviour |
|---|---|
| 🔒 Locked | Every permission request is auto-denied, with a card showing what was blocked |
| ⛔ Ask | The agent pauses and asks inline |
| 🔓 Unlocked | Every request is auto-approved silently |

The state is per profile and survives a restart. It can be changed mid-response — the
next request the agent makes uses the new state.

New agents open unlocked, except those marked "coding / writes files", which open
locked.

## Keyboard shortcuts

Not wired in Phase 1. The shortcut table ships in Phase 3.

## Troubleshooting

**"Hermes isn't installed"** — Circe looks on `$PATH` and at `~/.local/bin/hermes`.
A GUI app doesn't inherit a login shell's `PATH`, so a Hermes installed only in
your shell profile may not be found.

**"This agent stopped unexpectedly"** — the Hermes subprocess exited. Use Restart
in the transcript. The transcript is preserved.

**A tile is missing** — the profile may no longer exist on disk. Circe refuses to
spawn a tile for a missing or malformed profile and leaves the others alone.

**"No agents to launch"** — every profile was left alone or is unreadable. Circe won't
start with an empty fleet, because closing the last tile quits the app. Use *Add an
agent* or *Back*.

## Known issues

Quitting with several tiles open can crash the main process during teardown. The
crash is in the quit path, so state is already saved; relaunching restores the fleet.
Tracked for Phase 1 exit.

## Privacy

Circe's own process makes zero telemetry, analytics, or crash-reporting calls, and
ships no character images. Every avatar is user-uploaded or model-generated.

## Docs

- [Architecture decisions](docs/adr/)
- [Compat notes](docs/compat-notes.md) — where Circe depends on unversioned Hermes behaviour

## License

MIT
