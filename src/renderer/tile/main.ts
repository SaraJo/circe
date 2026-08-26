import { marked } from 'marked';
import type { Character } from '../../shared/types';
import { DEFAULT_PALETTE, isPalette, paletteVars } from '../../main/palette';
import { applyFace, initials } from '../face';
import { nextToolTitle, toolLabel } from './toolLabel';
import { commandPreview, permissionOutcomeLabel } from './permission';

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
  onCharacter(cb: (character: unknown) => void): void;
  onAvatar(cb: (dataUrl: string | null) => void): void;
  send(text: string): void;
  close(): void;
  answerPermission(id: number, choice: string): void;
  openExternal(url: string): void;
}
const circe = (window as unknown as { circe: TileApi }).circe;

/**
 * A character from either source, or null. Shared by the URL parse and the
 * live `tile:character` update so both hold to the same rule: an object with
 * a `name`. Everything else is checked where it is used (`isPalette` below),
 * because a partial character still names the agent correctly.
 */
function asCharacter(parsed: unknown): Character | null {
  if (!parsed || typeof parsed !== 'object') return null;
  if (typeof (parsed as Partial<Character>).name !== 'string') return null;
  return parsed as Character;
}

/** `createTileWindow` passes the character as JSON in the URL; guard the parse. */
function parseCharacter(raw: string | null): Character | null {
  if (!raw) return null;
  try {
    return asCharacter(JSON.parse(raw));
  } catch {
    return null;
  }
}

const params = new URLSearchParams(location.search);
const character = parseCharacter(params.get('character'));

const log = document.getElementById('log')!;
const input = document.getElementById('input') as HTMLTextAreaElement;
const face = document.getElementById('face')!;

/**
 * Draws who this tile belongs to: its colours, its heading, and the name in
 * the composer — the difference between a text field and a conversation.
 *
 * Called once for the character in the URL and again whenever the main
 * process re-reads the profile, which happens because `SOUL.md` and
 * `circe.json` do not arrive together (the orchestrator writes the second
 * seconds after the first) and because either can be edited by hand.
 *
 * `palette` came through a check on `name` alone, so a malformed value
 * (`"palette": 5`, a partial object, a channel that isn't a hex string) must
 * fall back the same way a *missing* one does rather than reach `paletteVars`
 * and throw — at module top level that would kill this whole script before
 * `circe.onUpdate`/`onOpening` are ever wired up.
 */
function applyCharacter(c: Character | null): void {
  const palette = isPalette(c?.palette) ? c.palette : DEFAULT_PALETTE;
  for (const [k, v] of Object.entries(paletteVars(palette))) {
    document.documentElement.style.setProperty(k, v);
  }
  const name = c?.name ?? 'Circe';
  document.getElementById('who')!.textContent = name;
  // The initials fall back with `#who`'s own name, so a malformed or missing
  // character never leaves the two disagreeing about who this tile is.
  face.textContent = initials(name);
  input.placeholder = `Message ${name}…`;
}

applyCharacter(character);

/** The element the current streaming reply is accumulating into. */
let streaming: HTMLElement | null = null;
/** The single "⚙ …" bubble showing what the agent is doing this turn. */
let toolBubble: HTMLElement | null = null;
/**
 * The tool name currently on that bubble. Held because ACP sends `title` only
 * when it changes, so a status-only `tool_call_update` has none to draw with
 * and has to reuse this. Reset wherever `toolBubble` is: a new turn inheriting
 * the last turn's tool name is the same class of lie as the raw id was.
 */
let toolTitle = '';
/**
 * True between `circe/replay-start` and `circe/replay-end`, while Hermes is
 * replaying a resumed conversation. Two things differ during a replay: the
 * user's own messages have to be drawn (nothing typed them into this window),
 * and each message ends a turn, because a replay has no `session/prompt` to
 * resolve and would otherwise concatenate every agent reply in the history into
 * one bubble.
 */
let replaying = false;

/**
 * Plain-text bubble. Used for the user's own messages, the opening handoff
 * message and Amendment 1's connection-failure notices (both of which are
 * Circe's own prose — two string interpolations and no Markdown, see
 * `openingMessage`), and the malformed-character notice. Always `textContent`,
 * never `innerHTML` — there is no Markdown to render here, so there is no
 * reason to route any of it through `marked`. The `plain` class carries
 * `white-space: pre-wrap` (tile.css), which preserves the opening message's
 * hard newlines without needing `<br>`; it is dropped from the streaming
 * bubble at the end of a turn, when its text becomes rendered Markdown and
 * `pre-wrap` would turn the newlines *between* block elements into stray
 * blank lines.
 */
function appendText(role: 'user' | 'agent' | 'error' | 'tool', text: string): HTMLElement {
  const node = document.createElement('div');
  node.className = `msg ${role} plain`;
  node.textContent = text;
  log.append(node);
  log.scrollTop = log.scrollHeight;
  return node;
}

function permissionCard(id: number, description: string, command: string): HTMLElement {
  const card = document.createElement('section');
  card.className = 'permission';
  card.dataset.permission = String(id);

  const heading = document.createElement('div');
  heading.className = 'permission-heading';
  heading.textContent = description.trim() || 'This action needs your approval';
  card.append(heading);

  const { lines, overflow } = commandPreview(command);
  const preview = document.createElement('pre');
  preview.className = 'permission-command';
  preview.textContent = lines.join('\n');
  card.append(preview);

  if (overflow > 0) {
    const more = document.createElement('div');
    more.className = 'permission-more';
    more.textContent = `+${overflow} more line${overflow === 1 ? '' : 's'}`;
    card.append(more);
  }

  const actions = document.createElement('div');
  actions.className = 'permission-actions';
  for (const [choice, label] of [
    ['allow_once', 'Allow once'],
    ['allow_session', 'Allow session'],
    ['deny', 'Deny'],
  ] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    if (choice === 'deny') button.className = 'deny';
    button.addEventListener('click', () => circe.answerPermission(id, choice));
    actions.append(button);
  }
  card.append(actions);
  return card;
}

/**
 * ACP content blocks are `{ type: 'text', text }`, but the field can also
 * arrive as a bare string or an array of blocks — mirrors the prototype's
 * `extractText` (renderer.js:356), which is what runs against the real
 * runtime today.
 */
function extractText(content: unknown): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(extractText).join('');
  const text = (content as { text?: unknown }).text;
  return typeof text === 'string' ? text : '';
}

/**
 * Ends the current turn: the streamed plain text becomes rendered Markdown,
 * and the tool bubble stops being the live one. Driven by `session/prompt`
 * *resolving* in the main process, which is how ACP signals turn completion
 * (it answers with `{ stopReason }`) — there is no `agent_message_complete`
 * update kind, and finalizing on one meant every reply concatenated into the
 * first bubble and the Markdown pass never ran at all.
 */
function endTurn(): void {
  if (streaming) {
    // The only place model output reaches `innerHTML` (Amendment 3) — a
    // completed agent reply, converted from the plain text it streamed in
    // as. Contained by the tile's CSP (no `script-src 'unsafe-inline'`) and
    // by the navigation guards in `windows.ts`.
    streaming.innerHTML = marked.parse(streaming.textContent ?? '') as string;
    streaming.classList.remove('plain');
    streaming.classList.add('md');
    streaming = null;
  }
  toolBubble = null;
  toolTitle = '';
  log.scrollTop = log.scrollHeight; // Markdown formatting can change the bubble's height.
}

if (!character) {
  appendText(
    'error',
    "This tile couldn't read its agent's details, so it's showing default colours. " +
      'Close it and start over from the wizard.',
  );
}

circe.onOpening((text) => {
  appendText('agent', text);
});

// Arrives on its own channel because a base64 PNG does not fit in the window
// URL alongside the rest of the character (see `main/tiles.ts`). A null here
// is the ordinary case, not an error: the initials stay showing underneath.
circe.onAvatar((url) => applyFace(face, url));

// A re-theme that arrives malformed leaves the tile as it is: `asCharacter`
// returns null, and applying null would reset a correctly-themed tile to the
// default. Losing an update costs colours; applying a bad one costs identity.
circe.onCharacter((c) => {
  const next = asCharacter(c);
  if (next) applyCharacter(next);
});

/**
 * The update kinds this tile acts on. The first four are real ACP
 * `session/update` kinds and are exactly the ones the working prototype
 * handles (renderer.js:377-418); the `circe/` ones are Circe's own lifecycle
 * events, namespaced so they can't ever collide with a protocol kind.
 */
circe.onUpdate((update) => {
  const u = update as { sessionUpdate?: string; content?: unknown; title?: string };
  switch (u.sessionUpdate) {
    case 'agent_message_chunk': {
      const piece = extractText(u.content);
      if (!piece) return;
      if (!streaming) streaming = appendText('agent', '');
      streaming.textContent = (streaming.textContent ?? '') + piece;
      log.scrollTop = log.scrollHeight;
      return;
    }
    // One reused bubble per turn, overwritten as the agent moves between
    // tools. Without it a long tool-using turn looks like a frozen tile —
    // nothing streams while the agent is working. Deliberately minimal: a
    // label, not a tool UI.
    case 'tool_call':
    case 'tool_call_update': {
      // `title` is required on `tool_call` and optional on every
      // `tool_call_update`, so a status change arrives with no name of its
      // own. This used to fall back to the `toolCallId`, which drew
      // `⚙ toolu_01VsyAkmt8QqNFMnbPNhP96g` over a perfectly good `⚙ Read` the
      // moment that read finished. See `toolLabel.ts`.
      toolTitle = nextToolTitle(update, toolTitle);
      const label = toolLabel(toolTitle);
      if (toolBubble) toolBubble.textContent = label;
      else toolBubble = appendText('tool', label);
      log.scrollTop = log.scrollHeight;
      return;
    }
    case 'user_message_chunk': {
      if (!replaying) return; // live turns are drawn by the input handler
      const piece = extractText(u.content);
      if (!piece) return;
      endTurn();
      appendText('user', piece);
      return;
    }
    case 'circe/replay-start':
      replaying = true;
      return;
    case 'circe/replay-end':
      replaying = false;
      // Closes the last replayed agent message, which has no turn-end of its own.
      endTurn();
      return;
    // The resume failed after Hermes had already replayed part of the
    // conversation — it emits history *before* it answers `session/load`, so
    // those bubbles are on screen by the time anyone knows it went wrong. They
    // belong to a session this tile is not on and the live agent has no memory
    // of, so they go: a tile showing a conversation that isn't there is the
    // tile lying by omission. What replaces them says only what is known.
    //
    // What the user typed themselves is not part of that lie. Those bubbles
    // were drawn locally by the input handler below, the messages behind them
    // were held for the fresh session, and they are about to be answered — so
    // clearing without putting them back leaves the agent replying to a
    // question no longer on screen, which is the same misleading transcript
    // this notice exists to prevent, reached from the other side. `held`
    // carries them, in order, as of the moment the log was cleared.
    case 'circe/replay-abandoned': {
      replaying = false;
      streaming = null;
      toolBubble = null;
  toolTitle = '';
      log.replaceChildren();
      appendText('agent', "Couldn't reopen the previous conversation, so I'm starting a new one.");
      const held = (update as { held?: unknown }).held;
      if (Array.isArray(held)) {
        for (const text of held) if (typeof text === 'string') appendText('user', text);
      }
      return;
    }
    case 'circe/turn-end':
      endTurn();
      return;
    case 'circe/permission': {
      const request = update as { id?: unknown; description?: unknown; command?: unknown };
      if (typeof request.id !== 'number' || typeof request.command !== 'string' || !request.command) return;
      log.append(
        permissionCard(
          request.id,
          typeof request.description === 'string' ? request.description : '',
          request.command,
        ),
      );
      log.scrollTop = log.scrollHeight;
      return;
    }
    case 'circe/permission-resolved': {
      const result = update as { id?: unknown; outcome?: unknown };
      if (typeof result.id !== 'number') return;
      const card = log.querySelector(`[data-permission="${result.id}"]`);
      if (!card) return;
      card.classList.add('resolved');
      const outcome = document.createElement('div');
      outcome.className = 'permission-outcome';
      outcome.textContent = permissionOutcomeLabel(result.outcome);
      card.querySelector('.permission-actions')?.replaceWith(outcome);
      return;
    }
    // The agent process died. Without this the tile just goes quiet forever
    // and the user has no way to tell a dead agent from a thinking one.
    case 'circe/exited': {
      endTurn();
      const code = (update as { code?: number | null }).code;
      appendText('error', `The agent stopped (exit code ${code ?? 'unknown'}).`);
      return;
    }
  }
});

/**
 * Links in an agent reply open in the user's browser. The tile itself can no
 * longer navigate (`pinToItsOwnDocument`), and it must not: its preload hands
 * `window.circe.send()` to whatever document is loaded, so navigating it to a
 * page the model chose would hand that page the user's agent. `preventDefault`
 * here means the guard in the main process is never the thing the user
 * notices; the main process still vets the scheme before the OS sees it.
 */
log.addEventListener('click', (e) => {
  const anchor = (e.target as HTMLElement | null)?.closest?.('a');
  if (!anchor) return;
  e.preventDefault();
  const href = anchor.getAttribute('href');
  if (href) circe.openExternal(href);
});

/**
 * The one path a message leaves by, so the Send button and the Enter key
 * cannot drift apart — two copies of this is how one of them ends up not
 * resetting the streaming bubble.
 */
function sendCurrentInput(): void {
  const text = input.value.trim();
  if (!text) return;
  // A new turn never continues the previous turn's bubbles, even if the last
  // one ended abnormally (the prototype resets the same state on send,
  // renderer.js:583).
  streaming = null;
  toolBubble = null;
  toolTitle = '';
  appendText('user', text);
  circe.send(text);
  input.value = '';
  input.focus();
}

input.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.shiftKey) return;
  e.preventDefault();
  sendCurrentInput();
});

document.getElementById('send')!.addEventListener('click', () => sendCurrentInput());
