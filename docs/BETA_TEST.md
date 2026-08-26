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

1. Open `Circe-0.1.0-arm64.dmg`.
2. Drag Circe into Applications.
3. Because this beta is unsigned, Control-click Circe, choose **Open**, then
   confirm **Open**. A normal double-click may be rejected by Gatekeeper.

Record whether any step required help. Installation friction is product feedback.

## Guided session

If Hermes already has configured agents:

1. Confirm Circe lists them before making any change.
2. Exercise either **Keep their current names** or **Give them Circe identities**.
3. On the identity path, uncheck at least one proposal. Confirm only checked
   agents receive a new visible name, tagline, and colours; their profile ids
   and remaining instructions must stay unchanged, and a `SOUL.md.bak-*` file
   must exist for every renamed agent.
4. Choose an existing coordinator, create a separate one, or skip. Confirm
   Circe does exactly the selected option and does not replace another profile.

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
8. Quit and reopen Circe. Confirm the useful conversation returns and the window
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
