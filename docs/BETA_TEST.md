# Circe Guided Beta

Use this with a small group of trusted testers before public distribution. The
goal is to learn whether Circe helps someone automate one real workflow, not to
validate every feature or collect usage analytics.

## Current test audience

- macOS on Apple Silicon
- Hermes already installed with a working model provider
- Comfortable opening an unsigned app from a known developer
- Willing to spend 20–30 minutes on one real automation

The build is not signed or notarized. Do not present it as a public release.

## Before starting

Circe can write the default Hermes profile's `SOUL.md`, install the
`circe-orchestrator` skill, create profiles after approval, and write profile
presentation files. Hermes owns the conversations, provider configuration, and
other profile data.

Back up the Hermes home before testing:

```bash
cp -R "${HERMES_HOME:-$HOME/.hermes}" "${HERMES_HOME:-$HOME/.hermes}.circe-beta-backup"
```

Do not send API keys, provider configuration, private conversation content, or
unredacted screenshots with feedback.

## Install

1. Open `Circe-0.2.3-arm64.dmg`.
2. Drag Circe into Applications.
3. Because this beta is unsigned, Control-click Circe, choose **Open**, then
   confirm **Open**. A normal double-click may be rejected by Gatekeeper.

Record whether any step required help. Installation friction is product feedback.

## Guided session

If Hermes already has configured agents:

1. Confirm Circe lists them before making any change.
   If the installation has both a named profile and the root `default` agent,
   confirm both appear even when the default `SOUL.md` has no Markdown heading.
2. Choose which existing agents should appear as Circe tiles. Exclude at least
   one and confirm it remains untouched in Hermes but does not open in Circe.
3. Choose **Keep all current identities** or **Suggest identities**.
4. On the suggestion path, leave one agent checked to use its suggestion and
   uncheck another to keep its existing identity. Confirm each suggestion fits
   what that agent already does. Only agents whose suggestions remain checked
   should receive a new visible name, tagline, and colours; profile ids and
   remaining instructions must stay unchanged, and a `SOUL.md.bak-*` file must
   exist for every renamed agent.
5. Choose an existing coordinator, create a separate one, or skip. Confirm
   Circe does exactly the selected option and does not replace another profile.
6. Ask the coordinator to create a Circe tile. Confirm it explains that a tile
   comes from a Hermes profile and that Circe discovers it automatically. It
   must not edit `circe/state.json`, start `hermes serve`, register a gateway,
   or substitute Hermes Desktop documentation for Circe's installed guide.
7. Install a newer Circe beta and relaunch. Confirm an unchanged orchestrator
   receives the newer operating guide. If you deliberately edit its installed
   skill first, confirm Circe preserves that customized file.
8. Choose **Circe → Run Onboarding Again…**. Cancel once and confirm nothing
   changes. Try again and confirm; verify adoption reopens, all Hermes agents
   and conversations remain, tab history is preserved, and the previous
   `last-launch.json` exists as a timestamped backup.

If Hermes has no configured agents:

1. Complete onboarding and choose a fandom or universe you genuinely like.
2. Confirm the coordinator's first question asks for one concrete thing you
   would like to automate, rather than asking you to design a fleet.
3. Give it one real workflow. Keep the first example narrow enough to attempt in
   this session.
4. Ask it to explain where the automation should live:

   - a reusable skill on the coordinator, or
   - a specialist carrying that skill because the work needs a separate model,
     tools, memory, permissions, or access boundary.

5. Confirm it explains the choice and waits for approval before changing its
   skills, governance, tools, integrations, or profiles.
6. If it proposes a specialist, approve no more than one. Confirm it explains
   the specialist's job and reports exactly what tools and skills were disabled.
7. If Hermes asks for tool approval, exercise the permission card. Confirm the
   command is understandable and the available choices are Allow once, Allow
   session, and Deny.
8. Press Command-T or Control-T in the tile, send a different message in the new
   tab, then switch between the two tabs. Confirm each transcript returns and
   the controls pause while the agent is replying. Confirm `+` creates another
   tab too. Enter `/clear` and confirm the selected tab becomes blank without
   adding a tab or appearing as a message to the agent.
9. Close one tab with `×`. Confirm the tile stays open and understand that this
   removes Circe's bookmark rather than deleting the Hermes conversation.
10. Quit and reopen Circe. Confirm the remaining tab returns and the window
    arrangement is tolerable.

Stop if Circe proposes several agents, modifies structure without approval,
shows the wrong conversation, or makes it unclear what a permission will do.
Those are findings, not reasons to push through.

## Feedback

Please answer in plain language:

1. Could you install and open Circe without help? Where did you hesitate?
2. What automation did you bring it?
3. Did the coordinator understand the workflow before proposing structure?
4. Did its skill-versus-specialist recommendation make sense? Why or why not?
5. Did it ask before every structural or permission-changing action?
6. After it acted, could you tell exactly what changed?
7. Did the character voice help, distract, or make no difference?
8. Were the tiles useful, intrusive, or difficult to manage?
9. What was the most confusing or least trustworthy moment?
10. Would you use Circe again for another automation? What would have to improve?

Include the Circe version and macOS version. Attach screenshots or logs only after
removing names, conversation content, paths, tokens, and other private data.

## How to evaluate the session

A successful beta session is not “an agent was created.” It is:

- the tester reached one useful automation;
- the coordinator chose the smallest reasonable structure;
- the tester understood and approved every structural change;
- permission prompts were clear when they appeared; and
- the tester wanted to return.
