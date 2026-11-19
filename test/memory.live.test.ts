import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FactStore } from '../src/main/memory/store';
import { PersonalMemory } from '../src/main/memory/service';
import { OllamaMemoryModel, type LocalMemoryModel } from '../src/main/memory/ollama';
import { DEFAULT_MEMORY_SETTINGS } from '../src/shared/memory';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { LocalTelegramReader } from '../src/main/hermes/telegram';
import { TelegramCapture } from '../src/main/memory/telegram';

// Opt in: CIRCE_LIVE_MEMORY_TEST=1 npm test -- test/memory.live.test.ts
// Uses installed local Ollama models and disposable databases, never user data.
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

describe.skipIf(process.env.CIRCE_LIVE_MEMORY_TEST !== '1')('live personal memory regression', () => {
  const local = new OllamaMemoryModel();
  const cases: [string, RegExp][] = [
    ['Alex and I got married on June 14, 2020', /2020/],
    ['I joined a class with Robin called Drawing for Beginners.', /Drawing for Beginners/i],
    ['We host our podcast on Captivate. Can you help me change the artwork?', /Captivate/],
    ['I work as a teacher. Can you help me plan a lesson?', /teacher/i],
  ];
  it.each(cases)('extracts facts from %s', async (message, expected) => {
    const facts = await local.extract(message, [], DEFAULT_MEMORY_SETTINGS.extractionModel);
    expect(facts.some((fact) => expected.test(fact.text))).toBe(true);
    expect(facts.every((fact) => message.includes(fact.evidence))).toBe(true);
  }, 90_000);

  it.each([
    'How do I delete a YouTube video after posting?',
    'The purple one looks best; change the text to white.',
    'As a fictional example, say I got married in 2020. Do not treat this as a fact about me.',
  ])('does not save a task or hypothetical: %s', async (message) => {
    expect(await local.extract(message, [], DEFAULT_MEMORY_SETTINGS.extractionModel)).toEqual([]);
  }, 90_000);

  it('persists multiple facts from completed turns, corrects one, and recalls after restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'circe-live-memory-')); dirs.push(dir);
    const db = await FactStore.open(join(dir, 'memory.sqlite'));
    // Exercise the completed-turn path, including task sources and receipts.
    // Checkpoint generation is independent of personal-fact extraction.
    const model: LocalMemoryModel = {
      extract: local.extract.bind(local), embed: local.embed.bind(local), check: local.check.bind(local),
    };
    const memory = new PersonalMemory(db, model);
    const scope = { profileId: 'synthetic', sessionId: 'regression' };
    for (const message of [cases[0]![0], cases[1]![0]]) {
      const prepared = await memory.prepare(message, scope);
      await memory.startTurn(message, prepared);
      memory.completeTurn(message, 'Thanks for sharing.', prepared);
      await memory.idle();
      expect(memory.view().error).toBeNull();
    }
    expect(memory.view().facts).toHaveLength(2);
    const wedding = db.facts().find((fact) => /2020/.test(fact.text))!;
    expect(wedding.vector.length).toBeGreaterThan(0);
    memory.capture('Correction: Alex and I got married on June 15, 2020.', scope);
    await memory.idle();
    expect(db.facts().find((fact) => fact.key === wedding.key)?.text).toMatch(/15/);
    expect(db.facts()).toHaveLength(2);
    const reopened = new PersonalMemory(await FactStore.open(db.path), model);
    expect(reopened.view().facts).toHaveLength(2);
    expect(await reopened.recall('When did I get married?')).toContain('2020');
    expect(db.sources(scope.profileId, scope.sessionId).filter((source) => source.role === 'user')).toHaveLength(2);
  }, 180_000);

  it('captures Telegram facts through the SQLite reader and real local model exactly once', async () => {
    const home = await mkdtemp(join(tmpdir(), 'circe-live-telegram-')); dirs.push(home);
    const store = await FactStore.open(join(home, 'memory.sqlite'));
    await store.configure({ ...DEFAULT_MEMORY_SETTINGS, telegramEnabled: true });
    await promisify(execFile)(process.platform === 'win32' ? 'python' : 'python3', ['-I', '-c', `
import json, pathlib, sqlite3, sys, time
root = pathlib.Path(sys.argv[1]); (root / 'sessions').mkdir()
(root / 'sessions' / 'sessions.json').write_text(json.dumps({'dm':{'platform':'telegram','chat_type':'dm','session_id':'dm'}}))
db = sqlite3.connect(root / 'state.db')
db.executescript('CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT); CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, timestamp REAL);')
db.execute("INSERT INTO sessions VALUES ('dm','telegram')")
db.executemany('INSERT INTO messages VALUES (?, ?, ?, ?, ?)', [
 (1,'dm','user','Alex and I got married on June 14, 2020',time.time()),
 (2,'dm','user','I joined a class with Robin called Drawing for Beginners.',time.time()),
 (3,'dm','assistant','I live on Mars.',time.time())])
db.commit()
`, home]);
    const memory = new PersonalMemory(store, local);
    const reader = new LocalTelegramReader({ home, bin: join(home, 'bin', 'hermes') });
    const importer = new TelegramCapture(store, memory, reader, async () => ['default']);
    await importer.sweep();
    expect(memory.telegram.error).toBeNull();
    expect(store.facts()).toHaveLength(2);
    expect(store.facts().every((fact) => fact.channel === 'telegram' && fact.vector.length > 0)).toBe(true);
    const snapshot = store.facts();
    const reopened = await FactStore.open(store.path);
    const restarted = new TelegramCapture(reopened, new PersonalMemory(reopened, local), reader, async () => ['default']);
    await restarted.sweep();
    expect(reopened.facts()).toEqual(snapshot);
    expect(reopened.telegramCursor('default')).toBe(2);
  }, 180_000);
});
