import type { Character, WizardStep } from '../../shared/types';

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
    <section class="screen">
      <div class="preview">
        <div class="avatar"></div>
        <h1></h1>
        <p class="tagline"></p>
      </div>
      <p class="why"></p>
      <div class="actions">
        <button class="primary" id="accept"></button>
        <button class="quiet" id="another">Try another character</button>
      </div>
    </section>
  `);
  const avatar = node.querySelector<HTMLElement>('.avatar')!;
  avatar.textContent = initials(c.name);
  avatar.style.background = c.palette.bg;
  avatar.style.borderColor = c.palette.border;
  avatar.style.color = c.palette.accent;
  node.querySelector('h1')!.textContent = c.name;
  node.querySelector('.tagline')!.textContent = c.tagline;
  node.querySelector('.why')!.textContent = c.why;
  node.querySelector('#accept')!.textContent = `Start with ${c.name}`;
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
          <h1>Circe</h1>
          <p class="lead">A home for your AI agents. Assistants that live on your
          desktop, each with its own personality, memory, and job.</p>
          <p class="lead">In the next few minutes you'll meet your first one: a
          coordinator whose job is to help you build the rest.</p>
          <p class="status">Checking for Hermes…</p>
        </section>
      `),
      );
      break;

    case 'runtime-missing': {
      const node = el(`
        <section class="screen">
          <h1>Circe needs Hermes</h1>
          <p class="lead">Circe runs on Hermes, an open-source agent
          runtime. It isn't installed on this machine yet.</p>
          <div class="actions">
            <button class="primary" id="install">Get Hermes</button>
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
          <h1>Connect a model</h1>
          <p class="lead">Your agent needs a model to think with. Hermes handles
          this. Run <code>hermes setup</code> in a terminal, then reopen Circe.</p>
        </section>
      `),
      );
      break;

    case 'fandom': {
      const node = el(`
        <section class="screen">
          <h1>What do you love?</h1>
          <p class="lead">Name a fandom, a universe, or a community. Your agent gets
          its name and its colours from that world, and so does every agent you add
          later, so the crew hangs together.</p>
          <input id="fandom" placeholder="Hitchhiker's Guide, the Wire, competitive bread baking…" autofocus />
          <div class="actions">
            <button class="primary" id="go">Continue</button>
          </div>
        </section>
      `);
      const input = node.querySelector<HTMLInputElement>('#fandom')!;
      const submit = () => window.circe.submitFandom(input.value);
      node.querySelector('#go')!.addEventListener('click', submit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submit();
      });
      screenEl.append(node);
      input.focus();
      break;
    }

    case 'deriving': {
      const node = el(`
        <section class="screen">
          <h1>Finding your coordinator</h1>
          <p class="lead">Looking through <span class="fandom"></span> for the one who
          keeps track of everyone else. This can take up to a minute.</p>
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
