/**
 * Every string the wizard shows, in one place, because onboarding copy is
 * reviewed as a whole — it has to read as one voice across five screens — and
 * because §1.4's rules are testable only if the strings are reachable.
 *
 * Lives in its own module, separate from `main.ts`, so it can be imported
 * by tests without pulling in `main.ts`'s module-load-time DOM access
 * (`document.getElementById`, `window.circe.onStep/ready`), which has
 * nothing to run against under the `node` test environment.
 */
export const COPY = {
  welcome: {
    title: 'Meet your first agent',
    lead: "Circe gives you AI assistants that live on your own computer — they keep what they learn, and they're yours.",
    sub: "This takes about a minute. At the end you'll meet the first one.",
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
    lead: "Your agent needs a model to think with — the same kind of thing that powers ChatGPT or Claude. Hermes handles the connection: open Terminal (an app already on your computer for typing commands), type `hermes setup`, and press enter. Once that's done, reopen Circe.",
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
    // Real behaviour, not a dead end: clicking it drops a random example
    // (from `FANDOM_IDEAS` in `main.ts`) into the input, the same kind of
    // thing already shown in `placeholder` above. See task-5-report.md.
    stuck: "Not sure? Give me some ideas",
  },
  deriving: {
    title: 'Finding your coordinator',
    // I4/§6.2: this is a real model call and can run close to a minute —
    // "a moment" undersold it. Warm framing doesn't get to trade away an
    // honest wait estimate.
    lead: 'Looking through {{FANDOM}} for the one who keeps everyone else on track. This can take up to a minute.',
  },
  meet: {
    lead: 'This is the one. They coordinate the others, and they can introduce you to more as you go.',
    action: 'Start with {{NAME}}',
    another: 'Try someone else',
  },
} as const;
