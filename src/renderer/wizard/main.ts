import { el, button, loader } from '../ui/primitives';

declare global {
  interface Window {
    wizard: {
      start(): Promise<string>;
      goto(screen: string): Promise<void>;
      back(): Promise<void>;
      detectRuntime(): Promise<{ installed: boolean; version: string | null; message: string }>;
      detectProfiles(): Promise<{ next: string; profiles: any[] }>;
      createAgent(payload: unknown): Promise<any>;
      listProviders(): Promise<{ id: string; label: string }[]>;
      loginProvider(provider: string): Promise<{ ok: boolean; message: string }>;
      launchFleet(): Promise<{ launched: number }>;
      on(channel: string, handler: (payload: any) => void): void;
    };
  }
}

const root = document.getElementById('screen')!;

export function render(nodes: (Node | string)[]) {
  root.replaceChildren(...nodes.map((n) => (typeof n === 'string' ? document.createTextNode(n) : n)));
}

function actions(...buttons: HTMLElement[]) {
  const wrap = el('div', 'actions');
  wrap.append(...buttons);
  return wrap;
}

const SCREENS: Record<string, () => void | Promise<void>> = {
  welcome() {
    render([
      el('h1', undefined, 'Circe'),
      el('p', undefined, 'Set up your agents.'),
      actions(
        button('Get started', () => go('runtime'), 'primary'),
        button('I already have Hermes running — skip ahead', () => go('profiles'), 'quiet'),
      ),
    ]);
  },

  async runtime() {
    const status = el('p', undefined, 'Checking for the Hermes runtime…');
    const row = el('div', 'row');
    row.append(loader(), status);
    render([el('h1', undefined, 'Runtime'), row]);

    const result = await window.wizard.detectRuntime();
    if (result.installed) {
      status.textContent = `Hermes ${result.version} is installed.`;
      row.firstChild?.remove();
      setTimeout(() => go('profiles'), 600); // advances in about a second (§6 Screen 2)
      return;
    }
    row.firstChild?.remove();
    status.textContent = result.message;
    render([
      el('h1', undefined, 'Runtime'),
      status,
      actions(
        button('Retry', () => go('runtime'), 'primary'),
        button('Back', () => window.wizard.back().then(boot), 'quiet'),
      ),
    ]);
  },

  async profiles() {
    render([el('h1', undefined, 'Profiles'), el('p', undefined, 'Looking for existing agents…')]);
    const { next, profiles } = await window.wizard.detectProfiles();
    if (next === 'create') {
      go('create');
      return;
    }
    const real = profiles.filter((p: any) => p.real);
    render([
      el('h1', undefined, 'Existing agents'),
      el('p', undefined, `Found ${real.length}. Circe will use them as they are.`),
      ...real.map((p: any) => el('div', 'row', `${p.displayName}${p.tagline ? ` — ${p.tagline}` : ''}`)),
      actions(button('Continue', () => go('provider'), 'primary')),
    ]);
  },

  async create() {
    const { CASTS, DEFAULT_CAST_ID, suggestCharacter } = await import('../../shared/casts');
    let castId: string = DEFAULT_CAST_ID;

    const draw = async () => {
      const { profiles } = await window.wizard.detectProfiles();
      const taken = profiles.map((p: any) => p.id);
      const character = suggestCharacter(castId, taken);

      const picker = (await import('../ui/primitives')).segmented(
        CASTS.map((c) => ({ id: c.id, label: c.label })),
        castId,
        (id) => {
          castId = id;
          void draw();
        },
      );

      const card = el('div');
      if (character) {
        card.append(
          el('div', 'row', `${character.name} — ${character.tagline}`),
          el('p', undefined, `Accent ${character.palette.accent} · background ${character.palette.background}`),
        );
      } else {
        card.append(el('p', undefined, 'Type a name for this agent on the next step.'));
      }

      render([
        el('h1', undefined, 'Your first agent'),
        picker,
        card,
        actions(
          button(
            'Start with this agent',
            async () => {
              if (!character) return go('walkthrough');
              await window.wizard.createAgent({
                castId,
                characterName: character.name,
                makeMainOperator: true,
              });
              return go('provider');
            },
            'primary',
          ),
          button('Customize this agent', () => go('walkthrough')),
        ),
      ]);
    };

    await draw();
  },

  async walkthrough() {
    // Phase 1 ships name, palette, and the §5.5 role picker. Avatar and the
    // full five-panel flow are Phase 2.
    const name = el('input') as HTMLInputElement;
    name.className = 'input';
    name.placeholder = 'Name';

    const accent = el('input') as HTMLInputElement;
    accent.type = 'color';
    accent.value = '#8b7fd4';

    const background = el('input') as HTMLInputElement;
    background.type = 'color';
    background.value = '#1a1820';

    const coding = el('input') as HTMLInputElement;
    coding.type = 'checkbox';
    const codingLabel = el('label', 'row');
    codingLabel.append(coding, document.createTextNode('Coding / writes files'));

    const error = el('p', 'state--error');

    render([
      el('h1', undefined, 'New agent'),
      name,
      el('div', 'row'),
      accent,
      background,
      codingLabel,
      error,
      actions(
        button(
          'Save',
          async () => {
            const value = name.value.trim();
            if (!value) {
              error.textContent = 'Name can’t be empty.';
              return;
            }
            try {
              await window.wizard.createAgent({
                castId: 'custom',
                characterName: value,
                profileId: value.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                palette: { accent: accent.value, background: background.value },
                isCodingProfile: coding.checked,
                makeMainOperator: true,
              });
              await go('provider');
            } catch (err) {
              error.textContent = (err as Error).message;
            }
          },
          'primary',
        ),
        button('Back', () => window.wizard.back().then(boot), 'quiet'),
      ),
    ]);
  },

  async provider() {
    const providers = await window.wizard.listProviders();
    const status = el('p');
    const detail = el('div');

    window.wizard.on('wizard:device-code', (p: { url: string; code: string }) => {
      detail.replaceChildren(
        el('p', undefined, `Open ${p.url} and enter this code:`),
        el('div', 'code', p.code),
      );
    });

    render([
      el('h1', undefined, 'Connect a provider'),
      el('p', undefined, 'Your agents need a model provider to talk to.'),
      actions(
        ...providers.map((p) =>
          button(p.label, async () => {
            status.textContent = 'Waiting for sign-in…';
            const result = await window.wizard.loginProvider(p.id);
            status.textContent = result.message;
            if (result.ok) await go('ready');
          }),
        ),
      ),
      // §6 Screen 6 requires this path to work whatever else fails.
      actions(button('Skip — I’ll connect a provider later', () => go('ready'), 'quiet')),
      status,
      detail,
    ]);
  },
};

async function go(screen: string) {
  await window.wizard.goto(screen);
  await SCREENS[screen]?.();
}

async function boot() {
  const screen = await window.wizard.start();
  await (SCREENS[screen] ?? SCREENS.welcome!)();
}

boot();
