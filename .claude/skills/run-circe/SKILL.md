---
name: run-circe
description: Use when running, launching, screenshotting, or clicking through the Circe Desktop app — onboarding wizard, character derivation, the orchestrator tile, or confirming an agent reply actually renders. Also use before any change to persona writing, since onboarding overwrites the operator's real ~/.hermes/SOUL.md unless sandboxed.
---

# Running Circe Desktop

Circe is an Electron app: an onboarding wizard that derives a character from a
fandom, writes that persona to a Hermes profile, then opens a tile that talks to
a live `hermes acp` agent.

**Read the safety section before you launch it.** Onboarding writes the `default`
profile, and `soulPath()` maps `default` to `~/.hermes/SOUL.md` — the operator's
real coordinator persona.

## Safety: never onboard against the real Hermes home

`src/main/hermes/runtime.ts` reads `HERMES_HOME` and `CIRCE_HERMES_BIN` from the
environment, and both `real.ts` and `acp.ts` spawn with `...process.env`, so
setting `HERMES_HOME` redirects Circe *and* the `hermes` CLI it shells out to.

`driver.mjs` sets it to a sandbox automatically and copies only `auth.json`,
`.env`, and `config.yaml` across, so derivation and ACP use real credentials
while the real `SOUL.md` and `profiles/` stay untouched.

Confirm the redirect took before trusting a run — the sandbox should list only
`default`, the real home lists every profile:

```bash
HERMES_HOME=/tmp/circe-hermes-home ~/.local/bin/hermes profile list
```

Verify the real persona is unchanged afterwards: `ls -l ~/.hermes/SOUL.md`.

## Prerequisites

```bash
npm install
npm run build          # driver launches out/, not the dev server
npm i --no-save playwright-core
```

## Run

The driver reads commands from stdin. There is no tmux on the target machine, so
wrap it with a fifo:

```bash
mkfifo /tmp/circe.fifo
( while true; do sleep 3600; done > /tmp/circe.fifo ) &   # holds the fifo open
node .claude/skills/run-circe/driver.mjs < /tmp/circe.fifo > /tmp/circe.log 2>&1 &

echo 'launch' > /tmp/circe.fifo
sleep 8 && cat /tmp/circe.log
```

Without the holder process the fifo hits EOF and readline closes the driver.

Screenshots land in `/tmp/circe-shots/` (`SCREENSHOT_DIR` to override).
**Open them.** A blank frame means the launch failed.

### Commands

| command | what it does |
|---|---|
| `launch` | launch app, print sandbox path and window URLs |
| `use <substr>` | re-point at another window (`use tile` after accept) |
| `windows` | list window URLs |
| `ss [name]` | screenshot |
| `probe` | list every interactive element — fastest way to see which step you're on |
| `text [sel]` | innerText of the page or a selector |
| `click <sel>` / `click-text <text>` | click via DOM |
| `fill <sel> <value>` | set an input through the native setter |
| `focus <sel>` / `type <text>` / `press <key>` | keyboard input |
| `wait <sel>` / `eval <js>` | wait for element / evaluate |
| `quit` | close app and exit |

## A full walkthrough

```
launch
fill input#fandom Terry Pratchett's Discworld
click-text Continue
                          # derivation is a real model call — 20-60s
probe                     # poll until buttons appear
click-text Start with     # or "Replace it" on the claim-default screen
use tile
focus textarea#input
type Hello — what will you do for me?
press Enter
text                      # the agent's reply should appear within ~10s
```

Which screen you get after `Continue` depends on the sandbox's `SOUL.md`:

- **absent, or stock Hermes boilerplate** → straight to the character screen.
  `isRealSoul()` treats boilerplate as not worth preserving, so no backup.
- **a real persona** (including one Circe wrote on an earlier run) → the
  `claim-default` confirm screen, and accepting writes `SOUL.md.bak-<ts>`.

Delete the sandbox between runs to get the first-run path back.

## Gotchas

- **No tmux, no playwright on the machine.** Hence the fifo, and
  `npm i --no-save playwright-core`.
- **The wizard window closes when the tile opens.** Any command after accept
  fails with "Target page, context or browser has been closed" until you run
  `use tile`.
- **Derivation is a real model call.** Expect 20-60s and poll `probe`; don't
  treat one empty result as a hang.
- **`hermes` writes into `HERMES_HOME` on first use**, creating a stock
  `SOUL.md` before Circe ever runs. A fresh sandbox is therefore *not* the
  no-persona case.
- **macOS keeps the app alive with no windows.** `window-all-closed` doesn't
  quit on darwin, so closing the tile leaves the process up; use `quit`.
- **Cold start opens whatever is already on disk.** `boot()` reads the
  sandbox's `SOUL.md`: a real persona opens the tile directly, no wizard. To
  get the onboarding path you need a home whose `SOUL.md` is absent or still
  the stock Hermes boilerplate — delete the sandbox between runs. A tile on
  launch is correct behaviour, not a skipped step.
- **The tile opens on the primary display, and nothing raises it.** On a
  multi-monitor setup it can land on a screen you aren't looking at, behind
  whatever you had open, with no chrome to catch the eye. Before concluding a
  launch failed, ask the page where it is:
  `eval ({sx: window.screenX, sy: window.screenY})`.

## Troubleshooting

- **Launch timeout** — `npm run build` first; the driver runs `out/`, not `src/`.
- **`ERROR: page.evaluate ... closed`** — you're pointed at the closed wizard;
  `use tile`.
- **Derivation fails immediately** — the sandbox is missing credentials. Check
  `auth.json`/`.env` copied, and `HERMES_HOME=<sandbox> hermes status`.
