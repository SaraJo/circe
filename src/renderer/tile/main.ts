import { initialFor } from '../../shared/casts';
import { el, button } from '../ui/primitives';
import type { TileInitPayload, ChunkPayload, DeniedPayload, PermissionAskPayload } from '../../shared/ipc';

declare global {
  interface Window {
    circe: {
      profileId: string;
      send(text: string): Promise<void>;
      cycleGate(): Promise<{ gateMode: string }>;
      resolvePermission(requestKey: string, optionId: string | null): Promise<boolean>;
      restart(): Promise<void>;
      on(event: string, handler: (payload: any) => void): void;
    };
  }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const transcript = $('transcript');
const input = $<HTMLInputElement>('input');
const sendBtn = $<HTMLButtonElement>('send');
const gateBtn = $<HTMLButtonElement>('gate');

const GATE_LABEL: Record<string, string> = { locked: '🔒', ask: '⛔', unlocked: '🔓' };

let streamingEl: HTMLElement | null = null;
let busy = false;

function addMessage(role: string, text: string, kind?: string): HTMLElement {
  const node = el('div', `msg ${role}${kind ? ` ${kind}` : ''}`, text);
  transcript.append(node);
  transcript.scrollTop = transcript.scrollHeight;
  return node;
}

function setBusy(value: boolean) {
  busy = value;
  sendBtn.textContent = value ? 'Stop' : 'Send';
}

window.circe.on('init', (p: TileInitPayload) => {
  document.documentElement.style.setProperty('--accent', p.palette.accent);
  document.documentElement.style.setProperty('--bg', p.palette.background);
  $('name').textContent = p.displayName;
  $('model').textContent = p.model ?? '';
  $('avatar').textContent = initialFor(p.displayName);
  gateBtn.textContent = GATE_LABEL[p.gateMode] ?? '🔓';
  for (const m of p.messages) addMessage(m.role, m.text, m.kind);
});

window.circe.on('chunk', (p: ChunkPayload) => {
  if (!streamingEl) streamingEl = addMessage('agent', '');
  streamingEl.textContent += p.text;
  transcript.scrollTop = transcript.scrollHeight;
});

window.circe.on('turnEnd', () => {
  streamingEl = null;
  setBusy(false);
});

window.circe.on('denied', (p: DeniedPayload) => {
  addMessage('tool', `Denied: ${p.title}`, 'denied');
});

window.circe.on('permissionAsk', (p: PermissionAskPayload) => {
  const card = el('div', 'permission');
  card.append(el('span', undefined, `${p.title}?`));
  for (const opt of p.options) {
    card.append(
      button(opt.name, async () => {
        await window.circe.resolvePermission(p.requestKey, opt.optionId);
        card.remove();
      }),
    );
  }
  transcript.append(card);
  transcript.scrollTop = transcript.scrollHeight;
});

window.circe.on('gateChanged', (p: { gateMode: string }) => {
  gateBtn.textContent = GATE_LABEL[p.gateMode] ?? '🔓';
});

window.circe.on('agentStopped', (p: { message: string }) => {
  const card = el('div', 'msg agent error', p.message);
  card.append(button('Restart', () => window.circe.restart()));
  transcript.append(card);
  setBusy(false);
});

async function submit() {
  const text = input.value.trim();
  if (!text || busy) return;
  input.value = '';
  addMessage('user', text);
  setBusy(true);
  await window.circe.send(text);
}

sendBtn.addEventListener('click', submit);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submit();
});
gateBtn.addEventListener('click', () => window.circe.cycleGate());
