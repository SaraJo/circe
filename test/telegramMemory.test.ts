import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FactStore } from '../src/main/memory/store';
import { PersonalMemory } from '../src/main/memory/service';
import { TelegramCapture } from '../src/main/memory/telegram';
import type { TelegramMessage, TelegramReader } from '../src/main/hermes/telegram';
import type { LocalMemoryModel } from '../src/main/memory/ollama';
import { DEFAULT_MEMORY_SETTINGS } from '../src/shared/memory';

const dirs: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
const message = (id: number, text = 'I live in Boston.'): TelegramMessage => ({ id, text, sessionId: 'telegram-dm' });
async function setup(messages: TelegramMessage[] = [message(1)]) {
  const dir = await mkdtemp(join(tmpdir(), 'circe-telegram-test-')); dirs.push(dir);
  const store = await FactStore.open(join(dir, 'memory.sqlite'));
  await store.configure({ ...DEFAULT_MEMORY_SETTINGS, telegramEnabled: true });
  const model: LocalMemoryModel = {
    extract: vi.fn(async (text) => text === 'Hello.' ? [] : [{ key: 'user.home.city', text: 'The user lives in Boston.', evidence: text }]),
    embed: vi.fn(async (texts) => texts.map(() => [1, 0])), check: vi.fn(async () => 'Ready'),
  };
  const memory = new PersonalMemory(store, model);
  const reader: TelegramReader = { telegramMessages: vi.fn(async (_profile, after) => messages.filter((m) => m.id > after)) };
  const importer = new TelegramCapture(store, memory, reader, async () => ['default']);
  return { dir, store, model, memory, reader, importer };
}

describe('Telegram fact capture', () => {
  it('persists facts, provenance and cursor together, and does not replay after restart', async () => {
    const h = await setup([message(1), message(2, 'Hello.')]);
    await h.importer.sweep();
    expect(h.memory.view().facts[0]).toMatchObject({ channel: 'telegram', profileId: 'default', sessionId: 'telegram-dm' });
    expect(h.store.telegramCursor('default')).toBe(2);
    expect(h.memory.telegram.error).toBeNull();
    const reopened = await FactStore.open(h.store.path);
    const next = new TelegramCapture(reopened, new PersonalMemory(reopened, h.model), h.reader, async () => ['default']);
    await next.sweep();
    expect(h.model.extract).toHaveBeenCalledTimes(2);
    expect(h.reader.telegramMessages).toHaveBeenLastCalledWith('default', 2, reopened.telegramSince());
  });

  it('retries model failures without advancing the cursor or losing the message', async () => {
    const h = await setup();
    vi.mocked(h.model.extract).mockRejectedValueOnce(new Error('Ollama offline'));
    await h.importer.sweep();
    expect(h.store.telegramCursor('default')).toBe(0);
    expect(h.memory.telegram.error).toContain('Ollama offline');
    await h.importer.sweep();
    expect(h.store.telegramCursor('default')).toBe(1);
    expect(h.store.facts()).toHaveLength(1);
    expect(h.memory.telegram.error).toBeNull();
  });

  it('does not advance the cursor when the atomic database write fails', async () => {
    const h = await setup();
    const backup = h.store.path + '.backup';
    await rename(h.store.path, backup); await mkdir(h.store.path);
    await h.importer.sweep();
    expect(h.store.facts()).toHaveLength(0);
    expect(h.store.telegramCursor('default')).toBe(0);
    await rm(h.store.path, { recursive: true }); await rename(backup, h.store.path);
    await h.importer.sweep();
    expect(h.store.telegramCursor('default')).toBe(1);
    expect(h.store.facts()).toHaveLength(1);
  });

  it('skips empty and oversized messages without blocking later capture', async () => {
    const h = await setup([message(1, ''), message(2, 'x'.repeat(12_001)), message(3)]);
    await h.importer.sweep();
    expect(h.model.extract).toHaveBeenCalledTimes(1);
    expect(h.store.telegramCursor('default')).toBe(3);
  });

  it('does not scan while disabled and resets the time boundary on re-enabling', async () => {
    const h = await setup();
    await h.importer.sweep();
    const since = h.store.telegramSince();
    await h.memory.configure({ ...h.store.settings(), telegramEnabled: false });
    await h.importer.sweep();
    expect(h.reader.telegramMessages).toHaveBeenCalledTimes(1);
    vi.spyOn(Date, 'now').mockReturnValue((since + 10) * 1000);
    await h.memory.configure({ ...h.store.settings(), telegramEnabled: true });
    expect(h.store.telegramSince()).toBe(since + 10);
    expect(h.store.telegramCursor('default')).toBe(0);
  });

  it('cancels pending extraction on forgetting without replaying that message later', async () => {
    const h = await setup();
    let release!: () => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const held = new Promise<void>((resolve) => { release = resolve; });
    const extract = h.model.extract;
    h.model.extract = vi.fn(async (text, known, model) => { started(); await held; return extract(text, known, model); });
    const sweep = h.importer.sweep();
    await ready;
    await h.memory.forget('user.home.city');
    release(); await sweep; await h.importer.sweep();
    expect(h.store.facts()).toHaveLength(0);
    expect(h.store.telegramCursor('default')).toBe(1);
    expect(h.model.extract).toHaveBeenCalledTimes(1);
  });

  it('keeps independent cursors for profiles and coalesces overlapping sweeps', async () => {
    const h = await setup();
    const importer = new TelegramCapture(h.store, h.memory, h.reader, async () => ['default', 'eddie']);
    await Promise.all([importer.sweep(), importer.sweep()]);
    expect(h.reader.telegramMessages).toHaveBeenCalledTimes(2);
    expect(h.store.telegramCursor('default')).toBe(1);
    expect(h.store.telegramCursor('eddie')).toBe(1);
  });

  it('discards an already-requested page when a review happens during the gateway read', async () => {
    const h = await setup();
    let release!: (messages: TelegramMessage[]) => void;
    let started!: () => void;
    const held = new Promise<TelegramMessage[]>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { started = resolve; });
    h.reader.telegramMessages = vi.fn(async (_profile, after) => { started(); return after ? [] : held; });
    const sweep = h.importer.sweep(); await ready;
    await h.memory.forget('user.home.city');
    release([message(1), message(2)]);
    await sweep; await h.importer.sweep();
    expect(h.model.extract).not.toHaveBeenCalled();
    expect(h.store.telegramCursor('default')).toBe(2);
  });

  it('forget-all disables capture and removes import cursors', async () => {
    const h = await setup(); await h.importer.sweep();
    await h.memory.forgetAll(); await h.importer.sweep();
    expect(h.store.telegramCursor('default')).toBe(0);
    expect(h.store.telegramSince()).toBe(0);
    expect(h.store.facts()).toHaveLength(0);
    expect(h.reader.telegramMessages).toHaveBeenCalledTimes(1);
  });
});
