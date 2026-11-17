import type { MemoryBridge, MemoryView, PersonalFact } from '../../shared/memory';
import type { ContextFocus, TaskHistoryView } from '../../shared/context';
import { checkpointPanel, contextReceiptPanel } from '../contextView';

declare global { interface Window { circeMemory: MemoryBridge } }
const api = window.circeMemory;
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
el('show-facts').addEventListener('click', () => el('facts-title').scrollIntoView({ behavior: 'smooth' }));
el('show-history').addEventListener('click', () => el('task-history-title').scrollIntoView({ behavior: 'smooth' }));
let view: MemoryView | undefined;
let signature = '';
let editing = false;
let busy = false;
let settingsLoaded = false;

function button(text: string, action: () => void, style = 'secondary'): HTMLButtonElement {
  const b = document.createElement('button'); b.type = 'button'; b.className = style; b.textContent = text;
  b.addEventListener('click', action); return b;
}

async function work(action: () => Promise<unknown>, success?: string): Promise<void> {
  if (busy) return;
  busy = true;
  document.querySelectorAll<HTMLButtonElement>('button').forEach((b) => { b.disabled = true; });
  el('message').textContent = 'Working locally…';
  try {
    const result = await action();
    el('message').textContent = success ?? (typeof result === 'string' ? result : '');
    signature = '';
    await refresh();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Show the current failure, not a stale background error beside an IPC wrapper.
    try { await refresh(); } catch { /* Preserve the operation's useful error. */ }
    el('message').textContent = view?.error === message ? '' : message;
  }
  finally { busy = false; document.querySelectorAll<HTMLButtonElement>('button').forEach((b) => { b.disabled = false; }); }
}

function factRow(fact: PersonalFact): HTMLElement {
  const row = document.createElement('article'); row.className = 'fact';
  const text = document.createElement('p'); text.textContent = fact.text; row.append(text);
  const details = document.createElement('details');
  const summary = document.createElement('summary'); summary.textContent = `From ${fact.profileId} · ${new Date(fact.updatedAt).toLocaleDateString()}`;
  const evidence = document.createElement('p'); evidence.textContent = `Source: ${fact.evidence}`;
  const source = document.createElement('p'); source.textContent = `Topic: ${fact.key}\nConversation: ${fact.sessionId}\nFirst saved: ${new Date(fact.createdAt).toLocaleString()}`;
  details.append(summary, evidence, source); row.append(details);
  const actions = document.createElement('div'); actions.className = 'actions';
  actions.append(button('Edit', () => {
    if (editing || busy) return;
    editing = true;
    const input = document.createElement('textarea'); input.value = fact.text; input.maxLength = 500; input.rows = 3;
    input.setAttribute('aria-label', 'Edit remembered fact'); text.replaceWith(input);
    actions.replaceChildren(button('Save', () => {
      void work(async () => { await api.edit(fact.key, input.value); editing = false; }, 'Fact updated.');
    }), button('Cancel', () => { editing = false; signature = ''; renderFacts(); }));
    input.focus();
  }), button('Forget', () => {
    if (editing) return;
    void work(async () => { await api.forget(fact.key); await loadHistory(); }, 'Forgotten. Its source task history was cleared; automatic capture is blocked for this topic key.');
  }, 'danger'));
  row.append(actions); return row;
}

function renderFacts(): void {
  if (!view || editing) return;
  const query = el<HTMLInputElement>('search').value.toLocaleLowerCase();
  const facts = view.facts.filter((f) => `${f.text} ${f.key} ${f.profileId}`.toLocaleLowerCase().includes(query))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const next = JSON.stringify(facts.slice(0, 100));
  if (next !== signature) { el('facts').replaceChildren(...facts.slice(0, 100).map(factRow)); signature = next; }
  el('empty').hidden = facts.length > 0;
  el('empty').textContent = query ? 'No matching facts.' : 'No facts saved yet. Once local models are ready, Circe will pick up durable facts from new messages.';
  el('limited').hidden = facts.length <= 100;
  el('count').textContent = String(view.facts.length);
}

async function refresh(): Promise<void> {
  view = await api.read();
  if (!settingsLoaded) {
    el<HTMLInputElement>('enabled').checked = view.settings.enabled;
    el<HTMLInputElement>('context-enabled').checked = view.settings.contextEnabled !== false;
    el<HTMLInputElement>('extraction-model').value = view.settings.extractionModel;
    el<HTMLInputElement>('embedding-model').value = view.settings.embeddingModel;
    settingsLoaded = true;
  }
  el('status').textContent = view.error ? `Memory needs attention: ${view.error}` :
    view.settings.enabled ? `Automatic capture and recall on · ${view.pending} pending. Use “Check local models” to verify readiness.` : 'Automatic capture and recall off.';
  el('location').textContent = `Stored locally at ${view.location}`;
  renderFacts();
}

el('settings').addEventListener('submit', (e) => {
  e.preventDefault();
  void work(() => api.configure({
    enabled: el<HTMLInputElement>('enabled').checked,
    contextEnabled: el<HTMLInputElement>('context-enabled').checked,
    extractionModel: el<HTMLInputElement>('extraction-model').value.trim(),
    embeddingModel: el<HTMLInputElement>('embedding-model').value.trim(),
  }), 'Settings saved.');
});
el('check').addEventListener('click', () => void work(() => api.check()));
el('refresh').addEventListener('click', () => void work(refresh));
el('search').addEventListener('input', renderFacts);
const confirmation = el<HTMLDialogElement>('confirm-forget');
el('forget-all').addEventListener('click', () => { if (!editing) confirmation.showModal(); });
el('cancel-forget').addEventListener('click', () => confirmation.close());
el('confirm-forget-all').addEventListener('click', () => {
  confirmation.close();
  void work(async () => { await api.forgetAll(); settingsLoaded = false; await loadHistory(); }, 'All Circe facts and task history forgotten. Memory is off.');
});
void refresh().catch((e) => { el('message').textContent = String(e); });
setInterval(() => { if (!busy) void refresh().catch((e) => { el('status').textContent = String(e); }); }, 2000);

let history: TaskHistoryView | undefined;
let historyRequest = 0;
const profile = el<HTMLSelectElement>('history-profile');
const session = el<HTMLSelectElement>('history-session');
function options(select: HTMLSelectElement, entries: { value: string; label: string }[], value: string): void {
  select.replaceChildren(...entries.map((entry) => { const option = document.createElement('option'); option.value = entry.value; option.textContent = entry.label; return option; }));
  if (entries.some((entry) => entry.value === value)) select.value = value;
}
async function readSource(id: string): Promise<void> {
  const source = await api.source(profile.value, id);
  if (!source) { el('history-status').textContent = 'This source was deleted or is no longer available.'; return; }
  el('source-heading').textContent = source.role === 'user' ? 'Original user message' : 'Original assistant message';
  el('source-meta').textContent = `${source.profileId} · ${new Date(source.createdAt).toLocaleString()} · Conversation ${source.sessionId}`;
  el('source-text').textContent = source.text;
  const dialog = el<HTMLDialogElement>('source-dialog');
  if (!dialog.open) dialog.showModal();
}
async function loadHistory(focus?: ContextFocus): Promise<void> {
  const request = ++historyRequest;
  try {
    const selectedProfile = focus?.profileId ?? profile.value;
    const selectedSession = focus?.sessionId ?? session.value;
    const next = await api.history(selectedProfile, selectedSession, el<HTMLInputElement>('history-search').value);
    if (request !== historyRequest) return;
    history = next;
    const profiles = [...new Set(next.sessions.map((s) => s.profileId))];
    if (selectedProfile && !profiles.includes(selectedProfile)) profiles.push(selectedProfile);
    options(profile, profiles.map((value) => ({ value, label: value })), selectedProfile);
    const sessions = next.sessions.filter((s) => s.profileId === profile.value);
    if (selectedSession && !sessions.some((s) => s.sessionId === selectedSession)) sessions.push({ profileId: profile.value, sessionId: selectedSession, title: 'Current conversation · no saved sources yet' });
    options(session, sessions.map((s) => ({ value: s.sessionId, label: s.title || `Conversation ${s.sessionId.slice(0, 12)}` })), selectedSession);
    // The initial discovery call may choose a different scope; fetch that scope before rendering.
    if (profile.value !== selectedProfile || session.value !== selectedSession) { await loadHistory(); return; }
    el('history-status').textContent = sessions.length ? 'Showing up to 30 matching sources and 30 recent context receipts. Refresh after a turn completes to see its checkpoint.' : 'No task history saved yet. New turns will appear here when task history is on.';
    const open = (id: string) => { void readSource(id).catch((e) => { el('history-status').textContent = String(e); }); };
    el('checkpoint').replaceChildren(...(next.checkpoint ? [checkpointPanel(next.checkpoint, open)] : []));
    el('history-sources').replaceChildren(...next.sources.map((source) => {
      const article = document.createElement('article'); article.className = 'fact';
      const p = document.createElement('p'); p.textContent = source.text.slice(0, 240);
      article.append(button(`Read ${source.role} message · ${new Date(source.createdAt).toLocaleString()}`, () => open(source.id)), p); return article;
    }));
    el('context-receipts').replaceChildren(...next.receipts.map((receipt) => contextReceiptPanel(receipt, open)));
    if (focus?.sourceId) await readSource(focus.sourceId);
  } catch (e) { if (request === historyRequest) el('history-status').textContent = String(e); }
}
profile.addEventListener('change', () => { session.value = ''; void loadHistory(); });
session.addEventListener('change', () => void loadHistory());
el('history-search-form').addEventListener('submit', (e) => { e.preventDefault(); void loadHistory(); });
el('history-refresh').addEventListener('click', () => void loadHistory());
el('close-source').addEventListener('click', () => el<HTMLDialogElement>('source-dialog').close());
const deleteDialog = el<HTMLDialogElement>('confirm-task-delete');
el('forget-task').addEventListener('click', () => { if (profile.value && session.value) deleteDialog.showModal(); });
el('cancel-task-delete').addEventListener('click', () => deleteDialog.close());
el('delete-task').addEventListener('click', () => {
  deleteDialog.close();
  void work(async () => { await api.forgetTask(profile.value, session.value); await loadHistory(); }, 'Task history deleted.');
});
api.onFocus((focus) => { void loadHistory(focus); });
const parameters = new URLSearchParams(location.search);
void loadHistory(parameters.get('profile') ? { profileId: parameters.get('profile')!, sessionId: parameters.get('session') ?? '', sourceId: parameters.get('source') || undefined } : undefined);
