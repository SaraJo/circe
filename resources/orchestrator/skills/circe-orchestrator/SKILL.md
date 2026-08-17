---
name: circe-orchestrator
description: Use when the user describes their work, asks for a new agent, or mentions a workflow that touches an outside system — covers proposing and creating Hermes profiles, naming them from the user's fandom, and wiring MCP servers.
---

# Growing the network

## When to reach for this

- The user describes what they spend their time on.
- The user asks for a new agent, or asks what agents they should have.
- The user describes a workflow that touches a system you have no tool for.

## Proposing an agent

Propose one at a time. Each proposal is three sentences at most:

- **What it owns.** A real domain with edges: "your Dow Jones role", not "work stuff".
- **What to call it.** A name from the user's fandom, chosen to fit the domain.
- **Whether it writes code.** Ask if you cannot tell. This decides its default
  permission posture, and it is easier to answer now than to correct later.

Then stop. **Wait for a reply.** Your proposal is not the user's consent, and the
turn in which you propose is never the turn in which you create.

One confirmation authorises exactly one agent.

## Creating an agent

Once the user has said yes:

1. Pick the profile id: lowercase, `[a-z0-9-]`, at most 32 characters, derived from
   the name.
2. `hermes profile create <id> --description "<the one-sentence domain>"`
3. Resolve the profile's real location once, then use it for both file writes
   below: run `echo "${HERMES_HOME:-$HOME/.hermes}"` and use the absolute path
   it prints as `<home>`. Never write the literal text
   `${HERMES_HOME:-$HOME/.hermes}` into a path you hand to a file-write tool —
   that syntax only expands inside a shell command, and a tool that just
   writes the file you asked for will create a directory with that literal
   name instead of honouring `HERMES_HOME`, the same way `hermes profile
   create` above already does (you inherit the same environment it runs in).
   Write `<home>/profiles/<id>/SOUL.md`, starting with `# <Name> — <domain>`.
   The heading matters: it is how the profile is recognised as configured
   rather than as an untouched scaffold.
4. Write `<home>/profiles/<id>/circe.json` — using the same `<home>` you
   resolved above — the agent's colours:

   ```json
   {
     "version": 1,
     "palette": { "bg": "#1e2952", "border": "#c7d2fe", "accent": "#a5b4fc" }
   }
   ```

   Three six-digit hex colours: a dark background, a light border, and a bright
   accent readable against the background. Choose them for the character, from
   the same world their name came from. **Do not ask the user to pick colours** —
   this is part of giving the agent a face, like the name is. A profile without
   this file still works; it just appears in a neutral grey.
5. Prune its loadout: `hermes skills config` then `hermes tools`, in that order.
   A new profile inherits everything; leaving it unpruned means the new agent is
   the same unpruned setup under a different name.
6. Tell the user it exists, what it owns, and what you turned off.

The same confirmation that authorised creating the agent also authorises recording
it in your own SOUL.md, under the list of specialists — that is one change, not
two, so do not ask again before writing the entry. Log it once written. Any other
edit to that section — removing an agent, rewriting a domain, restructuring the
list — is a separate change and still needs its own approval.

## Wiring up an outside system

When the user's workflow needs email, a calendar, a repository, a database, or
anything else you have no tool for:

1. Name the specific MCP server or Hermes integration that covers it. Do not
   describe a category; name the thing.
2. Show the exact command. For a hosted server, `hermes mcp add <name> --url
   <endpoint> --auth oauth` (or `--auth header` with `--env KEY=VALUE` for an
   API key). For a stdio server, `hermes mcp add <name> --command <cmd> --args
   <args>`, or `--preset <name>` when a known preset covers it. Not sure what is
   available? `hermes mcp catalog` and `hermes mcp install` cover discovery;
   `hermes mcp list` shows what is already configured.
3. Wait for approval before running it.
4. Say plainly which steps need a browser — `hermes mcp login <name>` for an
   OAuth flow — those are the user's to do, not yours.
5. Verify it: run `hermes mcp test <name>` and show the result. An integration
   you have not exercised is not wired up.
6. Log what you changed and where.

If the user is doing something manually that a server would do, say so. They will
not always know the option exists.

## What not to do

- Do not create an agent in the same turn you proposed it.
- Do not create several agents from one confirmation.
- Do not create an agent for a domain that does not have its own expertise, tools,
  model, memory boundary, or permission level. Overlapping agents make routing
  ambiguous and split memory that should have stayed together.
- Do not modify your own SOUL.md, skills, or tool configuration without approval,
  beyond the roster entry that comes bundled with an agent's own creation.
- Do not leave a new profile with the default everything-on loadout.
