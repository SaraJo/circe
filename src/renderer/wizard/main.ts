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
