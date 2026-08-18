import type { Character, WizardStep } from '../../shared/types';
import { COPY } from './copy';

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

/**
 * What `fandom.stuck` ("Not sure? Give me some ideas") actually does:
 * drops one of these into the input, so the escape hatch gives the user a
 * real, concrete option rather than nothing. Deliberately not a model call —
 * this has to be instant, and picking from a short curated list is honest
 * about what it is (a nudge, not a suggestion engine).
 */
const FANDOM_IDEAS = [
  "Terry Pratchett's Discworld",
  'a decades-long D&D campaign',
  'competitive bread baking',
  'a group chat that never sleeps',
  'Formula 1',
  'the Marvel universe',
  'birdwatching',
  'a college a cappella group',
];

function randomFandomIdea(current: string): string {
  const pool = FANDOM_IDEAS.filter((idea) => idea !== current);
  return pool[Math.floor(Math.random() * pool.length)] ?? FANDOM_IDEAS[0]!;
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
  node.querySelector('#accept')!.textContent = COPY.meet.action.replace('{{NAME}}', c.name);
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
          <p class="lead">${COPY.welcome.sub}</p>
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

    case 'provider-missing':
      screenEl.append(
        el(`
        <section class="screen">
          <h1>${COPY.provider.title}</h1>
          <p class="lead">${COPY.provider.lead}</p>
        </section>
      `),
      );
      break;

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
      node.querySelector('#stuck')!.addEventListener('click', () => {
        input.value = randomFandomIdea(input.value);
        input.focus();
      });
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
          <h1>That didn't work</h1>
          <p class="lead"></p>
          <div class="actions">
            <button class="primary" id="retry">Try again</button>
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
          <h1>You already have an agent here</h1>
          <p class="lead"></p>
          <div class="actions">
            <button class="primary" id="confirm">Replace it</button>
            <button class="quiet" id="decline">Keep what I have</button>
          </div>
        </section>
      `);
      node.querySelector('.lead')!.textContent =
        `This machine's main Hermes agent is ${step.existingName}. Setting up ` +
        `${step.character.name} replaces it. Your old persona is saved to a backup ` +
        `file first, and none of your other agents are touched.`;
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
          <h1>Setting <span class="name"></span> up…</h1>
          <p class="lead">Writing the persona and installing the skill.</p>
          <div class="spinner"></div>
        </section>
      `);
      node.querySelector('.name')!.textContent = step.character.name;
      screenEl.append(node);
      break;
    }

    case 'write-failed': {
      const node = el(`
        <section class="screen">
          <h1>Couldn't finish the setup</h1>
          <p class="lead"></p>
          <p class="status"></p>
          <div class="actions">
            <button class="primary" id="retry-write">Try again</button>
          </div>
        </section>
      `);
      // Two different truths behind one failure. Claiming "untouched" when the
      // persona has in fact been replaced is a false statement about the
      // user's own data, and it steers them away from the backup that exists.
      node.querySelector('.lead')!.textContent = step.personaReplaced
        ? `Something went wrong setting up ${step.character.name}, and no agent was ` +
          `started, but your ${step.personaReplaced.path} had already been replaced by ` +
          `then.` +
          (step.personaReplaced.backedUpTo
            ? ` Your previous version was saved to ${step.personaReplaced.backedUpTo}.`
            : ` There was no earlier version worth keeping, so no backup was made.`)
        : `Something went wrong writing ${step.character.name} to your Hermes home, so ` +
          `nothing was changed and no agent was started. Your existing setup is untouched.`;
      node.querySelector('.status')!.textContent = step.message;
      node.querySelector('#retry-write')!.addEventListener('click', () => window.circe.accept());
      screenEl.append(node);
      break;
    }

    case 'launching': {
      const node = el(`
        <section class="screen">
          <h1>Starting <span class="name"></span>…</h1>
        </section>
      `);
      node.querySelector('.name')!.textContent = step.character.name;
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
