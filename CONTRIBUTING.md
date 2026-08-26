# Contributing to Circe

Thanks for your interest. Circe is small and opinionated, and the fastest way
to land a change is to match the shape of what's already there.

## Ground rules

- Circe never reimplements what Hermes already does. If a change duplicates
  runtime install, provider auth, profile creation, or conversation plumbing,
  it belongs in Hermes, not here.
- Every user-facing decision (a fandom, a colour, a persona line) is written
  through the orchestrator, not hard-coded in the app.
- One tile per agent. The desktop is the UI; the app is the shell.

## Getting set up

```bash
git clone https://github.com/SaraJo/circe.git
cd circe
npm install
npm run dev
```

You need a working `hermes` binary on your PATH and at least one model provider
configured. See https://hermes-agent.nousresearch.com/docs.

## Before you open a PR

- `npm run typecheck`
- `npm test`
- `npm run lint` if the project has it wired up
- A short note in the PR about what a user would see change

## Design docs

Larger changes get a spec in `docs/superpowers/specs/` and a plan in
`docs/superpowers/plans/`, dated. Read a couple of the existing ones before
writing a new one — the format is load-bearing.

## Reporting issues

Please include:

- Your OS + Hermes version (`hermes --version`)
- What you expected vs. what happened
- The relevant tile's SOUL.md and skill file if the bug is about persona/behaviour

## Code of conduct

Be kind, be direct, assume good faith. Harassment or bad-faith engagement gets
you removed without a second warning.
