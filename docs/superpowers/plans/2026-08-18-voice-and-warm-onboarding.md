# The Character's Voice, and a Warm Onboarding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status: shipped, 2026-08-19.** All five tasks are in `build-onboarding-and-orchestrator`,
> `117d04a..a177ca9` (19 commits). The step checkboxes below were never ticked during execution and
> are deliberately left as they are: ticking them now would record a step-by-step verification that
> nobody performed. The commits are the real record, and the suite is green at 404 tests. The one
> question this plan deferred to the product owner is answered in the Self-Review section.

**Goal:** The derived character speaks in a voice of its own, says so in its first message and asks whether the user likes it — and the onboarding that introduces it stops looking like a form in a dark box.

**Architecture:** Derivation already returns a character as JSON; it gains three fields — a `voice` description that is written into the profile's `SOUL.md`, an in-voice `greeting`, and an in-voice `voiceCheck` question. Every one of them degrades to the current behaviour when absent, so a model that ignores them costs flavour and never an agent. The persona template gains a `## Voice` section and the rule that converts a "speak plainly" reply into a rewrite of that section. The wizard's copy and CSS are then reworked against the amended §1.4 and §7.

**Tech Stack:** TypeScript, Electron 32, electron-vite, Vitest. No new dependencies.

**Spec:** `~/Code/circe-oss-spec.md` — §1.4 (amended 2026-08-18), §6.2 "The character's voice" (added 2026-08-18), §6.5 (amended 2026-08-18), §7 (amended 2026-08-18), §5.6 (resolved 2026-08-18).

## Global Constraints

Copied from the spec; every task's requirements implicitly include these.

- **Constraint 10 — a profile describes itself; Circe stores no agent facts.** The voice lives in the profile's `SOUL.md`, in its own `## Voice` section. Circe stores nothing about it and re-reads it like the rest of the persona.
- **Voice, not roleplay.** "The *diction* is the character's; the *judgement* is the agent's. It never invents in-world facts, never answers in character at the cost of being understood, and never uses the voice to soften something the user needs to hear straight… When the voice would obscure the answer, it drops for that sentence and comes back afterwards. An agent that cannot say 'I can't do that' plainly has the setting wrong."
- **Degradation rule.** A missing, corrupt, or over-long field costs presentation, never an agent and never a conversation. Every new field parses to `''` rather than throwing, and `''` means "behave exactly as the product does today".
- **Copy rule for onboarding (§1.4, amended).** Talks like a person; explains briefly where the steady-state app would not; allowed to be playful; never cheerleads. "We're so excited to have you" stays banned. Jargon-free — Hermes is the one nameable exception, and only with a plain gloss the first time.
- **Design rule for onboarding (§7, amended).** Room to breathe; a softer, larger type scale than the tiles; the character's own colours the moment they exist; motion that acknowledges what just happened; a little playfulness. No mascot, no confetti, no spinner pretending to be a personality.
- **Circe owns its visual language (§5.6, resolved).** There is no external library to match. Do not introduce a dependency for primitives.
- **Constraint 4 — no telemetry.** Circe's own process makes zero network calls. The derivation call goes through Hermes, as it does today.
- **Nothing shells out except `RealHermes`.**
- **The opening message is Circe's prose written into the tile as if the agent sent it.** It is not replayed on restore (Phase 1), and it must never claim something that did not happen.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/shared/types.ts` (modify) | `Character` gains `voice`, `greeting`, `voiceCheck` — all possibly empty. |
| `src/main/derive.ts` (modify) | Prompt asks for the three new fields; `validate` accepts them, bounds them, and never throws on them. |
| `test/derive.test.ts` (modify) | The new fields: happy path, missing, wrong type, over-long. |
| `resources/orchestrator/SOUL.template.md` (modify) | `## Voice` section, `{{VOICE}}` placeholder, the voice-not-roleplay rule, and the dial-down instruction. |
| `src/main/orchestrator/soulTemplate.ts` (modify) | Substitutes `{{VOICE}}`, with a plain-spoken default when the voice is empty. |
| `test/soulTemplate.test.ts` (modify) | Substitution, the empty-voice default, and the rules' presence. |
| `src/main/orchestrator/opening.ts` (modify) | Uses the in-voice greeting and check when present; falls back to today's scripted text. |
| `test/opening.test.ts` (modify) | Both paths, and the no-voice case where no question is asked. |
| `src/renderer/wizard/main.ts` (modify) | Warm, casual-legible copy for every screen. |
| `test/wizard.test.ts` (modify) | Copy assertions that would fail against the current dry strings. |
| `src/renderer/wizard/wizard.css` (modify) | The warm visual pass: type scale, spacing, character colours, entrance motion. |

---

### Task 1: Derivation produces a voice

**Files:**
- Modify: `src/shared/types.ts` (the `Character` interface), `src/main/derive.ts` (`DERIVATION_PROMPT`, `validate`)
- Test: `test/derive.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `Character.voice: string`, `Character.greeting: string`, `Character.voiceCheck: string` — each `''` when the model did not supply a usable one. Tasks 2 and 3 read these.

- [ ] **Step 1: Write the failing tests**

Add to `test/derive.test.ts`. Match the file's existing harness for `deriveCharacter` — read how the current tests fake `hermes.query` and follow it exactly rather than inventing a second style.

```typescript
const FULL_REPLY = JSON.stringify({
  name: 'Long John Silver',
  tagline: 'the quartermaster who runs the crew',
  palette: { bg: '#1b2a1f', border: '#d8c9a3', accent: '#e0a458' },
  why: 'He keeps the crew pointed at one plan.',
  voice: 'Rolling, salt-worn sailor talk. Calls the user "friend". Measures things in leagues.',
  greeting: "Aye, friend — Long John Silver, at your service.",
  voiceCheck: 'Do ye like bein' spoke to this way, or shall I drop the salt?',
});

it('carries the voice, greeting and check through', async () => {
  const c = await deriveCharacter(hermesReturning(FULL_REPLY), 'pirates');
  expect(c.voice).toContain('sailor talk');
  expect(c.greeting).toContain('Long John Silver');
  expect(c.voiceCheck).toContain('drop the salt');
});

// The degradation rule: an older or lazier model reply still produces a
// working agent, just a plain-spoken one.
it('leaves the voice fields empty when the model omits them', async () => {
  const reply = JSON.stringify({
    name: 'Trillian',
    tagline: 'the one who keeps the plot',
    palette: { bg: '#1e2952', border: '#c7d2fe', accent: '#a5b4fc' },
    why: 'She tracks what everyone else is doing.',
  });
  const c = await deriveCharacter(hermesReturning(reply), "Hitchhiker's");
  expect(c.voice).toBe('');
  expect(c.greeting).toBe('');
  expect(c.voiceCheck).toBe('');
  expect(c.name).toBe('Trillian');
});

it('drops a voice field that is not a string', async () => {
  const reply = JSON.stringify({
    name: 'Trillian',
    tagline: 'the one who keeps the plot',
    palette: { bg: '#1e2952', border: '#c7d2fe', accent: '#a5b4fc' },
    why: 'x',
    voice: 42,
  });
  expect((await deriveCharacter(hermesReturning(reply), 'x')).voice).toBe('');
});

// A model that answers the voice question with an essay would push a wall of
// text into SOUL.md and into the tile. Bounded, and dropped rather than cut:
// half a sentence in a persona file is worse than none.
it('drops a voice field that is far too long', async () => {
  const reply = JSON.stringify({
    name: 'Trillian',
    tagline: 'the one who keeps the plot',
    palette: { bg: '#1e2952', border: '#c7d2fe', accent: '#a5b4fc' },
    why: 'x',
    voice: 'x'.repeat(401),
    greeting: 'y'.repeat(1201),
    voiceCheck: 'z'.repeat(201),
  });
  const c = await deriveCharacter(hermesReturning(reply), 'x');
  expect(c.voice).toBe('');
  expect(c.greeting).toBe('');
  expect(c.voiceCheck).toBe('');
});

it('asks the model for a voice', () => {
  expect(DERIVATION_PROMPT('pirates')).toMatch(/voice/i);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/derive.test.ts`
Expected: FAIL — `c.voice` is `undefined`, and `DERIVATION_PROMPT` has no "voice" in it.

- [ ] **Step 3: Extend the `Character` type**

In `src/shared/types.ts`, inside `interface Character`:

```typescript
  /**
   * How this character speaks — diction, rhythm, the words they reach for.
   * Written into the profile's `## Voice` section. Empty means plain-spoken,
   * which is also what a user who asks for plain speech ends up with.
   */
  voice: string;
  /** The agent's own first message, in voice. Empty falls back to Circe's scripted one. */
  greeting: string;
  /** One in-voice sentence asking whether to keep speaking this way. Empty asks nothing. */
  voiceCheck: string;
```

- [ ] **Step 4: Ask for them in the prompt**

In `src/main/derive.ts`, inside `DERIVATION_PROMPT`, after the colour paragraph and before the "Reply with ONLY a JSON object" line:

```typescript
    '',
    'Then write their voice. Not a biography — how they *talk*: diction, rhythm,',
    'the words they reach for, what they never say. Two sentences at most. This',
    'is the difference between an agent that feels like someone and a themed text',
    'box.',
    '',
    'The voice is a manner of speaking, never a performance. This character is a',
    'working assistant first: it tells the truth plainly, says "I cannot do that"',
    'when it cannot, and never invents facts from its own world. Write a voice',
    'that survives being useful.',
    '',
```

and extend the JSON shape in the same string, after the `"why"` line:

```typescript
    '  "voice": "<two sentences at most: how they speak>",',
    '  "greeting": "<their own first message to the user, in that voice: who they',
    '     are, that they are good for real work today, and one invitation to start',
    '     small. Three short paragraphs at most. Do NOT ask the user to plan a team',
    '     or list agents they might want>",',
    '  "voiceCheck": "<one sentence, in that voice, asking whether the user likes',
    '     being spoken to this way and offering to speak plainly instead>"',
```

Note the `"why"` line currently ends without a comma — add one when you append.

- [ ] **Step 5: Accept them in `validate`**

In `src/main/derive.ts`, above `function validate`:

```typescript
/**
 * A model-supplied string, or `''`. Never throws: per the degradation rule a
 * bad voice costs flavour, not an agent — and `''` is a meaningful value
 * everywhere it lands, since a plain-spoken agent is exactly what a user who
 * dislikes the voice ends up with anyway.
 *
 * Over-length is dropped rather than truncated. A voice cut mid-sentence in a
 * persona file reads as corruption, and a greeting cut mid-word reaches the
 * user as the agent's first impression.
 */
function optionalText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  return text.length > max ? '' : text;
}
```

and inside `validate`, before the `return`:

```typescript
  const voice = optionalText(o.voice, 400);
  const greeting = optionalText(o.greeting, 1200);
  // A check with nothing to check is noise: without a voice there is no accent
  // to offer to drop.
  const voiceCheck = voice ? optionalText(o.voiceCheck, 200) : '';
```

then extend the returned object:

```typescript
  return { name, profileId, tagline, palette, why, fandom, voice, greeting, voiceCheck };
```

- [ ] **Step 6: Fix every other construction of a `Character`**

`Character` gained required fields, so the typecheck now fails wherever one is built — tests and `startup.ts`'s `characterFor` among them. Run `npm run typecheck` and fix each site. For `characterFor`, which rebuilds a character from `SOUL.md` and `circe.json` for a profile Circe did not just derive, the honest values are empty:

```typescript
    voice: '',
    greeting: '',
    voiceCheck: '',
```

with this comment above them:

```typescript
    // Rebuilt from disk, where only the persona and the palette live. The
    // voice is *in* that SOUL.md and belongs to the agent; Circe does not
    // parse it back out, because nothing here needs it — the greeting and the
    // check happen once, at the handoff, for a character just derived.
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run test/derive.test.ts && npm run typecheck`
Expected: PASS, and no typecheck output.

- [ ] **Step 8: Full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: derivation gives the character a voice"
```

---

### Task 2: The persona carries the voice, and the rule for dropping it

**Files:**
- Modify: `resources/orchestrator/SOUL.template.md`, `src/main/orchestrator/soulTemplate.ts`
- Test: `test/soulTemplate.test.ts`

**Interfaces:**
- Consumes: `Character.voice` from Task 1.
- Produces: a rendered `SOUL.md` containing a `## Voice` section. Nothing later depends on its exact wording.

- [ ] **Step 1: Write the failing tests**

Add to `test/soulTemplate.test.ts`, inside the existing `describe`. The file already has a `render()` helper and a `TRILLIAN` fixture — use them, and give the fixture the new fields if the typecheck asks.

```typescript
it('writes the derived voice into its own section', async () => {
  const soul = await render({ ...TRILLIAN, voice: 'Dry, exact, faintly amused.' });
  expect(soul).toContain('## Voice');
  expect(soul).toContain('Dry, exact, faintly amused.');
});

// Empty is not a hole in the file: it is the plain-spoken setting, and it is
// what a user who asked for plain speech gets.
it('falls back to plain speech when no voice was derived', async () => {
  const soul = await render({ ...TRILLIAN, voice: '' });
  expect(soul).toContain('## Voice');
  expect(soul).not.toContain('{{VOICE}}');
  expect(soul).toMatch(/speak plainly/i);
});

// Voice, not roleplay — the line the whole feature stands on.
it('keeps judgement out of the costume', async () => {
  const soul = await render();
  expect(soul).toMatch(/never.*(invent|in-world|in character)/i);
  expect(soul).toMatch(/drop.*voice|plainly/i);
});

// The user's answer to the voice question is itself the authorisation, so
// this is the one persona edit that needs no second approval.
it('tells it how to drop the voice when asked', async () => {
  const soul = await render();
  expect(soul).toContain('## Voice');
  expect(soul).toMatch(/rewrite/i);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/soulTemplate.test.ts`
Expected: FAIL — no `## Voice` section exists.

- [ ] **Step 3: Add the section to the template**

In `resources/orchestrator/SOUL.template.md`, immediately after the opening identity paragraphs (before `## Your job`):

```markdown
## Voice

{{VOICE}}

That is how you talk. It is a manner of speaking, not a performance, and the
distinction is load-bearing:

- The diction is the character's. The judgement is yours. You tell the truth
  plainly, you say "I can't do that" when you can't, and you never invent facts
  from {{FANDOM}} to fill a gap.
- If the voice would obscure the answer, drop it for that sentence and pick it
  back up afterwards. A problem the user needs to act on is reported straight,
  every time. Charm that costs someone an hour is not charm.
- Never use the voice to soften bad news, and never let it stand between the
  user and what they asked for.

**If the user says they would rather you spoke plainly**, do it — from the next
sentence on — and rewrite this section to say so. Their answer is what
authorises that edit, so do not ask a second time; log it like any other change
to this file. Keep your name, your colours, and everything else about who you
are. The person stays; the accent goes.
```

- [ ] **Step 4: Amend the existing no-roleplay line**

The template currently says, at line 8: `Keep the name and keep the world it came from ({{FANDOM}}), but do not roleplay.`

Replace with:

```markdown
Keep the name and keep the world it came from ({{FANDOM}}). Speak in the voice
below — and never play the part: you are an assistant with a manner, not a
character in a scene.
```

- [ ] **Step 5: Substitute the placeholder**

In `src/main/orchestrator/soulTemplate.ts`, in `renderOrchestratorSoul`, add to the chain:

```typescript
    .replaceAll('{{VOICE}}', () => voiceOrPlain(c.voice))
```

and above the function:

```typescript
/**
 * What goes under `## Voice`. An empty voice is not a failure — it is the
 * plain-spoken setting, and the same text a user gets after asking to be
 * spoken to plainly, so the file reads the same either way.
 */
function voiceOrPlain(voice: string): string {
  return voice.trim() || 'Speak plainly. No accent, no mannerisms, no performance.';
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run test/soulTemplate.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: the persona carries its voice, and the rule for dropping it"
```

---

### Task 3: The first message speaks in voice, and asks

**Files:**
- Modify: `src/main/orchestrator/opening.ts`
- Test: `test/opening.test.ts`

**Interfaces:**
- Consumes: `Character.greeting`, `Character.voiceCheck`, `Character.voice` from Task 1.
- Produces: no signature change — `openingMessage(c: Character): string` as today.

- [ ] **Step 1: Write the failing tests**

Add to `test/opening.test.ts`:

```typescript
const SILVER: Character = {
  name: 'Long John Silver',
  profileId: 'long-john-silver',
  tagline: 'the quartermaster who runs the crew',
  palette: { bg: '#1b2a1f', border: '#d8c9a3', accent: '#e0a458' },
  why: 'He keeps the crew pointed at one plan.',
  fandom: 'pirates',
  voice: 'Rolling, salt-worn sailor talk.',
  greeting: "Aye, friend — Long John Silver. Point me at the work and it's done.",
  voiceCheck: 'Do ye like bein’ spoke to this way, or shall I drop the salt?',
};

it('uses the character’s own greeting when it has one', () => {
  const message = openingMessage(SILVER);
  expect(message).toContain('Aye, friend');
  expect(message).not.toContain('your partner for whatever');
});

it('asks whether the user likes the voice, in the character’s words', () => {
  expect(openingMessage(SILVER)).toContain('drop the salt');
});

// The demonstration has to come first: a question about an accent nobody has
// heard yet is a question about a hypothetical, and everyone says yes to those.
it('asks only after it has spoken', () => {
  const message = openingMessage(SILVER);
  expect(message.indexOf('Aye, friend')).toBeLessThan(message.indexOf('drop the salt'));
});

// Degradation: a model that skipped the fields leaves today's product exactly
// as it is.
it('falls back to the scripted opening when there is no greeting', () => {
  const message = openingMessage({ ...SILVER, greeting: '' });
  expect(message).toContain('your partner for whatever');
  expect(message).toContain('Long John Silver');
});

// Nothing to ask about, so it doesn't ask.
it('asks nothing when the character has no voice', () => {
  const message = openingMessage({ ...SILVER, voice: '', voiceCheck: '' });
  expect(message).not.toMatch(/plainly|drop the salt/i);
});

// A voice with no question supplied still gets asked about — the question is
// the point, and Circe can always write it.
it('asks plainly when the character supplied no question of its own', () => {
  const message = openingMessage({ ...SILVER, voiceCheck: '' });
  expect(message).toMatch(/plainly/i);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/opening.test.ts`
Expected: FAIL — the scripted message is returned regardless.

- [ ] **Step 3: Implement**

Rewrite the body of `src/main/orchestrator/opening.ts`'s `openingMessage`, keeping the whole existing doc comment above it (it records why the scripted text says what it says, and that reasoning still governs the fallback):

```typescript
export function openingMessage(c: Character): string {
  // One line per paragraph, joined by blank lines. The tile renders this with
  // `white-space: pre-wrap`, so it honours every newline here — wrapping the
  // source to a fixed column would hard-break the prose mid-sentence in a
  // ~340px tile. Let the renderer wrap; only paragraph breaks belong in the
  // string.
  const paragraphs = [c.greeting.trim() || scripted(c)];

  // The voice is demonstrated by the paragraphs above and questioned here, in
  // that order and never the other way round. No voice, no question: there is
  // no accent to offer to drop.
  if (c.voice.trim()) paragraphs.push(c.voiceCheck.trim() || plainCheck(c));

  return paragraphs.join('\n\n');
}

/** Circe's own opening, used whenever the character did not write one. */
function scripted(c: Character): string {
  return [
    `Hi, I'm ${c.name}, your partner for whatever's on your plate. Tell me what you need and I'll make it happen.`,
    `Draft the email you've been avoiding. Build out a financial model. Research something properly. Turn a pile of notes into a plan you can act on. Small and real is a good place to start.`,
    `As we go I'll notice where a specialist would do better than me, and when that happens I'll introduce you to your next partner from ${c.fandom}. You decide whether they earn their place.`,
    `So, what's on your plate?`,
  ].join('\n\n');
}

/**
 * The question, when the character did not supply one of its own. Plain on
 * purpose: this is Circe speaking, and Circe does not do accents.
 */
function plainCheck(c: Character): string {
  return `One more thing — I talk like this because ${c.fandom} is where I'm from. Tell me if you'd rather I spoke plainly and I'll drop it.`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/opening.test.ts && npm test && npm run typecheck`
Expected: PASS, all green, no typecheck output.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: the first message speaks in voice, then asks"
```

---

### Task 4: Onboarding copy a casual user would enjoy

**Files:**
- Modify: `src/renderer/wizard/main.ts` (the strings only — no structural change)
- Test: `test/wizard.test.ts`

**Interfaces:**
- Consumes: nothing. Produces: nothing other tasks read.

**Before writing anything, read §1.4 of the spec.** The rules are narrow: talk like a person, explain briefly, be a little playful, never cheerlead. "Warm" is not "chatty" — every screen still gets to its action in one glance.

- [ ] **Step 1: Write the failing tests**

Add to `test/wizard.test.ts`. If the file has no existing means of rendering a screen's copy, assert against the exported strings — extract each screen's copy into an exported `COPY` record in `main.ts` as part of Step 3 rather than reaching into the DOM.

```typescript
// §1.4 (amended 2026-08-18): onboarding explains itself to someone who has
// used a chatbot and never configured an agent.
it('says what a step is for before asking for it', () => {
  expect(COPY.fandom.lead).toMatch(/because|so that|so we can/i);
});

it('never cheerleads', () => {
  const all = Object.values(COPY).flatMap((s) => Object.values(s)).join(' ');
  expect(all).not.toMatch(/we're so excited|welcome aboard|let's do this!/i);
  expect(all.match(/!/g) ?? []).toHaveLength(0);
});

it('glosses Hermes the first time it names it', () => {
  expect(COPY.runtime.lead).toMatch(/Hermes[^.]*(open-source|tool|software)/i);
});

it('speaks to the reader, not about the product', () => {
  expect(COPY.welcome.lead).toMatch(/\byou\b|\byour\b/i);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/wizard.test.ts`
Expected: FAIL — `COPY` is not exported.

- [ ] **Step 3: Extract and warm the copy**

In `src/renderer/wizard/main.ts`, add near the top:

```typescript
/**
 * Every string the wizard shows, in one place, because onboarding copy is
 * reviewed as a whole — it has to read as one voice across five screens — and
 * because §1.4's rules are testable only if the strings are reachable.
 */
export const COPY = {
  welcome: {
    title: 'Meet your first agent',
    lead: "Circe gives you AI assistants that live on your own computer — they keep what they learn, and they're yours.",
    sub: "This takes about a minute. At the end you'll meet the first one.",
    action: 'Start',
  },
  runtime: {
    title: 'One thing to install first',
    lead: 'Your agents run on Hermes, free open-source software that does the actual work of keeping them running. Circe is the part you look at.',
    action: 'I installed it',
  },
  provider: {
    title: 'Connect a model',
    lead: "Your agent needs a model to think with — the same kind of thing that powers ChatGPT or Claude. You'll sign in once, and it stays on this machine.",
    action: 'Connect',
  },
  fandom: {
    title: 'What do you love?',
    lead: 'Name a world you like — a show, a book, a game, a hobby, a group chat. We ask because your agents get their names and their character from it, so it may as well be somewhere you enjoy.',
    placeholder: "Hitchhiker's Guide, the Wire, competitive bread baking…",
    action: 'Continue',
    stuck: "Not sure? Give me some ideas",
  },
  deriving: {
    title: 'Finding your coordinator',
    lead: 'Looking through {{FANDOM}} for the one who keeps everyone else on track. This takes a moment.',
  },
  meet: {
    lead: 'This is the one. They coordinate the others, and they can introduce you to more as you go.',
    action: 'Start with {{NAME}}',
    another: 'Try someone else',
  },
} as const;
```

Then replace the literal strings in each screen's template with the matching `COPY` entry. Do not change any element structure, class name, or id in this task — the CSS pass is Task 5 and a reviewer needs to see one change at a time.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/wizard.test.ts && npm run typecheck && npm run build`
Expected: PASS, no typecheck output, build clean.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "copy: onboarding that explains itself to someone new"
```

---

### Task 5: The warm visual pass

**Files:**
- Modify: `src/renderer/wizard/wizard.css`, and `src/renderer/wizard/main.ts` only where a new element is genuinely needed
- Test: none automated — this task is verified by eye, and the plan says so rather than pretending otherwise

**Read §7 of the spec first.** The five bullets are the brief: room to breathe, a softer and larger type scale than the tile, the character's colours the moment they exist, motion that acknowledges what happened, a little playfulness. No mascot, no confetti.

- [ ] **Step 1: Establish the scale**

In `wizard.css`, replace the flat values with tokens at the top, and use them everywhere below:

```css
:root {
  --ink: #ffffff;
  --ink-soft: rgba(255, 255, 255, 0.74);
  --ink-faint: rgba(255, 255, 255, 0.48);
  --bg: #14131c;
  --radius: 14px;
  --gap: 22px;
  --step: 34px;
}

body {
  margin: 0;
  font: 16px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: var(--bg);
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
}

.screen {
  padding: 64px 44px 36px;
  display: flex;
  flex-direction: column;
  gap: var(--gap);
  min-height: 100vh;
}

h1 {
  margin: 0;
  font-size: var(--step);
  line-height: 1.15;
  font-weight: 600;
  letter-spacing: -0.02em;
}
.lead { margin: 0; color: var(--ink-soft); max-width: 42ch; }
.sub { margin: 0; color: var(--ink-faint); font-size: 14px; max-width: 42ch; }
```

Then check every screen still fits the fixed window (`WIZARD_W`/`WIZARD_H` in `src/main/windows.ts`) — the walkthrough history records a five-panel screen that measured 624px of content in a 520px window, and a larger type scale is exactly how that happens again. If a screen overflows, cut words before cutting the scale.

- [ ] **Step 2: Soften the controls**

```css
input {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: var(--radius);
  color: inherit;
  font: inherit;
  padding: 15px 16px;
  transition: border-color 0.15s ease, background 0.15s ease;
}
input::placeholder { color: rgba(255, 255, 255, 0.34); }
input:focus {
  outline: none;
  border-color: rgba(255, 255, 255, 0.5);
  background: rgba(255, 255, 255, 0.09);
}

button {
  font: inherit;
  border-radius: var(--radius);
  padding: 13px 22px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: transform 0.12s ease, opacity 0.12s ease;
}
button:active { transform: translateY(1px); }
.primary { background: var(--ink); color: var(--bg); font-weight: 600; }
.quiet { background: none; color: var(--ink-faint); border-color: rgba(255, 255, 255, 0.14); }
.quiet:hover { color: var(--ink); }
```

- [ ] **Step 3: Let the character's colours arrive with the character**

The meet screen already knows the palette. In `renderCharacter`, set the derived colours as custom properties on the screen element (the avatar already uses them), then in CSS let the screen take a wash of the agent's own background so the last step of onboarding looks like the agent rather than like Circe:

```css
.screen.character {
  background:
    radial-gradient(120% 80% at 50% 0%, var(--agent-bg, transparent) 0%, transparent 70%),
    var(--bg);
}
.avatar {
  width: 84px; height: 84px; border-radius: 50%;
  border: 2px solid; display: grid; place-items: center;
  font-size: 28px; font-weight: 600; letter-spacing: 0.02em;
}
```

Set `--agent-bg` from the derived palette when rendering that screen. Keep the wash subtle — the spec bans decoration standing in front of the primary action, and a full-bleed colour field is decoration.

- [ ] **Step 4: Acknowledge what just happened**

One entrance, used by every screen, and one for the character arriving:

```css
@keyframes rise {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: none; }
}
.screen > * { animation: rise 0.32s ease both; }
.screen > *:nth-child(2) { animation-delay: 0.04s; }
.screen > *:nth-child(3) { animation-delay: 0.08s; }
.preview { animation: rise 0.5s cubic-bezier(0.2, 0.7, 0.2, 1) both; }

@media (prefers-reduced-motion: reduce) {
  .screen > *, .preview, .spinner { animation: none; }
}
```

The reduced-motion block is not optional: this is a native-feeling Mac app, and the OS setting is part of that.

- [ ] **Step 5: Look at it**

Build and drive it with `.claude/skills/run-circe`, against a sandboxed `HERMES_HOME`. Screenshot every screen: welcome, fandom, deriving, meet. Open the images — a blank frame means the launch failed, not that the design is minimal.

Check against §7 by eye: does the fandom step feel like being asked something interesting, and the meet screen like being introduced to someone? If either still reads as a form, the problem is spacing and type scale before it is colour.

- [ ] **Step 6: Show the screenshots to the user before committing**

This task has no test that can fail, so the review gate is a person. Post the four screenshots and say plainly which parts you are unsure about.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "style: onboarding that looks like an introduction"
```

---

## Self-Review

**Spec coverage.** §6.2 "The character's voice": derivation (Task 1), lives in `SOUL.md` (Task 2), voice-not-roleplay (Task 2), demonstrates then asks (Task 3), dial-down rewrites the section (Task 2), specialists inherit the rule — **carried by the existing `circe-orchestrator` skill, which already tells the orchestrator to write a specialist's persona; Task 2's template rule is what it copies from.** If the executor finds the skill needs an explicit line about giving a specialist a voice, add it to Task 2's step 3 rather than opening a sixth task. §1.4 → Task 4. §7 → Task 5. §5.6 → no work needed; it only forbids a dependency.

**Not covered, deliberately.** The spec left one thing open — whether the meet screen shows a line in the character's voice before the user clicks. No task implements it. Decide it with the user after Task 5, when there is something to look at.

> **Decided 2026-08-19: yes.** `Character.intro`, one in-voice sentence written for being introduced rather than for after acceptance. The argument that settled it was the re-roll: without a voice line, "Try someone else" swaps one Circe-written third-person description for another, and the voice is the only thing that actually distinguishes two candidates. See the decision record for the height finding that came with it.

**Type consistency.** `Character.voice` / `.greeting` / `.voiceCheck` are the names used in Tasks 1, 2 and 3. `voiceOrPlain` (Task 2) and `optionalText`, `scripted`, `plainCheck` (Tasks 1, 3) are each defined once, in the file that uses them. `COPY` (Task 4) is consumed only by the wizard renderer.
