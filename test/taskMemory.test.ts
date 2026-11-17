import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FactStore } from '../src/main/memory/store';
import { PersonalMemory } from '../src/main/memory/service';
import { ContextServer } from '../src/main/memory/contextServer';
import { OllamaMemoryModel, type LocalMemoryModel } from '../src/main/memory/ollama';
import { DEFAULT_MEMORY_SETTINGS } from '../src/shared/memory';
import type { CheckpointDraft, ContextScope, ConversationSource, TaskCheckpoint } from '../src/shared/context';

const dirs: string[] = [];
const servers: ContextServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
const scope = { profileId: 'scully', sessionId: 'garden' };
const empty: CheckpointDraft = { goal: null, constraints: [], decisions: [], progress: [], openQuestions: [], nextSteps: [] };
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'circe-task-test-')); dirs.push(dir);
  const store = await FactStore.open(join(dir, 'memory.sqlite'));
  const model: LocalMemoryModel = {
    embed: vi.fn(async (texts) => texts.map(() => [1, 0])), extract: vi.fn(async () => []), check: vi.fn(async () => 'Ready'),
    checkpoint: vi.fn(async (sources: ConversationSource[], previous: TaskCheckpoint | null) => ({ ...empty,
      goal: { text: sources.filter((s) => s.role === 'user').at(-1)!.text, sourceIds: [sources.filter((s) => s.role === 'user').at(-1)!.id] },
      constraints: previous?.constraints ?? [],
    })),
  };
  return { store, model, memory: new PersonalMemory(store, model) };
}
async function turn(memory: PersonalMemory, text: string, assistant = 'I propose growing basil.', source: ContextScope = scope) {
  const prepared = await memory.prepare(text, source);
  await memory.startTurn(text, prepared);
  memory.completeTurn(text, assistant, prepared);
  await memory.idle();
  return prepared;
}
function gate<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }

describe('task checkpoints and original sources', () => {
  it('archives exact role-separated sources, creates a cited checkpoint, and survives restart', async () => {
    const { memory, store, model } = await setup();
    const prepared = await turn(memory, 'Plan a garden. My budget is $200.');
    const history = memory.history(scope.profileId, scope.sessionId);
    expect(history.sources.map((s) => s.role).sort()).toEqual(['assistant', 'user']);
    const original = history.sources.find((s) => s.role === 'user')!;
    expect(original.text).toBe('Plan a garden. My budget is $200.');
    expect(history.checkpoint).toMatchObject({ version: 1, goal: { sourceIds: [original.id] } });
    expect(history.checkpoint).not.toHaveProperty('checkpoint');
    expect(history.checkpoint).not.toHaveProperty('facts');
    expect(history.sources.find((s) => s.role === 'assistant')).not.toHaveProperty('checkpoint');
    expect(history.receipts[0]).toMatchObject({ id: prepared.receipt.id, outcome: 'completed' });
    const reopened = new PersonalMemory(await FactStore.open(store.path), model);
    const next = await reopened.prepare('What should we do next?', scope);
    expect(next.text).toContain('My budget is $200.');
    expect(next.receipt.checkpoint?.version).toBe(1);
    expect(reopened.source(scope.profileId, original.id)?.text).toBe(original.text);
  });

  it('links handoff continuations but isolates blank conversations and other agents', async () => {
    const { memory } = await setup(); await turn(memory, 'Plan a garden with a $200 budget.');
    await memory.linkTask(scope.profileId, scope.sessionId, 'garden-2');
    const continued = await memory.prepare('Continue', { profileId: scope.profileId, sessionId: 'garden-2' });
    expect(continued.receipt.checkpoint?.version).toBe(1);
    await turn(memory, 'Change the budget to $300.', 'I propose fewer raised beds.', { profileId: scope.profileId, sessionId: 'garden-2' });
    expect(memory.history(scope.profileId, scope.sessionId).checkpoint?.version).toBe(2);
    expect((await memory.prepare('Continue', { profileId: scope.profileId, sessionId: 'blank' })).receipt.checkpoint).toBeNull();
    expect((await memory.prepare('garden', { profileId: 'mulder', sessionId: 'garden' })).receipt.sources).toEqual([]);
    const id = memory.history(scope.profileId, scope.sessionId).sources[0]!.id;
    expect(memory.source('mulder', id)).toBeNull();
  });

  it('retains old source wording and the last valid checkpoint when a new checkpoint is invalid', async () => {
    const { memory, model } = await setup(); await turn(memory, 'Plan a garden with a $200 budget.');
    model.checkpoint = vi.fn(async () => ({ ...empty, goal: { text: 'A made-up goal', sourceIds: ['missing'] } }));
    await turn(memory, 'Change the budget to $300.');
    const history = memory.history(scope.profileId, scope.sessionId);
    expect(history.checkpoint?.version).toBe(1);
    expect(history.sources.filter((s) => s.role === 'user').map((s) => s.text)).toContain('Change the budget to $300.');
    expect(memory.view().error).toContain('unknown source');
  });

  it('keeps full original text even when model input uses excerpts', async () => {
    const { memory, model } = await setup();
    const message = 'Plan a garden. ' + 'a'.repeat(4000) + ' Exact identifier: basil-947.';
    await turn(memory, message);
    const result = memory.tasks.search(scope.profileId, 'basil-947', scope.sessionId)[0]!;
    expect(memory.source(scope.profileId, result.id)?.text).toBe(message);
    expect(vi.mocked(model.checkpoint!).mock.calls[0]![0].find((s) => s.role === 'user')?.text.length).toBe(1500);
  });

  it('deletes all linked task sources and receipts and prevents late checkpoint resurrection', async () => {
    const { memory, model, store } = await setup(); await turn(memory, 'Plan a garden with a $200 budget.');
    await memory.linkTask(scope.profileId, scope.sessionId, 'continued');
    const started = gate<void>(); const pending = gate<CheckpointDraft>();
    model.checkpoint = vi.fn(async () => { started.resolve(); return pending.promise; });
    const prepared = await memory.prepare('Update the budget to $300.', scope);
    await memory.startTurn('Update the budget to $300.', prepared);
    memory.completeTurn('Update the budget to $300.', 'Updated.', prepared);
    await started.promise;
    await memory.forgetTask(scope.profileId, 'continued');
    pending.resolve(empty); await memory.idle();
    expect(memory.history(scope.profileId, scope.sessionId).checkpoint).toBeNull();
    expect(memory.history(scope.profileId, 'continued').sources).toEqual([]);
    expect(memory.history(scope.profileId, 'continued').receipts).toEqual([]);
    expect((await readFile(store.path)).includes(Buffer.from('$200'))).toBe(false);
    memory.completeTurn('An old late turn', 'Old result', prepared); await memory.idle();
    expect(memory.history(scope.profileId, scope.sessionId).sources).toEqual([]);
  });

  it('forgetting a personal fact clears its source task history and fact snapshots', async () => {
    const { memory, store } = await setup(); await turn(memory, 'I prefer jasmine tea.');
    await store.put([{ key: 'user.drink', text: 'The user prefers jasmine tea.', evidence: 'I prefer jasmine tea.', ...scope, createdAt: 'now', updatedAt: 'now', vector: [1, 0], model: DEFAULT_MEMORY_SETTINGS.embeddingModel }], store.generation());
    const supplied = await memory.prepare('What tea do I prefer?', scope);
    expect(supplied.receipt.facts).toHaveLength(1);
    await memory.forget('user.drink');
    expect(memory.history(scope.profileId, scope.sessionId).sources).toEqual([]);
    expect(memory.receipt(scope.profileId, supplied.receipt.id)).toBeNull();
  });

  it('tracks personal facts supplied to other agents and clears their dependent task interpretations', async () => {
    const { memory, store } = await setup();
    await store.put([{ key: 'user.drink', text: 'The user prefers jasmine tea.', evidence: 'I prefer jasmine tea.', ...scope, createdAt: 'now', updatedAt: 'now', vector: [1, 0], model: DEFAULT_MEMORY_SETTINGS.embeddingModel }], store.generation());
    const other = { profileId: 'mulder', sessionId: 'tea-planning' };
    await turn(memory, 'Suggest a drink.', 'I suggest jasmine tea.', other);
    const source = memory.history(other.profileId, other.sessionId).sources.find((s) => s.role === 'assistant')!;
    expect(source.memoryKeys).toContain('user.drink');
    expect(memory.history(other.profileId, other.sessionId).checkpoint?.memoryKeys).toContain('user.drink');
    await memory.forget('user.drink');
    expect(memory.source(other.profileId, source.id)).toBeNull();
    expect(memory.history(other.profileId, other.sessionId).checkpoint).toBeNull();
  });

  it('tracks facts encountered only through a source tool and deletes their derived task history', async () => {
    const { memory, store, model } = await setup(); await turn(memory, 'I prefer jasmine tea.');
    const original = memory.history(scope.profileId, scope.sessionId).sources.find((s) => s.role === 'user')!;
    await store.put([{ key: 'user.drink', text: 'The user prefers jasmine tea.', evidence: 'I prefer jasmine tea.', ...scope, createdAt: 'now', updatedAt: 'now', vector: [1, 0], model: DEFAULT_MEMORY_SETTINGS.embeddingModel }], store.generation());
    model.embed = vi.fn(async (texts) => texts.map(() => [0, 1]));
    const other = { profileId: scope.profileId, sessionId: 'another-task' };
    const prepared = await memory.prepare('Suggest a drink.', other);
    expect(prepared.receipt.facts).toEqual([]);
    await memory.startTurn('Suggest a drink.', prepared);
    await memory.recordToolSources(scope.profileId, prepared.receipt.id, [original]);
    memory.completeTurn('Suggest a drink.', 'I suggest jasmine tea.', prepared); await memory.idle();
    expect(memory.history(other.profileId, other.sessionId).checkpoint?.memoryKeys).toContain('user.drink');
    await memory.forget('user.drink');
    expect(memory.history(other.profileId, other.sessionId).sources).toEqual([]);
    expect(memory.history(other.profileId, other.sessionId).checkpoint).toBeNull();
  });

  it('supplies recent original messages for vague follow-ups while a checkpoint is pending', async () => {
    const { memory, model } = await setup();
    const waiting = gate<CheckpointDraft>(); const started = gate<void>();
    model.checkpoint = vi.fn(async () => { started.resolve(); return waiting.promise; });
    const prepared = await memory.prepare('Plan a garden under $200.', scope);
    await memory.startTurn('Plan a garden under $200.', prepared);
    memory.completeTurn('Plan a garden under $200.', 'I suggest basil.', prepared);
    await started.promise;
    const followup = await memory.prepare('Yes.', scope);
    expect(followup.receipt.sources.some((s) => s.text.includes('$200'))).toBe(true);
    waiting.resolve(empty); await memory.idle();
  });

  it('supports disabling task capture independently and forget-all removes every context derivative', async () => {
    const { memory, model } = await setup(); await turn(memory, 'Plan a garden.');
    await memory.configure({ ...DEFAULT_MEMORY_SETTINGS, contextEnabled: false });
    const next = await memory.prepare('Plan a greenhouse.', scope);
    expect(next.receipt.checkpoint).toBeNull(); expect(next.receipt.sources).toEqual([]);
    memory.completeTurn('Plan a greenhouse.', 'Proposed plan', next); await memory.idle();
    expect(model.checkpoint).toHaveBeenCalledTimes(1);
    await memory.forgetAll();
    const history = memory.history(scope.profileId, scope.sessionId);
    expect(history.sources).toEqual([]); expect(history.receipts).toEqual([]); expect(history.checkpoint).toBeNull();
  });

  it('never reclassifies assistant claims as direct user facts', async () => {
    const { memory, model } = await setup();
    await turn(memory, 'Plan a garden.', 'The user is a millionaire; the garden has already been built.');
    expect(model.extract).toHaveBeenCalledWith('Plan a garden.', [], DEFAULT_MEMORY_SETTINGS.extractionModel);
    const assistant = memory.history(scope.profileId, scope.sessionId).sources.find((s) => s.role === 'assistant')!;
    expect(assistant.text).toContain('millionaire'); expect(memory.view().facts).toEqual([]);
  });
});

describe('read-only agent context tools', () => {
  async function server() {
    const result = await setup(); await turn(result.memory, 'Plan a garden with a $200 budget.');
    const prepared = await result.memory.prepare('Continue', scope);
    const server = new ContextServer(result.memory); servers.push(server); await server.start();
    const config = server.config(scope.profileId)[0]!;
    const headers = { 'Content-Type': 'application/json', Authorization: config.headers[0]!.value };
    const call = async (name: string, args: unknown = {}, authorization = headers.Authorization) => {
      const response = await fetch(config.url, { method: 'POST', headers: { ...headers, Authorization: authorization }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { receipt_id: prepared.receipt.id, ...(args as object) } } }) });
      return { response, result: response.ok ? (await response.json() as any).result : null };
    };
    return { ...result, server, config, headers, call, prepared };
  }

  it('requires authentication, refuses browser origins, and exposes only its profile', async () => {
    const s = await server();
    expect((await s.call('search_context', { query: 'garden' }, 'wrong')).response.status).toBe(401);
    const origin = await fetch(s.config.url, { method: 'POST', headers: { ...s.headers, Origin: 'https://example.com' }, body: '{}' });
    expect(origin.status).toBe(403);
    const search = await s.call('search_context', { query: 'garden' });
    const sources = JSON.parse(search.result.content[0].text);
    expect(sources[0].profileId).toBe(scope.profileId);
    expect(s.memory.receipt(scope.profileId, s.prepared.receipt.id)?.toolSources?.length).toBeGreaterThan(0);
    const other = s.server.config('mulder')[0]!;
    const read = await s.call('read_context', { source_id: sources[0].id }, other.headers[0]!.value);
    expect(read.result.isError).toBe(true);
  });

  it('negotiates MCP and supplies exact paged source text and task state', async () => {
    const s = await server();
    const rpc = async (method: string, params = {}) => (await (await fetch(s.config.url, { method: 'POST', headers: s.headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json() as any).result;
    expect((await rpc('initialize', { protocolVersion: '2025-06-18' })).protocolVersion).toBe('2025-06-18');
    expect((await rpc('tools/list')).tools.every((t: any) => t.annotations.readOnlyHint)).toBe(true);
    const source = s.memory.tasks.search(scope.profileId, '$200')[0]!;
    const read = await s.call('read_context', { source_id: source.id, offset: 5, limit: 8 });
    expect(JSON.parse(read.result.content[0].text).text).toBe(source.text.slice(5, 13));
    expect(s.memory.receipt(scope.profileId, s.prepared.receipt.id)?.toolSources?.find((entry) => entry.excerptOffset === 5)?.text).toBe(source.text.slice(5, 13));
    const checkpoint = await s.call('task_checkpoint', { session_id: scope.sessionId });
    expect(JSON.parse(checkpoint.result.content[0].text).version).toBe(1);
    expect((await s.call('read_context', { source_id: source.id, offset: -1 })).result.isError).toBe(true);
    await s.memory.configure({ ...DEFAULT_MEMORY_SETTINGS, enabled: false });
    expect((await s.call('search_context', { query: 'garden' })).result.isError).toBe(true);
  });
});

describe('checkpoint model validation', () => {
  it('keeps quoted requirements through short follow-ups and replaces an explicitly corrected limit', async () => {
    const first = { ...scope, id: 'source-1', turnId: 'turn-1', role: 'user' as const, text: 'Keep the total budget under $600.', createdAt: 'now' };
    const second = { ...first, id: 'source-2', turnId: 'turn-2', text: 'Please keep the hotel refundable.' };
    const previous: TaskCheckpoint = { ...scope, ...empty, version: 1, updatedAt: 'now', constraints: [{ text: 'User requirement: Keep the total budget under $600.', sourceIds: [first.id], userQuoted: true }] };
    const response = () => ({ message: { content: JSON.stringify(empty) } });
    const replies = [{}, response(), {}, response(), {}, response()];
    const http = vi.fn(async () => new Response(JSON.stringify(replies.shift()))) as unknown as typeof fetch;
    const model = new OllamaMemoryModel(http);
    const next = await model.checkpoint([first, second], previous, 'local');
    expect(JSON.stringify(next.constraints)).toContain('refundable');
    expect(JSON.stringify(next.constraints)).toContain('600');
    replies[1] = { message: { content: JSON.stringify({ ...empty, constraints: next.constraints.map(({ text, sourceIds }) => ({ text, sourceIds })) }) } };
    const yes = { ...first, id: 'source-3', turnId: 'turn-3', text: 'Yes.' };
    const followed = await model.checkpoint([first, second, yes], { ...previous, ...next, version: 2 }, 'local');
    expect(JSON.stringify(followed.constraints)).toContain('refundable');
    expect(followed.constraints.filter((entry) => entry.text.startsWith('User requirement:')).every((entry) => entry.userQuoted)).toBe(true);
    const change = { ...first, id: 'source-4', turnId: 'turn-4', text: 'Actually, budget is $800.' };
    const corrected = await model.checkpoint([first, second, change], { ...previous, ...followed, version: 3 }, 'local');
    expect(JSON.stringify(corrected.constraints)).toContain('800');
    expect(JSON.stringify(corrected.constraints)).not.toContain('600');
    expect(JSON.stringify(corrected.constraints)).toContain('refundable');
  });

  it('retains an explicit request as the goal and keeps assistant-only proposals out of agreed decisions', async () => {
    const sources = [
      { ...scope, id: 'user-1', turnId: 'turn-1', role: 'user' as const, text: 'Plan a garden under $200.', createdAt: 'now' },
      { ...scope, id: 'assistant-1', turnId: 'turn-1', role: 'assistant' as const, text: 'I propose raised beds.', createdAt: 'now' },
    ];
    const reply = { ...empty, decisions: [{ text: 'Use raised beds.', sourceIds: ['assistant-1'] }], progress: [{ text: 'Work complete.', sourceIds: ['assistant-1'] }] };
    const responses = [{}, { message: { content: JSON.stringify(reply) } }];
    const http = vi.fn(async () => new Response(JSON.stringify(responses.shift()))) as unknown as typeof fetch;
    const checkpoint = await new OllamaMemoryModel(http).checkpoint(sources, null, 'local');
    expect(checkpoint.goal).toEqual({ text: 'Plan a garden under $200.', sourceIds: ['user-1'] });
    expect(checkpoint.decisions).toEqual([]);
    expect(checkpoint.openQuestions[0]?.text).toContain('Unconfirmed proposal');
    expect(checkpoint.progress[0]?.text).toContain('Assistant reported');
    expect(checkpoint.progress[0]?.text).toContain('I propose raised beds.');
    expect(checkpoint.progress[0]?.text).not.toContain('Work complete.');
  });

  it('rejects unsupported source IDs and incomplete checkpoints', async () => {
    const source = { ...scope, id: 'source-1', turnId: 'turn-1', role: 'user' as const, text: 'Plan a garden.', createdAt: 'now' };
    const reply = { ...empty, goal: { text: 'A fabricated goal', sourceIds: ['missing'] } };
    const responses = [{}, { message: { content: JSON.stringify(reply) } }];
    const http = vi.fn(async () => new Response(JSON.stringify(responses.shift()))) as unknown as typeof fetch;
    await expect(new OllamaMemoryModel(http).checkpoint([source], null, 'local')).rejects.toThrow('invalid fields or sources');
  });
});
