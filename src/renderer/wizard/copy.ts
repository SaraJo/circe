/**
 * Every string the wizard shows, in one place, because onboarding copy is
 * reviewed as a whole — it has to read as one voice across every screen — and
 * because §1.4's rules are testable only if the strings are reachable.
 *
 * Lives in its own module, separate from `main.ts`, so it can be imported
 * by tests without pulling in `main.ts`'s module-load-time DOM access
 * (`document.getElementById`, `window.circe.onStep/ready`), which has
 * nothing to run against under the `node` test environment.
 *
 * **All eleven rendered screens live here, including the five that are only
 * reached when something goes wrong.** They used to be hardcoded inside
 * `main.ts`'s switch, which put them outside `Object.values(COPY)` and
 * therefore outside every §1.4 rule test — so `claim-default` could name
 * Hermes with no gloss and nothing noticed. A screen not in this file is a
 * screen nothing checks, and `derive-failed` is the one a user is most likely
 * to meet.
 */
export const COPY = {
  welcome: {
    title: 'Meet your first agent',
    lead: "Circe gives you AI assistants that live on your own computer — they keep what they learn, and they're yours.",
    // §6.2 Step 1 requires this screen to answer "what happens next", and the
    // answer is the coordinator: the wizard makes one agent whose job is
    // helping you build the others. The warm rewrite briefly lost that to "at
    // the end you'll meet the first one", which pushed the idea three screens
    // later and left the one screen Circe gets to explain itself explaining
    // less than it used to.
    sub: "It takes about a minute. At the end you'll meet your coordinator — the agent whose job is helping you build the others.",
    // No `action` field: this screen auto-advances (`Wizard.start()` fires
    // as soon as the renderer signals ready), so there is nothing a
    // "Start" button would do that isn't already happening. A dead button
    // would be worse than none — see task-5-report.md.
    // The very first mention of Hermes in the product — it has to carry the
    // gloss itself, because this status line can render before anything
    // else does (I3).
    status: "Checking for Hermes, the open-source software your agents run on…",
  },
  runtime: {
    title: 'One thing to install first',
    // C2: the button below this text opens a download page rather than
    // confirming anything, so the lead has to say so plainly and tell the
    // reader what to do once they're back (mirrors the provider-missing
    // fix below).
    lead: "Your agents run on Hermes, free open-source software that does the actual work of keeping them running. It isn't installed yet — the button below opens the page to get it. Once it's installed, reopen Circe.",
    action: 'Get Hermes',
  },
  provider: {
    title: 'Connect a model',
    // C1: this screen has no button, so the copy has to be the whole
    // instruction — the exact command and what to do afterward — not just
    // the concept.
    //
    // M3: the command is a `{{COMMAND}}` placeholder rather than markdown
    // backticks. Nothing renders markdown here, so the backticks reached the
    // screen as literal characters — "type `hermes setup`" — on the one screen
    // in the flow whose whole job is a command the user has to type. `main.ts`
    // splits on the placeholder and puts the command in a real `<code>`.
    lead: 'Your agent needs a model to think with — the same kind of thing that powers ChatGPT or Claude. Hermes handles the connection: open Terminal (an app already on your computer for typing commands), type {{COMMAND}}, and press enter. Once that\'s done, reopen Circe.',
    command: 'hermes setup',
    // No `action` field: this screen has no button, because there is no
    // in-app "Connect" flow to send one to — connecting a model happens in
    // a terminal, per `lead` above. A button here would either duplicate
    // the instruction or promise a flow that doesn't exist. See
    // task-5-report.md.
  },
  fandom: {
    title: 'What do you love?',
    lead: 'Name a world you like — a show, a book, a game, a hobby, a group chat. We ask because your agents get their names and their character from it, so it may as well be somewhere you enjoy.',
    placeholder: "Hitchhiker's Guide, the Wire, competitive bread baking…",
    action: 'Continue',
    // M6: this said "give me some ideas" and delivered exactly one, over the
    // top of whatever the user had typed. Singular now, because singular is
    // what it does — clicking again swaps in a different example, and the
    // button hides itself the moment the input holds anything the user typed
    // rather than anything this button put there.
    stuck: 'Not sure? Give me an example',
  },
  deriving: {
    title: 'Finding your coordinator',
    // I4/§6.2: this is a real model call and can run close to a minute —
    // "a moment" undersold it. Warm framing doesn't get to trade away an
    // honest wait estimate.
    lead: 'Looking through {{FANDOM}} for the one who keeps everyone else on track. This can take up to a minute.',
  },
  deriveFailed: {
    title: "That didn't work",
    action: 'Try again',
    // The `.lead` on this screen is the thrown error's own message, set with
    // textContent by `main.ts`. There is no fixed copy for it — see
    // `wizard.ts` for the messages themselves.
  },
  claimDefault: {
    title: 'You already have an agent here',
    // I9: this used to say "This machine's main Hermes agent is…" — a bare,
    // unglossed Hermes on a screen that can be the first one a returning user
    // sees. It does not need the word at all: what is being replaced is an
    // agent, and the screen is about the agent.
    lead: "This computer's main agent is {{EXISTING}}. Setting up {{NAME}} replaces it. Your old persona is saved to a backup file first, and none of your other agents are touched.",
    action: 'Replace it',
    decline: 'Keep what I have',
  },
  meet: {
    lead: 'This is the one. They coordinate the others, and they can introduce you to more as you go.',
    action: 'Start with {{NAME}}',
    another: 'Try someone else',
  },
  saving: {
    title: 'Setting {{NAME}} up…',
    lead: 'Writing the persona and installing the skill.',
  },
  writeFailed: {
    title: "Couldn't finish the setup",
    // Two different truths behind one failure. Claiming "untouched" when the
    // persona has in fact been replaced is a false statement about the user's
    // own data, and it steers them away from the backup that exists.
    untouched:
      'Something went wrong writing {{NAME}} to your Hermes home, so nothing was changed and no agent was started. Your existing setup is untouched.',
    replaced:
      'Something went wrong setting up {{NAME}}, and no agent was started, but your {{PATH}} had already been replaced by then.',
    backedUp: 'Your previous version was saved to {{BACKUP}}.',
    noBackup: 'There was no earlier version worth keeping, so no backup was made.',
    action: 'Try again',
  },
  launching: {
    title: 'Starting {{NAME}}…',
  },
} as const;

/**
 * Substitutes `{{PLACEHOLDER}}` values into a string from `COPY`.
 *
 * Replacer functions, not replacement strings (M1): a plain string handed to
 * `replace`/`replaceAll` still honours `$&`, `$$`, `` $` `` and `$'` as special
 * patterns, so a derived name containing one splices in matched text instead of
 * its own characters — a character called `Trillian $&` turned "Start with
 * {{NAME}}" into "Start with Trillian {{NAME}}". `soulTemplate.ts` documents
 * and defends against exactly this; the renderer had reintroduced it.
 */
export function fill(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{{${key}}}`, () => value),
    template,
  );
}

/**
 * What `fandom.stuck` actually offers: one of these, dropped into the input, so
 * the escape hatch gives the user a real, concrete option rather than nothing.
 * Deliberately not a model call — this has to be instant, and picking from a
 * short curated list is honest about what it is (a nudge, not a suggestion
 * engine).
 */
export const FANDOM_IDEAS = [
  "Terry Pratchett's Discworld",
  'a decades-long D&D campaign',
  'competitive bread baking',
  'a group chat that never sleeps',
  'Formula 1',
  'the Marvel universe',
  'birdwatching',
  'a college a cappella group',
];

/**
 * True when the input holds nothing but an example this button put there, and
 * so may be overwritten. M6: the button used to clobber whatever the user had
 * typed. Text the user wrote is theirs; `main.ts` hides the button rather than
 * leaving a click that would destroy it.
 */
export function isReplaceableExample(value: string): boolean {
  return value.trim() === '' || FANDOM_IDEAS.includes(value);
}

/** A different example from the one already showing, so clicking twice moves. */
export function nextFandomIdea(current: string): string {
  const pool = FANDOM_IDEAS.filter((idea) => idea !== current);
  return pool[Math.floor(Math.random() * pool.length)] ?? FANDOM_IDEAS[0]!;
}
