import { marked } from 'marked';
import type { Character, Palette } from '../../shared/types';
import { paletteVars } from '../../main/palette';

/**
 * The tile and the wizard each load their own preload bridge and never share
 * a window, but `tsconfig.json` compiles every renderer as one TS program —
 * so a `declare global { interface Window { circe: ... } }` here would merge
 * with the wizard's differently-shaped one and fail the typecheck. A local
 * cast keeps this file's bridge shape scoped to this file.
 */
interface TileApi {
  onUpdate(cb: (u: Record<string, unknown>) => void): void;
  onOpening(cb: (text: string) => void): void;
  send(text: string): void;
  close(): void;
}
const circe = (window as unknown as { circe: TileApi }).circe;

/**
 * Falls back to when the `character` query parameter is missing or malformed
 * (Amendment 4) — a tile with default colours and a visible error beats a
 * blank window.
 */
const DEFAULT_PALETTE: Palette = { bg: '#1e1e2a', border: '#4b5563', accent: '#9ca3af' };

/** `createTileWindow` passes the character as JSON in the URL; guard the parse. */
function parseCharacter(raw: string | null): Character | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Character> | null;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.name !== 'string') return null;
    return parsed as Character;
  } catch {
    return null;
  }
}

const params = new URLSearchParams(location.search);
const character = parseCharacter(params.get('character'));

for (const [k, v] of Object.entries(paletteVars(character?.palette ?? DEFAULT_PALETTE))) {
  document.documentElement.style.setProperty(k, v);
}
document.getElementById('who')!.textContent = character?.name ?? 'Circe';

const log = document.getElementById('log')!;
const input = document.getElementById('input') as HTMLTextAreaElement;

/** The element the current streaming reply is accumulating into. */
let streaming: HTMLElement | null = null;

/**
 * `agent` text is Markdown from the model and goes through `marked` into
 * `innerHTML` (Amendment 3) — contained by the tile's CSP (no
 * `script-src 'unsafe-inline'`), so injected markup can't execute. `user` and
 * `error` text is plain and always goes through `textContent`.
 */
function append(role: 'user' | 'agent' | 'error', text: string): HTMLElement {
  const node = document.createElement('div');
  node.className = `msg ${role}`;
  if (role === 'agent') {
    node.innerHTML = marked.parse(text) as string;
  } else {
    node.textContent = text;
  }
  log.append(node);
  log.scrollTop = log.scrollHeight;
  return node;
}

if (!character) {
  append(
    'error',
    "This tile couldn't read its agent's details, so it's showing default colours. " +
      'Close it and start over from the wizard.',
  );
}

circe.onOpening((text) => {
  append('agent', text);
});

circe.onUpdate((update) => {
  const u = update as { sessionUpdate?: string; content?: { text?: string } };
  if (u.sessionUpdate === 'agent_message_chunk' && u.content?.text) {
    if (!streaming) streaming = append('agent', '');
    streaming.textContent = (streaming.textContent ?? '') + u.content.text;
    log.scrollTop = log.scrollHeight;
  }
  if (u.sessionUpdate === 'agent_message_complete' && streaming) {
    streaming.innerHTML = marked.parse(streaming.textContent ?? '') as string;
    streaming = null;
  }
});

input.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.shiftKey) return;
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  append('user', text);
  circe.send(text);
  input.value = '';
});

document.getElementById('close')!.addEventListener('click', () => circe.close());
