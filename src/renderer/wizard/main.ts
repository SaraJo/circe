import type { Character, WizardStep } from '../../shared/types';
import { COPY, fill, isReplaceableExample, nextFandomIdea } from './copy';
import { applyFace, initials } from '../face';

export { COPY };

declare global {
  interface Window {
    circe: {
      onStep(cb: (s: WizardStep) => void): void;
      ready(): void;
      start(): void;
      submitFandom(text: string): void;
      retry(): void;
      accept(): void;
      confirmClaim(): void;
      declineClaim(): void;
      reviewFleet(): void;
      personalizeFleet(): void;
      keepFleetNames(): void;
      acceptFleetSelection(profileIds: string[]): void;
      submitFleetFandom(text: string): void;
      retryFleet(): void;
      acceptFleetRenames(renameProfileIds: string[], tileProfileIds: string[]): void;
      chooseCoordinator(profileId: string | null): void;
      newCoordinator(): void;
      acceptNewCoordinator(): void;
      retryNewCoordinator(): void;
      resumeAdoption(): void;
      openExternal(url: string): void;
      onAvatar(cb: (dataUrl: string | null) => void): void;
    };
  }
}

/** The face for the character on screen, or null while there is none. */
let pendingFace: string | null = null;

const screenEl = document.getElementById('screen')!;

function el(html: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.innerHTML = html.trim();
  return wrap.firstElementChild as HTMLElement;
}

/**
 * How a character is presented, which differs between the two screens that
 * present one and nothing else does.
 *
 * `claim-default` used to render no character at all: a returning user
 * confirmed replacing their agent with a name in a sentence, and was then given
 * a face they had never seen. Rather than invent a second, lesser way of
 * showing a character, both screens render this card. There is one presentation
 * and it cannot drift, and the late-arriving face already targets
 * `.screen.character .avatar`, so it reaches both without a second selector.
 */
interface CharacterCard {
  /** A heading above the card, used where the screen is about a decision. */
  title?: string;
  lead: string;
  /**
   * `h1` where the character's name is the page's heading, `h2` where the
   * title above it is. Exactly one `h1` per screen either way.
   */
  nameTag: 'h1' | 'h2';
  primary: { label: string; onClick: () => void };
  secondary: { label: string; onClick: () => void };
  /**
   * Circe's third-person sentence about why this character coordinates. Shown
   * on `meet`, dropped on `claim-default`, and the reason is arithmetic rather
   * than taste: that screen also carries a heading and a four line replacement
   * warning, and the window is a fixed 640x560. With everything on it the
   * content ran to 659px and put the primary action 67px below the fold, which
   * is the same defect class as the 624px-in-a-520px window this project has
   * already shipped once. The face, the name, the tagline and the character's
   * own line all survive; the paragraph explaining the choice is the one thing
   * a user deciding whether to *replace* an agent needs least.
   */
  showWhy: boolean;
}

function renderCharacter(c: Character, card: CharacterCard): HTMLElement {
  const node = el(`
    <section class="screen character">
      ${card.title ? '<h1 class="claim"></h1>' : ''}
      <p class="lead"></p>
      <div class="preview">
        <div class="avatar"></div>
        <${card.nameTag}></${card.nameTag}>
        <p class="tagline"></p>
      </div>
      <p class="intro"></p>
      <p class="why"></p>
      <div class="actions">
        <button class="primary" id="accept"></button>
        <button class="quiet" id="another"></button>
      </div>
    </section>
  `);
  if (card.title) {
    node.querySelector('h1.claim')!.textContent = card.title;
    // The tighter vertical rhythm this screen needs to keep its primary action
    // above the fold. See `.screen.character.claiming` in wizard.css.
    node.classList.add('claiming');
  }
  node.querySelector('.lead')!.textContent = card.lead;
  // The character's own colours arrive with the character: a subtle wash
  // behind this one screen (§7), softened by color-mix in wizard.css so it
  // reads as a wash rather than a full-bleed colour field standing in front
  // of the primary action.
  node.style.setProperty('--agent-bg', c.palette.bg);
  node.style.setProperty('--agent-accent', c.palette.accent);
  // The face replaces the initials rather than sitting beside them, so the
  // fallback is the element that was already there and a lookup that finds
  // nothing renders precisely today's screen.
  const avatar = node.querySelector<HTMLElement>('.avatar')!;
  avatar.textContent = initials(c.name);
  applyFace(avatar, pendingFace);
  avatar.style.background = c.palette.bg;
  avatar.style.borderColor = c.palette.border;
  avatar.style.color = c.palette.accent;
  node.querySelector(`.preview ${card.nameTag}`)!.textContent = c.name;
  node.querySelector('.tagline')!.textContent = c.tagline;
  // The one line on this screen the character says itself. Everything else
  // here is Circe describing them in the third person, which reads identically
  // for every candidate — so without this, "Try someone else" swaps one
  // neutral description for another and the voice is a surprise that lands
  // only after the user has committed.
  //
  // Removed rather than left empty when there is nothing to say: `derive.ts`
  // blanks the intro whenever the character has no voice, and an empty
  // paragraph would hold its own margin and its own animation slot in a
  // column that is centred on the character.
  const intro = node.querySelector<HTMLElement>('.intro')!;
  if (c.intro) intro.textContent = c.intro;
  else intro.remove();
  const why = node.querySelector<HTMLElement>('.why')!;
  if (card.showWhy) why.textContent = c.why;
  else why.remove();
  const primary = node.querySelector('#accept')!;
  primary.textContent = card.primary.label;
  primary.addEventListener('click', card.primary.onClick);
  const secondary = node.querySelector('#another')!;
  secondary.textContent = card.secondary.label;
  secondary.addEventListener('click', card.secondary.onClick);
  return node;
}

function render(step: WizardStep): void {
  screenEl.replaceChildren();

  switch (step.kind) {
    case 'welcome': {
      const node = el(`
        <section class="screen welcome-screen">
          <div class="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 180 132" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M52 29C74 13 112 14 136 37" />
              <path d="M144 51C154 77 140 106 113 117" />
              <path d="M78 119C47 114 27 87 33 58" />
              <path d="M61 42C68 52 74 57 84 61" />
              <path d="M111 65C121 63 128 60 135 54" />
              <path d="M91 83C89 94 85 102 77 109" />
              <circle class="node node-pink" cx="52" cy="35" r="13" />
              <circle class="node node-peach" cx="142" cy="48" r="13" />
              <circle class="node node-lime" cx="74" cy="115" r="13" />
              <circle class="hub-ring" cx="92" cy="70" r="20" />
              <circle class="hub" cx="92" cy="70" r="10" />
            </svg>
          </div>
          <h1>${COPY.welcome.title}</h1>
          <p class="lead">${COPY.welcome.lead}</p>
          <p class="sub">${COPY.welcome.sub}</p>
          <div class="actions welcome-actions">
            <button class="primary" id="start">${COPY.welcome.action}</button>
          </div>
        </section>
      `);
      node.querySelector('#start')!.addEventListener('click', () => window.circe.start());
      screenEl.append(node);
      break;
    }

    case 'runtime-checking':
      screenEl.append(
        el(`
          <section class="screen working">
            <h1>${COPY.runtimeChecking.title}</h1>
            <p class="lead">${COPY.runtimeChecking.lead}</p>
            <p class="status">${COPY.runtimeChecking.status}</p>
            <div class="spinner"></div>
          </section>
        `),
      );
      break;

    case 'runtime-missing': {
      const node = el(`
        <section class="screen">
          <h1>${COPY.runtime.title}</h1>
          <p class="lead">${COPY.runtime.lead}</p>
          <div class="actions">
            <button class="primary" id="install">${COPY.runtime.action}</button>
          </div>
        </section>
      `);
      node
        .querySelector('#install')!
        .addEventListener('click', () =>
          window.circe.openExternal('https://hermes-agent.nousresearch.com'),
        );
      screenEl.append(node);
      break;
    }

    case 'provider-missing': {
      // The command is a placeholder, not markdown: nothing here renders
      // markdown, so backticks in the copy reached the screen as literal
      // characters. Split on it and give the command a real `<code>` (M3).
      const [providerBefore, providerAfter] = COPY.provider.lead.split('{{COMMAND}}');
      const node = el(`
        <section class="screen">
          <h1>${COPY.provider.title}</h1>
          <p class="lead">${providerBefore}<code></code>${providerAfter}</p>
        </section>
      `);
      node.querySelector('code')!.textContent = COPY.provider.command;
      screenEl.append(node);
      break;
    }

    case 'existing-fleet': {
      const node = el(`
        <section class="screen fleet-adoption">
          <h1>${COPY.existingFleet.title}</h1>
          <p class="lead">${COPY.existingFleet.lead}</p>
          <div class="fleet-list" aria-label="Existing agents"></div>
          <div class="actions">
            <button class="primary" id="review-fleet">${COPY.existingFleet.action}</button>
          </div>
        </section>
      `);
      const list = node.querySelector('.fleet-list')!;
      for (const profile of step.profiles) {
        const row = el('<div class="fleet-row"><strong></strong><span></span></div>');
        row.querySelector('strong')!.textContent = profile.displayName;
        row.querySelector('span')!.textContent = profile.id;
        list.append(row);
      }
      node.querySelector('#review-fleet')!.addEventListener('click', () => window.circe.reviewFleet());
      screenEl.append(node);
      break;
    }

    case 'fleet-identity-choice': {
      const node = el(`
        <section class="screen fleet-adoption">
          <h1>${COPY.fleetIdentityChoice.title}</h1>
          <p class="lead">${COPY.fleetIdentityChoice.lead}</p>
          <div class="fleet-list" aria-label="Selected agents"></div>
          <div class="actions">
            <button class="primary" id="personalize">${COPY.fleetIdentityChoice.personalize}</button>
            <button class="quiet" id="keep">${COPY.fleetIdentityChoice.keep}</button>
          </div>
        </section>
      `);
      const list = node.querySelector('.fleet-list')!;
      for (const profile of step.profiles) {
        const row = el('<div class="fleet-row"><strong></strong><span></span></div>');
        row.querySelector('strong')!.textContent = profile.displayName;
        row.querySelector('span')!.textContent = profile.id;
        list.append(row);
      }
      node.querySelector('#personalize')!.addEventListener('click', () => window.circe.personalizeFleet());
      node.querySelector('#keep')!.addEventListener('click', () => window.circe.keepFleetNames());
      screenEl.append(node);
      break;
    }

    case 'fleet-selection': {
      const node = el(`
        <section class="screen fleet-adoption">
          <h1>${COPY.fleetSelection.title}</h1>
          <p class="lead">${COPY.fleetSelection.lead}</p>
          <div class="fleet-list selectable-fleet" aria-label="Agents to show in Circe"></div>
          <p class="status selection-status" hidden>${COPY.fleetSelection.required}</p>
          <div class="actions">
            <button class="primary" id="accept-fleet-selection">${COPY.fleetSelection.action}</button>
          </div>
        </section>
      `);
      const list = node.querySelector('.fleet-list')!;
      for (const profile of step.profiles) {
        const row = el(`
          <label class="fleet-row fleet-choice">
            <input type="checkbox" checked />
            <strong></strong>
            <span></span>
          </label>
        `);
        const checkbox = row.querySelector<HTMLInputElement>('input')!;
        checkbox.value = profile.id;
        row.querySelector('strong')!.textContent = profile.displayName;
        row.querySelector('span')!.textContent = profile.id;
        list.append(row);
      }
      node.querySelector('#accept-fleet-selection')!.addEventListener('click', () => {
        const ids = Array.from(
          node.querySelectorAll<HTMLInputElement>('.fleet-choice input:checked'),
        ).map((checkbox) => checkbox.value);
        const status = node.querySelector<HTMLElement>('.selection-status')!;
        status.hidden = ids.length > 0;
        if (ids.length > 0) window.circe.acceptFleetSelection(ids);
      });
      screenEl.append(node);
      break;
    }

    case 'fleet-fandom': {
      const rename = step.intent === 'rename';
      const node = el(`
        <section class="screen ask fleet-fandom">
          <h1>${rename ? COPY.fleetFandom.renameTitle : COPY.fleetFandom.coordinatorTitle}</h1>
          <p class="lead">${rename ? COPY.fleetFandom.renameLead : COPY.fleetFandom.coordinatorLead}</p>
          <input id="fleet-fandom" placeholder="${COPY.fandom.placeholder}" autofocus />
          <div class="actions">
            <button class="primary" id="fleet-go">${COPY.fleetFandom.action}</button>
          </div>
        </section>
      `);
      const input = node.querySelector<HTMLInputElement>('#fleet-fandom')!;
      const submit = () => window.circe.submitFleetFandom(input.value);
      node.querySelector('#fleet-go')!.addEventListener('click', submit);
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') submit();
      });
      screenEl.append(node);
      input.focus();
      break;
    }

    case 'fleet-deriving': {
      const rename = step.intent === 'rename';
      const lead = fill(
        rename ? COPY.fleetDeriving.renameLead : COPY.fleetDeriving.coordinatorLead,
        { FANDOM: step.fandom },
      );
      screenEl.append(
        el(`
          <section class="screen working">
            <h1>${rename ? COPY.fleetDeriving.renameTitle : COPY.fleetDeriving.coordinatorTitle}</h1>
            <p class="lead"></p>
            <div class="spinner"></div>
          </section>
        `),
      );
      screenEl.querySelector('.lead')!.textContent = lead;
      break;
    }

    case 'fleet-derive-failed': {
      const node = el(`
        <section class="screen error">
          <h1>${COPY.deriveFailed.title}</h1>
          <p class="lead"></p>
          <div class="actions"><button class="primary" id="retry-fleet">${COPY.deriveFailed.action}</button></div>
        </section>
      `);
      node.querySelector('.lead')!.textContent = step.message;
      node.querySelector('#retry-fleet')!.addEventListener('click', () => window.circe.retryFleet());
      screenEl.append(node);
      break;
    }

    case 'fleet-preview': {
      const node = el(`
        <section class="screen fleet-preview-screen">
          <h1>${COPY.fleetPreview.title}</h1>
          <p class="lead">${COPY.fleetPreview.lead}</p>
          <div class="fleet-proposals"></div>
          <div class="actions"><button class="primary" id="apply-fleet">${COPY.fleetPreview.action}</button></div>
        </section>
      `);
      const proposals = node.querySelector('.fleet-proposals')!;
      for (const proposal of step.proposals) {
        const row = el(`
          <div class="proposal-row">
            <span class="proposal-copy"><strong></strong><small></small></span>
            <span class="palette-preview"><i></i><i></i><i></i></span>
            <label class="rename-option">
              <input class="rename-toggle" type="checkbox" checked />
              <span><strong></strong><small></small></span>
            </label>
          </div>
        `);
        const renameToggle = row.querySelector<HTMLInputElement>('.rename-toggle')!;
        renameToggle.value = proposal.profile.id;
        row.querySelector('strong')!.textContent = `${proposal.profile.displayName} → ${proposal.character.name}`;
        row.querySelector('small')!.textContent = proposal.character.tagline;
        const option = row.querySelector('.rename-option')!;
        option.querySelector('strong')!.textContent = `Use ${proposal.character.name}`;
        option.querySelector('small')!.textContent = `Uncheck to keep ${proposal.profile.displayName}`;
        renameToggle.setAttribute(
          'aria-label',
          `Use ${proposal.character.name} instead of ${proposal.profile.displayName}`,
        );
        renameToggle.addEventListener('change', () => {
          row.classList.toggle('kept', !renameToggle.checked);
        });
        const colours = [proposal.character.palette.bg, proposal.character.palette.border, proposal.character.palette.accent];
        row.querySelectorAll<HTMLElement>('.palette-preview i').forEach((swatch, index) => {
          swatch.style.background = colours[index]!;
        });
        proposals.append(row);
      }
      node.querySelector('#apply-fleet')!.addEventListener('click', () => {
        const renameIds = Array.from(
          node.querySelectorAll<HTMLInputElement>('.proposal-row .rename-toggle:checked'),
        ).map((checkbox) => checkbox.value);
        const tileIds = step.proposals.map((proposal) => proposal.profile.id);
        window.circe.acceptFleetRenames(renameIds, tileIds);
      });
      screenEl.append(node);
      break;
    }

    case 'fleet-saving':
      screenEl.append(
        el(`
          <section class="screen working">
            <h1>${COPY.fleetPreview.savingTitle}</h1>
            <p class="lead">${COPY.fleetPreview.savingLead}</p>
            <div class="spinner"></div>
          </section>
        `),
      );
      break;

    case 'coordinator-choice': {
      const node = el(`
        <section class="screen coordinator-choice">
          <h1>${COPY.coordinatorChoice.title}</h1>
          <p class="lead">${COPY.coordinatorChoice.lead}</p>
          <select id="coordinator"></select>
          <div class="actions coordinator-actions">
            <button class="primary" id="use-existing">${COPY.coordinatorChoice.existing}</button>
            <button class="quiet" id="create-new">${COPY.coordinatorChoice.create}</button>
          </div>
          <button class="link" id="skip-coordinator">${COPY.coordinatorChoice.skip}</button>
        </section>
      `);
      const select = node.querySelector<HTMLSelectElement>('#coordinator')!;
      for (const profile of step.profiles) {
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = profile.displayName;
        select.append(option);
      }
      const defaultProfile = step.profiles.find((profile) => profile.id === 'default');
      if (defaultProfile) select.value = defaultProfile.id;
      node.querySelector('#use-existing')!.addEventListener('click', () =>
        window.circe.chooseCoordinator(select.value),
      );
      node.querySelector('#create-new')!.addEventListener('click', () => window.circe.newCoordinator());
      node.querySelector('#skip-coordinator')!.addEventListener('click', () =>
        window.circe.chooseCoordinator(null),
      );
      screenEl.append(node);
      break;
    }

    case 'new-coordinator-preview':
      screenEl.append(
        renderCharacter(step.character, {
          title: COPY.newCoordinator.title,
          lead: COPY.newCoordinator.lead,
          nameTag: 'h2',
          showWhy: true,
          primary: {
            label: fill(COPY.meet.action, { NAME: step.character.name }),
            onClick: () => window.circe.acceptNewCoordinator(),
          },
          secondary: {
            label: COPY.newCoordinator.another,
            onClick: () => window.circe.retryNewCoordinator(),
          },
        }),
      );
      break;

    case 'adoption-write-failed': {
      const node = el(`
        <section class="screen error">
          <h1>${COPY.adoptionFailed.title}</h1>
          <p class="lead"></p>
          <div class="actions"><button class="primary" id="resume-adoption">${COPY.adoptionFailed.action}</button></div>
        </section>
      `);
      node.querySelector('.lead')!.textContent = step.message;
      node.querySelector('#resume-adoption')!.addEventListener('click', () => window.circe.resumeAdoption());
      screenEl.append(node);
      break;
    }

    case 'fleet-launching':
      screenEl.append(el(`<section class="screen"><h1>${COPY.coordinatorChoice.opening}</h1></section>`));
      break;

    case 'fandom': {
      const node = el(`
        <section class="screen ask">
          <h1>${COPY.fandom.title}</h1>
          <p class="lead">${COPY.fandom.lead}</p>
          <div class="illustration" aria-hidden="true">
            <svg width="150" height="115" viewBox="0 0 200 140" fill="none" xmlns="http://www.w3.org/2000/svg" stroke="currentColor">
              <path d="M100,52 C 70,40 35,42 20,60 C 12,70 12,88 22,98 C 40,112 75,108 100,101" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M100,52 C 130,40 165,42 180,60 C 188,70 188,88 178,98 C 160,112 125,108 100,101" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M100,52 C 98,70 102,82 100,101" stroke-width="3" stroke-linecap="round"/>
              <path d="M40,66 L65,63" stroke-width="2.5" stroke-linecap="round"/>
              <path d="M38,77 L68,75" stroke-width="2.5" stroke-linecap="round"/>
              <path d="M42,88 L66,87" stroke-width="2.5" stroke-linecap="round"/>
              <path d="M135,63 L160,66" stroke-width="2.5" stroke-linecap="round"/>
              <path d="M132,75 L162,77" stroke-width="2.5" stroke-linecap="round"/>
              <path d="M134,87 L158,88" stroke-width="2.5" stroke-linecap="round"/>
              <path d="M104,8 L96,30" stroke-width="2.5" stroke-linecap="round"/>
              <path d="M89,20 L111,18" stroke-width="2.5" stroke-linecap="round"/>
              <path d="M91,11 L109,27" stroke-width="2.5" stroke-linecap="round"/>
              <path d="M109,11 L91,27" stroke-width="2.5" stroke-linecap="round"/>
              <circle cx="150" cy="18" r="2.2" fill="currentColor" stroke="none"/>
              <circle cx="55" cy="22" r="1.8" fill="currentColor" stroke="none"/>
            </svg>
          </div>
          <input id="fandom" placeholder="${COPY.fandom.placeholder}" autofocus />
          <button class="link" id="stuck">${COPY.fandom.stuck}</button>
          <div class="actions">
            <button class="primary" id="go">${COPY.fandom.action}</button>
          </div>
        </section>
      `);
      const input = node.querySelector<HTMLInputElement>('#fandom')!;
      const submit = () => window.circe.submitFandom(input.value);
      node.querySelector('#go')!.addEventListener('click', submit);
      // The button only ever overwrites an example it put there itself, and
      // hides as soon as the field holds something the user typed — so it can
      // neither clobber their answer nor sit there as a click that would
      // (M6).
      const stuck = node.querySelector<HTMLElement>('#stuck')!;
      let offered: string | null = null;
      const syncStuck = () => {
        stuck.hidden = !isReplaceableExample(input.value, offered);
      };
      stuck.addEventListener('click', () => {
        offered = nextFandomIdea(input.value);
        input.value = offered;
        input.focus();
        syncStuck();
      });
      input.addEventListener('input', syncStuck);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submit();
      });
      screenEl.append(node);
      input.focus();
      break;
    }

    case 'deriving': {
      // `deriving.lead` carries a `{{FANDOM}}` placeholder so the fandom the
      // user actually typed can sit inside the same `.fandom` span the
      // screen has always used — never let a literal `{{FANDOM}}` reach the
      // page.
      const [derivingBefore, derivingAfter] = COPY.deriving.lead.split('{{FANDOM}}');
      const node = el(`
        <section class="screen working">
          <h1>${COPY.deriving.title}</h1>
          <p class="lead">${derivingBefore}<span class="fandom"></span>${derivingAfter}</p>
          <div class="spinner"></div>
        </section>
      `);
      node.querySelector('.fandom')!.textContent = step.fandom;
      screenEl.append(node);
      break;
    }

    case 'derive-failed': {
      const node = el(`
        <section class="screen error">
          <h1>${COPY.deriveFailed.title}</h1>
          <p class="lead"></p>
          <div class="actions">
            <button class="primary" id="retry">${COPY.deriveFailed.action}</button>
          </div>
        </section>
      `);
      node.querySelector('.lead')!.textContent = step.message;
      node.querySelector('#retry')!.addEventListener('click', () => window.circe.retry());
      screenEl.append(node);
      break;
    }

    case 'claim-default': {
      // The same card the meet screen shows. This screen asks a returning user
      // to give up the agent they have; it should at least show them the one
      // they are being offered, including the face that is about to be written
      // into their profile.
      screenEl.append(
        renderCharacter(step.character, {
          title: COPY.claimDefault.title,
          lead: fill(COPY.claimDefault.lead, {
            EXISTING: step.existingName,
            NAME: step.character.name,
          }),
          nameTag: 'h2',
          showWhy: false,
          primary: {
            label: COPY.claimDefault.action,
            onClick: () => window.circe.confirmClaim(),
          },
          secondary: {
            label: COPY.claimDefault.decline,
            onClick: () => window.circe.declineClaim(),
          },
        }),
      );
      break;
    }

    case 'meet':
      screenEl.append(
        renderCharacter(step.character, {
          lead: COPY.meet.lead,
          nameTag: 'h1',
          showWhy: true,
          primary: {
            label: fill(COPY.meet.action, { NAME: step.character.name }),
            onClick: () => window.circe.accept(),
          },
          secondary: { label: COPY.meet.another, onClick: () => window.circe.retry() },
        }),
      );
      break;

    case 'saving': {
      const node = el(`
        <section class="screen">
          <h1></h1>
          <p class="lead">${COPY.saving.lead}</p>
          <div class="spinner"></div>
        </section>
      `);
      node.querySelector('h1')!.textContent = fill(COPY.saving.title, {
        NAME: step.character.name,
      });
      screenEl.append(node);
      break;
    }

    case 'write-failed': {
      const node = el(`
        <section class="screen error">
          <h1>${COPY.writeFailed.title}</h1>
          <p class="lead"></p>
          <p class="status"></p>
          <div class="actions">
            <button class="primary" id="retry-write">${COPY.writeFailed.action}</button>
          </div>
        </section>
      `);
      // Two different truths behind one failure. Claiming "untouched" when the
      // persona has in fact been replaced is a false statement about the
      // user's own data, and it steers them away from the backup that exists.
      const replaced = step.personaReplaced;
      node.querySelector('.lead')!.textContent = replaced
        ? [
            fill(COPY.writeFailed.replaced, {
              NAME: step.character.name,
              PATH: replaced.path,
            }),
            replaced.backedUpTo
              ? fill(COPY.writeFailed.backedUp, { BACKUP: replaced.backedUpTo })
              : COPY.writeFailed.noBackup,
          ].join(' ')
        : fill(COPY.writeFailed.untouched, { NAME: step.character.name });
      node.querySelector('.status')!.textContent = step.message;
      node.querySelector('#retry-write')!.addEventListener('click', () => window.circe.accept());
      screenEl.append(node);
      break;
    }

    case 'launching': {
      const node = el(`
        <section class="screen">
          <h1></h1>
        </section>
      `);
      node.querySelector('h1')!.textContent = fill(COPY.launching.title, {
        NAME: step.character.name,
      });
      screenEl.append(node);
      break;
    }

    default: {
      const _exhaustive: never = step;
      throw new Error(`Unhandled wizard step: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

window.circe.onStep(render);
window.circe.onAvatar((url) => {
  pendingFace = url;
  const avatar = document.querySelector<HTMLElement>('.screen.character .avatar');
  if (avatar) applyFace(avatar, url);
});
window.circe.ready();
