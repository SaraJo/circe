import type { Character, WizardStep } from '../../shared/types';
import { COPY, fill, isReplaceableExample, nextFandomIdea } from './copy';
import { applyFace, initials } from '../face';

export { COPY };

declare global {
  interface Window {
    circe: {
      onStep(cb: (s: WizardStep) => void): void;
      ready(): void;
      submitFandom(text: string): void;
      retry(): void;
      accept(): void;
      confirmClaim(): void;
      declineClaim(): void;
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

function renderCharacter(c: Character): HTMLElement {
  const node = el(`
    <section class="screen character">
      <p class="lead">${COPY.meet.lead}</p>
      <div class="preview">
        <div class="avatar"></div>
        <h1></h1>
        <p class="tagline"></p>
      </div>
      <p class="intro"></p>
      <p class="why"></p>
      <div class="actions">
        <button class="primary" id="accept"></button>
        <button class="quiet" id="another">${COPY.meet.another}</button>
      </div>
    </section>
  `);
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
  node.querySelector('h1')!.textContent = c.name;
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
  node.querySelector('.why')!.textContent = c.why;
  node.querySelector('#accept')!.textContent = fill(COPY.meet.action, { NAME: c.name });
  node.querySelector('#accept')!.addEventListener('click', () => window.circe.accept());
  node.querySelector('#another')!.addEventListener('click', () => window.circe.retry());
  return node;
}

function render(step: WizardStep): void {
  screenEl.replaceChildren();

  switch (step.kind) {
    case 'welcome':
    case 'runtime-checking':
      screenEl.append(
        el(`
        <section class="screen intro">
          <h1>${COPY.welcome.title}</h1>
          <p class="lead">${COPY.welcome.lead}</p>
          <p class="sub">${COPY.welcome.sub}</p>
          <p class="status">${COPY.welcome.status}</p>
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
        <section class="screen">
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
      const node = el(`
        <section class="screen">
          <h1>${COPY.claimDefault.title}</h1>
          <p class="lead"></p>
          <div class="actions">
            <button class="primary" id="confirm">${COPY.claimDefault.action}</button>
            <button class="quiet" id="decline">${COPY.claimDefault.decline}</button>
          </div>
        </section>
      `);
      node.querySelector('.lead')!.textContent = fill(COPY.claimDefault.lead, {
        EXISTING: step.existingName,
        NAME: step.character.name,
      });
      node.querySelector('#confirm')!.addEventListener('click', () => window.circe.confirmClaim());
      node.querySelector('#decline')!.addEventListener('click', () => window.circe.declineClaim());
      screenEl.append(node);
      break;
    }

    case 'meet':
      screenEl.append(renderCharacter(step.character));
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
        <section class="screen">
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
