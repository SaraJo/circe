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
