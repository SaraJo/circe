import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FactStore } from '../src/main/memory/store';
import { PersonalMemory } from '../src/main/memory/service';
import { OllamaMemoryModel, type LocalMemoryModel } from '../src/main/memory/ollama';
import { DEFAULT_MEMORY_SETTINGS } from '../src/shared/memory';

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
});
