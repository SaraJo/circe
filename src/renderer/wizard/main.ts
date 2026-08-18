import type { Character, WizardStep } from '../../shared/types';
import { COPY, fill, isReplaceableExample, nextFandomIdea } from './copy';

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
    };
  }
}

const screenEl = document.getElementById('screen')!;

function el(html: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.innerHTML = html.trim();
  return wrap.firstElementChild as HTMLElement;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
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
  const avatar = node.querySelector<HTMLElement>('.avatar')!;
  avatar.textContent = initials(c.name);
  avatar.style.background = c.palette.bg;
  avatar.style.borderColor = c.palette.border;
  avatar.style.color = c.palette.accent;
  node.querySelector('h1')!.textContent = c.name;
  node.querySelector('.tagline')!.textContent = c.tagline;
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
        <section class="screen">
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
        <section class="screen">
          <h1>${COPY.fandom.title}</h1>
          <p class="lead">${COPY.fandom.lead}</p>
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
        <section class="screen">
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
window.circe.ready();
