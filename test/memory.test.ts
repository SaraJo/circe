import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FactStore, type StoredFact } from '../src/main/memory/store';
import { PersonalMemory } from '../src/main/memory/service';
import { OllamaMemoryModel, type LocalMemoryModel, type ExtractedFact } from '../src/main/memory/ollama';
import { DEFAULT_MEMORY_SETTINGS } from '../src/shared/memory';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });
async function store(): Promise<FactStore> {
  const dir = await mkdtemp(join(tmpdir(), 'circe-memory-test-')); dirs.push(dir);
  return FactStore.open(join(dir, 'memory.sqlite'));
}
const source = { profileId: 'scully', sessionId: 'conversation-1' };
const fact = (text = 'The user lives in New York.'): StoredFact => ({
  key: 'user.home.city', text, evidence: 'I live in New York.', ...source,
  createdAt: '2026-11-08T12:00:00Z', updatedAt: '2026-11-08T12:00:00Z',
  vector: [1, 0], model: DEFAULT_MEMORY_SETTINGS.embeddingModel,
});
function fakeModel(): LocalMemoryModel {
  return {
    embed: vi.fn(async (texts: string[]) => texts.map((t) => /city|live|moved|reside/i.test(t) ? [1, 0] : [0, 1])),
    extract: vi.fn(async (text: string): Promise<ExtractedFact[]> => {
      if (/New York|Boston/.test(text)) return [{
        key: 'user.home.city', text: `The user lives in ${text.includes('Boston') ? 'Boston' : 'New York'}.`, evidence: text,
      }];
      return [];
    }),
    check: vi.fn(async () => 'Ready'),
  };
}
function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('local vector memory', () => {
  it('persists facts and vectors as SQLite and recalls a paraphrase after restart', async () => {
    const db = await store();
    const memory = new PersonalMemory(db, fakeModel());
    memory.capture('I live in New York.', source);
    await memory.idle();
    expect((await readFile(db.path)).subarray(0, 16).toString()).toBe('SQLite format 3\u0000');
    const reopened = new PersonalMemory(await FactStore.open(db.path), fakeModel());
    const context = await reopened.recall('Which city do I reside in?');
    expect(context).toContain('New York');
    expect(context).toContain('scully');
    expect(await reopened.recall('How do I bake bread?')).toBe('');
    expect(reopened.view().facts[0]).not.toHaveProperty('vector');
  });

  it('shares personal facts across profiles and replaces a corrected attribute', async () => {
    const db = await store(); const model = fakeModel(); const memory = new PersonalMemory(db, model);
    memory.capture('I live in New York.', source);
    memory.capture('I moved to Boston.', { profileId: 'mulder', sessionId: 'another-conversation' });
    await memory.idle();
    expect(memory.view().facts).toHaveLength(1);
    expect(memory.view().facts[0]).toMatchObject({ text: 'The user lives in Boston.', profileId: 'mulder', evidence: 'I moved to Boston.' });
    expect(await memory.recall('Where do I live?')).not.toContain('New York');
  });

  it('discards in-flight and queued capture after forgetting, and retains the block across restart', async () => {
    const db = await store(); await db.put([fact()], db.generation());
    const model = fakeModel(); const started = gate<void>(); const extraction = gate<ExtractedFact[]>();
    model.extract = vi.fn(async () => { started.resolve(); return extraction.promise; });
    const memory = new PersonalMemory(db, model);
    memory.capture('I live in New York.', source);
    memory.capture('I moved to Boston.', source);
    await started.promise;
    await memory.forget('user.home.city');
    extraction.resolve([{ key: 'user.home.city', text: 'The user lives in New York.', evidence: 'I live in New York.' }]);
    await memory.idle();
    expect(memory.view().facts).toEqual([]);
    expect(model.extract).toHaveBeenCalledTimes(1);
    const restarted = new PersonalMemory(await FactStore.open(db.path), fakeModel());
    restarted.capture('I live in New York.', source);
    await restarted.idle();
    expect(restarted.view().facts).toEqual([]);
    const bytes = await readFile(db.path);
    expect(bytes.includes(Buffer.from('New York'))).toBe(false);
  });

  it('discards a recall that was in flight when the fact was forgotten', async () => {
    const db = await store(); await db.put([fact()], db.generation());
    const model = fakeModel(); const embedding = gate<number[][]>();
    model.embed = vi.fn(() => embedding.promise);
    const memory = new PersonalMemory(db, model);
    const recall = memory.recall('Where do I live?');
    await memory.forget('user.home.city');
    embedding.resolve([[1, 0]]);
    expect(await recall).toBe('');
  });

  it('forget-all removes facts, pauses memory, and persists that setting', async () => {
    const db = await store(); await db.put([fact()], db.generation());
    const memory = new PersonalMemory(db, fakeModel());
    await memory.forgetAll();
    memory.capture('I moved to Boston.', source);
    await memory.idle();
    const reopened = await FactStore.open(db.path);
    expect(reopened.settings().enabled).toBe(false);
    expect(reopened.facts()).toEqual([]);
    expect(await memory.recall('Where do I live?')).toBe('');
  });

  it('continues chat without recall on model failure and exposes the error for review', async () => {
    const db = await store(); await db.put([fact()], db.generation());
    const model = fakeModel(); model.embed = vi.fn(async () => { throw new Error('Ollama is offline'); });
    const memory = new PersonalMemory(db, model);
    expect(await memory.recall('Where do I live?')).toBe('');
    memory.capture('I moved to Boston.', source);
    await memory.idle();
    expect(memory.view().error).toBe('Ollama is offline');
    expect(memory.view().facts[0]?.text).toContain('New York');
    memory.capture('Hello.', source);
    await memory.idle();
    expect(memory.view().error).toBeNull();
  });

  it('edits a fact and rebuilds its vector while protecting against concurrent deletion', async () => {
    const db = await store(); await db.put([fact()], db.generation());
    const model = fakeModel(); const memory = new PersonalMemory(db, model);
    await memory.edit('user.home.city', 'The user lives in Boston.');
    expect(memory.view().facts[0]?.evidence).toBe('Edited by you in Memory');
    const embedding = gate<number[][]>(); model.embed = vi.fn(() => embedding.promise);
    const edit = memory.edit('user.home.city', 'The user lives in Paris.');
    await memory.forget('user.home.city'); embedding.resolve([[1, 0]]);
    await expect(edit).rejects.toThrow('Memory changed');
    expect(memory.view().facts).toEqual([]);
  });

  it('atomically reindexes when changing embedding model, and preserves old settings on failure', async () => {
    const db = await store(); await db.put([fact()], db.generation());
    const model = fakeModel(); const memory = new PersonalMemory(db, model);
    await memory.configure({ ...DEFAULT_MEMORY_SETTINGS, embeddingModel: 'another-local-model' });
    expect(db.facts()[0]?.model).toBe('another-local-model');
    model.embed = vi.fn(async () => { throw new Error('Missing model'); });
    await expect(memory.configure({ ...DEFAULT_MEMORY_SETTINGS, embeddingModel: 'missing' })).rejects.toThrow('Missing model');
    expect(db.settings().embeddingModel).toBe('another-local-model');
  });

  it('does not publish a failed disk write and never resets an unreadable database', async () => {
    const db = await store(); await mkdir(db.path);
    await expect(db.put([fact()], db.generation())).rejects.toThrow();
    expect(db.facts()).toEqual([]);
    await rm(db.path, { recursive: true }); await writeFile(db.path, 'corrupt');
    await expect(FactStore.open(db.path)).rejects.toThrow();
    expect(await readFile(db.path, 'utf8')).toBe('corrupt');
  });
});

describe('local Ollama boundary', () => {
  function http(responses: unknown[]) {
    return vi.fn(async () => new Response(JSON.stringify(responses.shift()), { status: 200 })) as unknown as ReturnType<typeof vi.fn> & typeof fetch;
  }

  it('only accepts extracted facts grounded in an exact quote from the user', async () => {
    const request = http([{}, { message: { content: JSON.stringify({ facts: [
      { key: 'user.home.city', text: 'The user lives in Boston.', evidence: 'I live in Boston.' },
      { key: 'user.job', text: 'The user is a doctor.', evidence: 'I am a doctor.' },
      { key: '../../oops', text: 'Bad key', evidence: 'Boston' },
    ] }) } }]);
    const result = await new OllamaMemoryModel(request).extract('I live in Boston.', [], 'qwen3:4b');
    expect(result).toHaveLength(1);
    const chat = JSON.parse(request.mock.calls[1]![1].body);
    expect(chat.format).toMatchObject({
      type: 'object', required: ['facts'],
      properties: { facts: { type: 'array', items: { required: ['key', 'text', 'evidence'] } } },
    });
    expect(chat.format.properties.facts.items.properties.evidence.enum).toEqual(['I live in Boston.']);
    for (const [url, options] of request.mock.calls) {
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:11434\/api\//);
      expect(options.redirect).toBe('error');
    }
  });

  it('accepts an empty facts array for greetings and reports malformed responses clearly', async () => {
    const empty = new OllamaMemoryModel(http([{}, { message: { content: '{"facts":[]}' } }]));
    expect(await empty.extract('Hello.', [], 'local')).toEqual([]);
    for (const content of ['null', '{}', '{"facts":null}']) {
      const malformed = new OllamaMemoryModel(http([{}, { message: { content } }]));
      await expect(malformed.extract('Hello.', [], 'local')).rejects.toThrow('required facts array');
    }
    const incomplete = new OllamaMemoryModel(http([{}, { message: { content: '{"facts":[' } }]));
    await expect(incomplete.extract('Hello.', [], 'local')).rejects.toThrow('incomplete JSON');
  });

  it('checks real embedding and extraction responses rather than model presence alone', async () => {
    const content = JSON.stringify({ facts: [{ key: 'user.editor.preference', text: 'The user prefers Zed.', evidence: 'My preferred editor is Zed.' }] });
    const request = http([{}, {}, { embeddings: [[1, 0]] }, {}, { message: { content } }]);
    await expect(new OllamaMemoryModel(request).check(DEFAULT_MEMORY_SETTINGS)).resolves.toContain('ready');
    expect(request.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      '/api/show', '/api/show', '/api/embed', '/api/show', '/api/chat',
    ]);
    const empty = new OllamaMemoryModel(http([{}, {}, { embeddings: [[1, 0]] }, {}, { message: { content: '{"facts":[]}' } }]));
    await expect(empty.check(DEFAULT_MEMORY_SETTINGS)).rejects.toThrow('did not capture the sample preference');
  });

  it('identifies the missing model and supplies the exact download command', async () => {
    const missing = vi.fn(async () => new Response('{"error":"model not found"}', { status: 404 })) as unknown as typeof fetch;
    await expect(new OllamaMemoryModel(missing).embed(['hello'], 'embeddinggemma')).rejects.toThrow(
      'Local model "embeddinggemma" is not installed. Run ollama pull embeddinggemma',
    );
  });

  it('explains offline and timeout failures', async () => {
    const offline = vi.fn(async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    await expect(new OllamaMemoryModel(offline).embed(['hello'], 'local')).rejects.toThrow('Start Ollama');
    const timeout = vi.fn(async () => { throw new DOMException('timeout', 'TimeoutError'); }) as unknown as typeof fetch;
    await expect(new OllamaMemoryModel(timeout).embed(['hello'], 'local')).rejects.toThrow('took too long');
  });

  it('refuses cloud aliases before sending personal data', async () => {
    const request = http([{ remote_host: 'https://ollama.com', remote_model: 'remote' }]);
    const model = new OllamaMemoryModel(request);
    await expect(model.embed(['private fact'], 'alias')).rejects.toThrow('Cloud models');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[1].body).not.toContain('private fact');
    await expect(model.embed(['private fact'], 'model:cloud')).rejects.toThrow('local Ollama model');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid and mismatched embedding vectors', async () => {
    const model = new OllamaMemoryModel(http([{}, { embeddings: [[0, 0]] }]));
    await expect(model.embed(['hello'], 'local')).rejects.toThrow('invalid vectors');
    const mismatched = new OllamaMemoryModel(http([{}, { embeddings: [[1], [1, 2]] }]));
    await expect(mismatched.embed(['one', 'two'], 'local')).rejects.toThrow('invalid vectors');
  });
});
