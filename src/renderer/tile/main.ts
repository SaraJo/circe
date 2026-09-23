import { IMAGE_TYPES, MAX_IMAGE_BYTES, isImageAttachment, isTilePrompt, type ImageAttachment, type TilePrompt } from '../../shared/prompt';
import type { Character, TileTabsView } from '../../shared/types';
import { DEFAULT_PALETTE, isPalette, paletteVars } from '../../main/palette';
import { applyFace, initials } from '../face';
import { nextToolTitle, toolLabel } from './toolLabel';
import { commandPreview, permissionOutcomeLabel } from './permission';
import { renderMarkdown } from './markdown';
import {
  compactTokenCount,
  contextPressure,
  likelyCompacted,
  type ContextPressure,
} from './contextPressure';

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
  onTabs(cb: (tabs: unknown) => void): void;
  send(text: TilePrompt): void;
  newTab(): void;
  switchTab(index: number): void;
  clearTab(): void;
  rollover(): void;
  replaceAvatar(): void;
  closeTab(index: number): void;
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
const isOrchestrator = params.get('orchestrator') === 'true';

const log = document.getElementById('log')!;
const permissions = document.getElementById('permissions')!;
const input = document.getElementById('input') as HTMLTextAreaElement;
const modelLabel = document.getElementById('model')!;
const face = document.getElementById('face') as HTMLButtonElement;
const tabs = document.getElementById('tabs')!;
const tabList = document.getElementById('tab-list')!;
const tabsLeft = document.getElementById('tabs-left') as HTMLButtonElement;
const tabsRight = document.getElementById('tabs-right') as HTMLButtonElement;
const newTab = document.getElementById('new-tab') as HTMLButtonElement;
const contextHealth = document.getElementById('context-health')!;
const contextHealthLabel = document.getElementById('context-health-label')!;
const contextHealthValue = document.getElementById('context-health-value')!;
const contextHealthFill = document.getElementById('context-health-fill')!;
const contextHealthAdvice = document.getElementById('context-health-advice')!;
const contextHealthMessage = document.getElementById('context-health-message')!;
const handoff = document.getElementById('handoff') as HTMLButtonElement;
let tabsView: TileTabsView | null = null;
let pressure: ContextPressure | null = null;
let previousUsed = 0;
let compactionCount = 0;
let handoffRunning = false;

if (isOrchestrator) {
  document.getElementById('orchestrator-help')!.hidden = false;
}

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
  face.setAttribute('aria-label', `Replace ${name}'s avatar`);
  input.placeholder = `Message ${name}…`;
}

applyCharacter(character);
face.addEventListener('click', () => circe.replaceAvatar());

/** The element the current streaming reply is accumulating into. */
let streaming: HTMLElement | null = null;
/** Markdown source for `streaming`; never recover it from rendered DOM text. */
let streamingMarkdown = '';
/** At most one Markdown parse per animation frame while token chunks arrive. */
let markdownFrame: number | null = null;
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

function asTabsView(value: unknown): TileTabsView | null {
  if (!value || typeof value !== 'object') return null;
  const view = value as Partial<TileTabsView>;
  if (!Number.isInteger(view.count) || (view.count ?? -1) < 0) return null;
  if (!Number.isInteger(view.activeIndex) || (view.activeIndex ?? -1) < 0) return null;
  if (typeof view.busy !== 'boolean' || typeof view.supported !== 'boolean') return null;
  if (view.titles !== undefined && (!Array.isArray(view.titles) ||
    !view.titles.every((title) => typeof title === 'string'))) return null;
  if (view.canCreate !== undefined && typeof view.canCreate !== 'boolean') return null;
  if (view.canSwitch !== undefined && typeof view.canSwitch !== 'boolean') return null;
  if (view.canClose !== undefined && typeof view.canClose !== 'boolean') return null;
  if (view.model != null && typeof view.model !== 'string') return null;
  return view as TileTabsView;
}

function updateTabScroll(): void {
  // Compare against the room available without arrows, so hiding them cannot
  // make the controls oscillate at the overflow boundary.
  const gap = parseFloat(getComputedStyle(tabs).columnGap) || 0;
  const available = tabs.clientWidth - newTab.getBoundingClientRect().width - gap;
  const overflowing = tabList.scrollWidth > available + 1;
  tabsLeft.hidden = !overflowing;
  tabsRight.hidden = !overflowing;
  tabsLeft.disabled = tabList.scrollLeft <= 1;
  tabsRight.disabled = tabList.scrollLeft + tabList.clientWidth >= tabList.scrollWidth - 1;
}
for (const [button, direction] of [[tabsLeft, -1], [tabsRight, 1]] as const) {
  button.addEventListener('click', () => tabList.scrollBy({
    left: direction * Math.max(100, tabList.clientWidth * 0.75), behavior: 'smooth',
  }));
}
tabList.addEventListener('scroll', updateTabScroll);
new ResizeObserver(updateTabScroll).observe(tabList);
tabList.addEventListener('wheel', (event) => {
  if (tabList.scrollWidth <= tabList.clientWidth) return;
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? tabList.clientWidth : 1;
  tabList.scrollLeft += delta * scale;
  event.preventDefault();
}, { passive: false });

function renderTabs(view: TileTabsView): void {
  const revealActive = !tabsView || !tabsView.supported ||
    tabsView.activeIndex !== view.activeIndex || tabsView.count !== view.count;
  const scrollLeft = tabList.scrollLeft;
  tabsView = view;
  modelLabel.textContent = view.model || 'Unavailable';
  modelLabel.title = view.model
    ? `Conversation model reported by Hermes: ${view.model}`
    : 'Hermes has not reported a model for this conversation.';
  tabs.hidden = !view.supported;
  if (!view.supported) return;
  tabList.replaceChildren();
  for (let index = 0; index < view.count; index++) {
    const item = document.createElement('div');
    item.className = `conversation-tab${index === view.activeIndex ? ' active' : ''}`;

    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'tab-select';
    const title = view.titles?.[index] || `Chat ${index + 1}`;
    select.textContent = title;
    select.title = title;
    select.role = 'tab';
    select.setAttribute('aria-selected', String(index === view.activeIndex));
    select.disabled = !(view.canSwitch ?? !view.busy);
    select.addEventListener('click', () => circe.switchTab(index));

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'tab-close';
    close.textContent = '×';
    close.title = 'Close conversation';
    close.setAttribute('aria-label', `Close ${title}`);
    close.disabled = !(view.canClose ?? !view.busy);
    close.addEventListener('click', () => circe.closeTab(index));
    item.append(select, close);
    tabList.append(item);
  }
  updateTabScroll();
  tabList.scrollLeft = scrollLeft;
  if (revealActive) {
    const active = tabList.children[view.activeIndex];
    if (active) {
      const bounds = active.getBoundingClientRect();
      const viewport = tabList.getBoundingClientRect();
      if (bounds.right > viewport.right) tabList.scrollLeft += bounds.right - viewport.right;
      else if (bounds.left < viewport.left) tabList.scrollLeft += bounds.left - viewport.left;
    }
  }
  updateTabScroll();
  newTab.disabled = !(view.canCreate ?? !view.busy);
  renderContextHealth();
}

function renderContextHealth(): void {
  if (!pressure) {
    contextHealth.hidden = true;
    return;
  }
  contextHealth.hidden = false;
  contextHealth.className = pressure.level;
  contextHealthLabel.textContent = compactionCount > 0
    ? `Context · compacted ${compactionCount}×`
    : 'Context';
  contextHealthValue.textContent = compactTokenCount(pressure.used);
  contextHealthFill.style.width = `${pressure.meterPercent}%`;
  contextHealth.title =
    `${pressure.used.toLocaleString()} of ${pressure.size.toLocaleString()} model-context tokens. ` +
    `Circe's cost warning begins around ${pressure.softLimit.toLocaleString()} tokens.`;

  const advised = pressure.level !== 'normal' || handoffRunning;
  contextHealthAdvice.hidden = !advised;
  if (handoffRunning) {
    contextHealthMessage.textContent = 'Preparing a compact handoff…';
  } else if (pressure.level === 'critical') {
    contextHealthMessage.textContent = 'This chat is expensive to continue.';
  } else {
    contextHealthMessage.textContent = 'Long tool-using turns may cost more.';
  }
  const canRollover =
    pressure.level === 'critical' && tabsView?.supported === true && !handoffRunning;
  handoff.hidden = !canRollover;
  handoff.disabled = tabsView?.busy === true;
  handoff.title = handoff.disabled
    ? 'Available when this tile finishes its running turns, pending approvals, and conversation loading.'
    : 'Summarize this conversation and continue in a fresh tab.';
  if (canRollover && handoff.disabled) {
    contextHealthMessage.textContent += ' Handoff is available once this tile is idle.';
  }
}

function resetContextHealth(): void {
  pressure = null;
  previousUsed = 0;
  compactionCount = 0;
  handoffRunning = false;
  renderContextHealth();
}

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

function permissionCard(id: number, description: string, command: string, conversation?: string): HTMLElement {
  const card = document.createElement('section');
  card.className = 'permission';
  card.dataset.permission = String(id);
  if (conversation) {
    const source = document.createElement('div');
    source.className = 'permission-heading';
    source.textContent = `Approval for ${conversation}`;
    card.append(source);
  }

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
 * Draws the accumulated source as Markdown. The source lives separately from
 * the DOM because `textContent` no longer contains Markdown delimiters after
 * `innerHTML` has turned them into elements.
 */
function renderStreamingMarkdown(): void {
  markdownFrame = null;
  if (!streaming) return;
  // The only place model output reaches `innerHTML` (Amendment 3). Contained
  // by the tile's CSP (no `script-src 'unsafe-inline'`) and by the navigation
  // guards in `windows.ts`.
  streaming.innerHTML = renderMarkdown(streamingMarkdown);
  streaming.classList.remove('plain');
  streaming.classList.add('md');
  log.scrollTop = log.scrollHeight;
}

function scheduleMarkdownRender(): void {
  if (markdownFrame === null) markdownFrame = requestAnimationFrame(renderStreamingMarkdown);
}

/**
 * Ends the current turn and flushes any chunk that has not painted yet.
 * `session/prompt` resolving remains the authoritative bubble boundary, but
 * Markdown is rendered during the stream too: a backend that delays that
 * response must not leave completed-looking output full of raw `**` and `#`.
 */
function endTurn(): void {
  if (markdownFrame !== null) {
    cancelAnimationFrame(markdownFrame);
    markdownFrame = null;
  }
  if (streaming) renderStreamingMarkdown();
  streaming = null;
  streamingMarkdown = '';
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

circe.onTabs((value) => {
  const view = asTabsView(value);
  if (view) renderTabs(view);
});

function startNewTab(): void {
  circe.newTab();
  input.focus();
}

newTab.addEventListener('click', startNewTab);
handoff.addEventListener('click', () => {
  if (handoff.disabled || handoffRunning) return;
  handoffRunning = true;
  renderContextHealth();
  circe.rollover();
});

// Command-T is the native macOS convention; Control-T is supported too so the
// shortcut the user asked for behaves identically to the visible `+` button.
// The main process still owns the busy guard, so a shortcut cannot bypass the
// lock during session creation, replay, handoff, or a pending permission request.
document.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() !== 't' || (!event.metaKey && !event.ctrlKey)) return;
  if (event.altKey || event.shiftKey) return;
  event.preventDefault();
  startNewTab();
});

function resetTranscript(): void {
  if (markdownFrame !== null) cancelAnimationFrame(markdownFrame);
  markdownFrame = null;
  replaying = false;
  streaming = null;
  streamingMarkdown = '';
  toolBubble = null;
  toolTitle = '';
  log.replaceChildren();
  permissions.querySelectorAll('.resolved').forEach((card) => card.remove());
  resetContextHealth();
}

/**
 * The update kinds this tile acts on. The first four are real ACP
 * `session/update` kinds and are exactly the ones the working prototype
 * handles (renderer.js:377-418); the `circe/` ones are Circe's own lifecycle
 * events, namespaced so they can't ever collide with a protocol kind.
 */
circe.onUpdate((update) => {
  const u = update as { sessionUpdate?: string; content?: unknown; title?: string };
  switch (u.sessionUpdate) {
    case 'usage_update': {
      const update = contextPressure(
        (u as { size?: unknown }).size,
        (u as { used?: unknown }).used,
      );
      if (!update) return;
      if (likelyCompacted(previousUsed, update.used, update.softLimit)) compactionCount++;
      previousUsed = update.used;
      pressure = update;
      renderContextHealth();
      return;
    }
    case 'agent_message_chunk': {
      const piece = extractText(u.content);
      if (!piece) return;
      if (!streaming) {
        streaming = appendText('agent', '');
        streamingMarkdown = '';
      }
      streamingMarkdown += piece;
      scheduleMarkdownRender();
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
      const blocks = Array.isArray(u.content) ? u.content : [u.content];
      const images = blocks.filter(isImageAttachment);
      if (!piece && !images.length) return;
      endTurn();
      appendUserPrompt({ text: piece, images });
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
    case 'circe/tab-reset':
      clearAttachment();
      resetTranscript();
      return;
    case 'circe/handoff-start':
      handoffRunning = true;
      renderContextHealth();
      return;
    case 'circe/handoff-failed':
      handoffRunning = false;
      renderContextHealth();
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
      resetTranscript();
      appendText('agent', "Couldn't reopen the previous conversation, so I'm starting a new one.");
      const held = (update as { held?: unknown }).held;
      if (Array.isArray(held)) {
        for (const message of held) if (isTilePrompt(message)) appendUserPrompt(message);
      }
      return;
    }
    case 'circe/turn-end':
      endTurn();
      return;
    case 'circe/unsent-prompts':
      if (Array.isArray(update.held)) {
        for (const message of update.held) if (isTilePrompt(message)) appendUserPrompt(message);
      }
      endTurn();
      return;
    case 'circe/permission': {
      const request = update as { id?: unknown; description?: unknown; command?: unknown; conversation?: unknown };
      if (typeof request.id !== 'number' || typeof request.command !== 'string' || !request.command) return;
      permissions.querySelectorAll('.resolved').forEach((card) => card.remove());
      permissions.append(
        permissionCard(
          request.id,
          typeof request.description === 'string' ? request.description : '',
          request.command,
          typeof request.conversation === 'string' ? request.conversation : undefined,
        ),
      );
      permissions.scrollTop = permissions.scrollHeight;
      return;
    }
    case 'circe/permission-resolved': {
      const result = update as { id?: unknown; outcome?: unknown };
      if (typeof result.id !== 'number') return;
      const card = permissions.querySelector(`[data-permission="${result.id}"]`);
      if (!card) return;
      if (result.outcome === 'allow_once' || result.outcome === 'allow_session') {
        card.remove();
        return;
      }
      card.classList.add('resolved');
      const outcome = document.createElement('div');
      outcome.className = 'permission-outcome';
      outcome.textContent = permissionOutcomeLabel(result.outcome);
      const actions = document.createElement('div');
      actions.className = 'permission-actions';
      const dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.textContent = 'Dismiss';
      dismiss.setAttribute('aria-label', 'Dismiss resolved approval');
      dismiss.addEventListener('click', () => card.remove());
      actions.append(dismiss);
      card.querySelector('.permission-actions')?.replaceWith(outcome, actions);
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
const imageFile = document.getElementById('image-file') as HTMLInputElement;
const attachButton = document.getElementById('attach-image') as HTMLButtonElement;
const attachmentPreview = document.getElementById('attachment-preview')!;
const attachmentStatus = document.getElementById('attachment-status')!;
let attachedImage: ImageAttachment | null = null;
let imageLoading = false;
let attachmentGeneration = 0;

function appendImage(parent: HTMLElement, attachment: ImageAttachment, alt: string): void {
  const image = document.createElement('img');
  image.className = 'conversation-image';
  image.src = `data:${attachment.mimeType};base64,${attachment.data}`;
  image.alt = alt;
  parent.append(image);
}

function appendUserPrompt(message: TilePrompt): void {
  const bubble = appendText('user', typeof message === 'string' ? message : message.text);
  if (typeof message !== 'string') {
    for (const image of message.images) appendImage(bubble, image, 'Attached image');
  }
  log.scrollTop = log.scrollHeight;
}

function clearAttachment(): void {
  attachmentGeneration++;
  attachedImage = null;
  imageLoading = false;
  attachButton.disabled = false;
  imageFile.value = '';
  attachmentPreview.replaceChildren();
  attachmentPreview.hidden = true;
  attachmentStatus.hidden = true;
}

attachButton.addEventListener('click', () => imageFile.click());
imageFile.addEventListener('change', async () => {
  const file = imageFile.files?.[0];
  if (!file) return;
  clearAttachment();
  const generation = attachmentGeneration;
  imageLoading = true;
  attachButton.disabled = true;
  attachmentStatus.textContent = 'Loading image…';
  attachmentStatus.hidden = false;
  try {
    if (!IMAGE_TYPES.includes(file.type) || file.size > MAX_IMAGE_BYTES || file.size === 0) {
      throw new Error('Choose a PNG, JPEG, WebP, or GIF image up to 5 MB.');
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Could not read this image. Please try again.'));
      reader.readAsDataURL(file);
    });
    const decoded = new Image();
    decoded.src = dataUrl;
    await decoded.decode();
    if (generation !== attachmentGeneration) return;
    attachedImage = { type: 'image', mimeType: file.type, data: dataUrl.slice(dataUrl.indexOf(',') + 1) };
    appendImage(attachmentPreview, attachedImage, file.name);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove image';
    remove.addEventListener('click', clearAttachment);
    attachmentPreview.append(remove);
    attachmentPreview.hidden = false;
    attachmentStatus.hidden = true;
  } catch (error) {
    if (generation !== attachmentGeneration) return;
    attachmentStatus.textContent = error instanceof Error ? error.message : 'Could not load this image.';
  } finally {
    if (generation === attachmentGeneration) {
      imageLoading = false;
      attachButton.disabled = false;
    }
  }
});

function sendCurrentInput(): void {
  const text = input.value.trim();
  if (imageLoading || (!text && !attachedImage)) return;
  // A local convenience command, not an agent prompt. It replaces the Hermes
  // conversation behind this tab, so the tab count and selection stay put.
  if (!attachedImage && text.toLowerCase() === '/clear') {
    if (!tabsView?.supported || tabsView.busy) return;
    circe.clearTab();
    input.value = '';
    input.focus();
    return;
  }
  // A new turn never continues the previous turn's bubbles, even if the last
  // one ended abnormally (the prototype resets the same state on send,
  // renderer.js:583).
  streaming = null;
  toolBubble = null;
  toolTitle = '';
  const message: TilePrompt = attachedImage ? { text, images: [attachedImage] } : text;
  appendUserPrompt(message);
  circe.send(message);
  clearAttachment();
  input.value = '';
  input.focus();
}

input.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.shiftKey) return;
  e.preventDefault();
  sendCurrentInput();
});

document.getElementById('send')!.addEventListener('click', () => sendCurrentInput());
