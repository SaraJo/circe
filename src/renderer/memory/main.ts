import type { MemoryBridge, MemoryView, PersonalFact } from '../../shared/memory';

declare global { interface Window { circeMemory: MemoryBridge } }
const api = window.circeMemory;
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
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
    void work(() => api.forget(fact.key), 'Forgotten. Automatic capture is blocked for this topic key.');
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
  void work(async () => { await api.forgetAll(); settingsLoaded = false; }, 'All Circe facts forgotten. Memory is off.');
});
void refresh().catch((e) => { el('message').textContent = String(e); });
setInterval(() => { if (!busy) void refresh().catch((e) => { el('status').textContent = String(e); }); }, 2000);
