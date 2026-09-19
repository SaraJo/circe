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
    title: 'Meet your agents',
    lead: "Circe gives your local AI assistants a home on your desktop. They keep what they learn, and they're yours.",
    // Existing and new users share this stable first screen. It describes the
    // next decision without pretending every person is creating a first agent.
    sub: "If you already have agents, you'll choose which appear and whether each keeps its identity. If you're starting fresh, Circe helps create a coordinator that can build the rest.",
    action: 'Review my setup',
  },
  runtimeChecking: {
    title: 'Looking for your agents',
    lead: 'Circe is checking Hermes, the open-source software your agents run on. Nothing is being changed.',
    status: 'This usually takes only a few seconds.',
  },
  runtime: {
    title: "Couldn't connect to Hermes",
    lead: "Circe couldn't confirm that Hermes is available. If it's already installed, try checking again. If you need to install it, Get Hermes opens the setup guide; return here afterward and check again.",
    retry: 'Check again',
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
    lead: 'Your agent needs a model to think with, the same kind of thing that powers ChatGPT or Claude. Hermes handles the connection: open Terminal on macOS or PowerShell on Windows, type {{COMMAND}}, and press enter. Once that\'s done, reopen Circe.',
    command: 'hermes setup',
    // No `action` field: this screen has no button, because there is no
    // in-app "Connect" flow to send one to — connecting a model happens in
    // a terminal, per `lead` above. A button here would either duplicate
    // the instruction or promise a flow that doesn't exist. See
    // task-5-report.md.
  },
  existingFleet: {
    title: 'Your agents are already here',
    lead: 'Circe found an existing Hermes setup. Next you will review each agent. Nothing is renamed, recoloured, hidden, or given new responsibilities until you confirm it.',
    action: 'Review agents individually',
  },
  fleetSelection: {
    title: 'Choose your Circe tiles',
    lead: 'Checked agents will open as Circe tiles. Unchecked agents stay safely in Hermes and are not deleted or changed.',
    action: 'Continue with selected agents',
    required: 'Choose at least one agent to use in Circe.',
  },
  fleetIdentityChoice: {
    title: 'What about their identities?',
    lead: 'You can keep every selected agent exactly as named, or ask Circe for fandom suggestions and accept or reject each suggestion individually.',
    personalize: 'Suggest identities',
    keep: 'Keep all current identities',
  },
  fleetFandom: {
    keepTitle: 'Where are your agents from?',
    keepLead: 'Circe will keep every current identity unchanged. The shared world is used only to verify and find the right face for each agent.',
    renameTitle: 'Choose a world for your fleet',
    renameLead: 'Circe will propose a distinct name and colour palette for each existing agent, matched to the role it already has. Their profile ids and instructions stay in place.',
    coordinatorTitle: 'Choose a world for your coordinator',
    coordinatorLead: 'Circe will create one new coordinator beside your existing agents. Nothing in the current fleet will be replaced.',
    action: 'Show me',
  },
  fleetDeriving: {
    keepTitle: 'Finding their faces',
    keepLead: 'Keeping every current identity and looking for verified faces from {{FANDOM}}. Some agents may keep initials when no trustworthy image is available.',
    renameTitle: 'Finding your fleet',
    renameLead: 'Matching each existing role with a distinct identity from {{FANDOM}}. This can take up to a minute.',
    coordinatorTitle: 'Finding your coordinator',
    coordinatorLead: 'Looking through {{FANDOM}} for the one who keeps everyone else on track. This can take up to a minute.',
  },
  fleetPreview: {
    title: 'Choose each identity',
    lead: 'Use a suggestion, keep the current identity, or ask for someone else. You can also describe changes for the whole group below.',
    currentRole: 'What this agent does now:',
    another: 'Try someone else',
    feedbackPlaceholder: 'For example: choose characters I’m more likely to recognize, and use Picard for Research.',
    revise: 'Revise suggestions',
    feedbackRequired: 'Describe what you would like changed.',
    action: 'Apply choices',
    savingTitle: 'Updating your fleet',
    savingLead: 'Saving backups, names, colours, and new portraits before Circe opens any agents. Portraits can take several minutes.',
  },
  coordinatorChoice: {
    title: 'Who should coordinate?',
    lead: 'You can give one existing agent the ability to build skills and specialists, create a new dedicated coordinator, or leave the fleet as it is for now.',
    existing: 'Use this agent as coordinator',
    create: 'Create a new coordinator',
    skip: 'Skip for now',
    opening: 'Opening your fleet',
    avatarFailure: 'Circe could not replace portraits for: {{NAMES}}. Their previous avatars remain, and you can replace each one from its agent window.',
  },
  newCoordinator: {
    title: 'Meet your new coordinator',
    lead: 'This agent will be added beside the assistants you already have. Nothing existing will be replaced.',
    another: 'Try someone else',
  },
  adoptionFailed: {
    title: "I couldn't finish that safely",
    action: 'Review my existing agents',
  },
  fandom: {
    title: 'What do you love?',
    lead: 'Name a world you like: a show, a book, a game, a hobby, a group chat. We ask because your agents get their names and their character from it, so it may as well be somewhere you enjoy.',
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
 * True when the input holds nothing but the example this button last put there,
 * and so may be overwritten. M6: the button used to clobber whatever the user
 * had typed. Text the user wrote is theirs; `main.ts` hides the button rather
 * than leaving a click that would destroy it.
 *
 * Matching against `offered` rather than against `FANDOM_IDEAS` is deliberate:
 * a user who types "Formula 1" themselves typed it, and a membership test
 * cannot tell that apart from the button having placed it.
 */
export function isReplaceableExample(value: string, offered: string | null): boolean {
  return value.trim() === '' || value === offered;
}

/** A different example from the one already showing, so clicking twice moves. */
export function nextFandomIdea(current: string): string {
  const pool = FANDOM_IDEAS.filter((idea) => idea !== current);
  return pool[Math.floor(Math.random() * pool.length)] ?? FANDOM_IDEAS[0]!;
}
