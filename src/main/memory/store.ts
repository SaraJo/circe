import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DEFAULT_MEMORY_SETTINGS, type MemorySettings, type PersonalFact } from '../../shared/memory';
import type { ContextScope, ConversationSource, TaskCheckpoint, ContextReceipt } from '../../shared/context';

export interface StoredFact extends PersonalFact {
  vector: number[];
  model: string;
}

const digest = (key: string) => createHash('sha256').update(key).digest('hex');

/** One main-process owner; mutations publish only after an atomic file replacement. */
export class FactStore {
  private tail: Promise<unknown> = Promise.resolve();
  private constructor(private sql: SqlJsStatic, private db: Database, readonly path: string) {}

  static async open(path: string): Promise<FactStore> {
    const sql = await initSqlJs();
    let bytes: Uint8Array | undefined;
    try { bytes = await readFile(path); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    const db = new sql.Database(bytes);
    db.run(`CREATE TABLE IF NOT EXISTS facts (key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS blocked (hash TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS context_sessions (profile TEXT, session TEXT, task TEXT NOT NULL, PRIMARY KEY(profile, session));
      CREATE TABLE IF NOT EXISTS context_sources (id TEXT PRIMARY KEY, profile TEXT, task TEXT, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS context_source_scope ON context_sources(profile, task);
      CREATE TABLE IF NOT EXISTS context_checkpoints (profile TEXT, task TEXT, version INTEGER, data TEXT NOT NULL, PRIMARY KEY(profile, task, version));
      CREATE TABLE IF NOT EXISTS context_receipts (id TEXT PRIMARY KEY, profile TEXT, task TEXT, data TEXT NOT NULL);`);
    return new FactStore(sql, db, path);
  }

  settings(): MemorySettings {
    const row = this.db.exec("SELECT value FROM metadata WHERE key = 'settings'")[0]?.values[0];
    return row ? { ...DEFAULT_MEMORY_SETTINGS, ...JSON.parse(String(row[0])) } : { ...DEFAULT_MEMORY_SETTINGS };
  }

  revision(): number {
    return Number(this.db.exec("SELECT value FROM metadata WHERE key = 'revision'")[0]?.values[0]?.[0] ?? 0);
  }

  generation(): number {
    return Number(this.db.exec("SELECT value FROM metadata WHERE key = 'generation'")[0]?.values[0]?.[0] ?? 0);
  }

  facts(): StoredFact[] {
    return (this.db.exec('SELECT data FROM facts ORDER BY key')[0]?.values ?? [])
      .map((row) => JSON.parse(String(row[0])) as StoredFact);
  }

  task(scope: ContextScope): string {
    return String(this.db.exec('SELECT task FROM context_sessions WHERE profile = ? AND session = ?', [scope.profileId, scope.sessionId])[0]?.values[0]?.[0] ?? scope.sessionId);
  }

  sessions(): ContextScope[] {
    return (this.db.exec('SELECT profile, session FROM context_sessions ORDER BY profile, session')[0]?.values ?? [])
      .map(([profileId, sessionId]) => ({ profileId: String(profileId), sessionId: String(sessionId) }));
  }

  sources(profileId: string, sessionId?: string): ConversationSource[] {
    const sql = sessionId ? 'SELECT data FROM context_sources WHERE profile = ? AND task = ? ORDER BY rowid' : 'SELECT data FROM context_sources WHERE profile = ? ORDER BY rowid';
    const args = sessionId ? [profileId, this.task({ profileId, sessionId })] : [profileId];
    return (this.db.exec(sql, args)[0]?.values ?? []).map(([data]) => JSON.parse(String(data)));
  }

  source(profileId: string, id: string): ConversationSource | null {
    const row = this.db.exec('SELECT data FROM context_sources WHERE id = ? AND profile = ?', [id, profileId])[0]?.values[0];
    return row ? JSON.parse(String(row[0])) : null;
  }

  checkpoint(scope: ContextScope): TaskCheckpoint | null {
    const row = this.db.exec('SELECT data FROM context_checkpoints WHERE profile = ? AND task = ? ORDER BY version DESC LIMIT 1', [scope.profileId, this.task(scope)])[0]?.values[0];
    return row ? JSON.parse(String(row[0])) : null;
  }

  receipts(scope: ContextScope): ContextReceipt[] {
    return (this.db.exec('SELECT data FROM context_receipts WHERE profile = ? AND task = ? ORDER BY rowid DESC LIMIT 30', [scope.profileId, this.task(scope)])[0]?.values ?? [])
      .map(([data]) => JSON.parse(String(data)));
  }

  receipt(profileId: string, id: string): ContextReceipt | null {
    const row = this.db.exec('SELECT data FROM context_receipts WHERE profile = ? AND id = ?', [profileId, id])[0]?.values[0];
    return row ? JSON.parse(String(row[0])) : null;
  }

  appendSources(scope: ContextScope, sources: ConversationSource[], generation: number): Promise<void> {
    return this.mutate((db) => {
      if (this.generation() !== generation || !this.settings().enabled || !this.settings().contextEnabled) return;
      const usage = db.exec('SELECT COUNT(*), COALESCE(SUM(length(data)), 0) FROM context_sources')[0]!.values[0]!;
      if (Number(usage[0]) + sources.length > 5000 || Number(usage[1]) + JSON.stringify(sources).length > 20_000_000) throw new Error('Task history is full. Delete older task history in Memory to resume capture.');
      const task = this.task(scope);
      db.run('INSERT OR IGNORE INTO context_sessions VALUES (?, ?, ?)', [scope.profileId, scope.sessionId, task]);
      for (const source of sources) db.run('INSERT OR IGNORE INTO context_sources VALUES (?, ?, ?, ?)', [source.id, scope.profileId, task, JSON.stringify(source)]);
      this.bump(db, false);
    });
  }

  saveCheckpoint(scope: ContextScope, checkpoint: TaskCheckpoint, generation: number): Promise<void> {
    return this.mutate((db) => {
      if (this.generation() !== generation || !this.settings().enabled || !this.settings().contextEnabled) return;
      db.run('INSERT INTO context_checkpoints VALUES (?, ?, ?, ?)', [scope.profileId, this.task(scope), checkpoint.version, JSON.stringify(checkpoint)]);
      // Keep a bounded revision history; source messages remain intact.
      db.run('DELETE FROM context_checkpoints WHERE profile = ? AND task = ? AND version < ?', [scope.profileId, this.task(scope), checkpoint.version - 19]);
      this.bump(db, false);
    });
  }

  saveReceipt(receipt: ContextReceipt, generation: number): Promise<void> {
    return this.mutate((db) => {
      if (this.generation() !== generation || !this.settings().enabled) return;
      db.run('INSERT OR IGNORE INTO context_sessions VALUES (?, ?, ?)', [receipt.profileId, receipt.sessionId, this.task(receipt)]);
      db.run('INSERT OR REPLACE INTO context_receipts VALUES (?, ?, ?, ?)', [receipt.id, receipt.profileId, this.task(receipt), JSON.stringify(receipt)]);
      db.run('DELETE FROM context_receipts WHERE rowid NOT IN (SELECT rowid FROM context_receipts ORDER BY rowid DESC LIMIT 1000)');
    });
  }

  recordToolSources(profileId: string, id: string, sources: ConversationSource[], generation: number): Promise<void> {
    return this.mutate((db) => {
      const receipt = this.receipt(profileId, id);
      if (!receipt || receipt.outcome !== 'prepared' || this.generation() !== generation || !this.settings().enabled || !this.settings().contextEnabled) throw new Error('Use the current context receipt_id from the prompt. This turn or its saved context is no longer active.');
      const facts = this.facts();
      const annotated = sources.map((source) => ({ ...source, text: source.text.slice(0, 1200), memoryKeys: [...new Set([
        ...(source.memoryKeys ?? []), ...facts.filter((f) => f.profileId === profileId && source.text.includes(f.evidence)).map((f) => f.key),
      ])] }));
      receipt.toolSources = [...new Map([...(receipt.toolSources ?? []), ...annotated].map((s) => [`${s.id}:${s.excerptOffset ?? 0}`, s])).values()].slice(-8);
      receipt.memoryKeys = [...new Set([...(receipt.memoryKeys ?? []), ...annotated.flatMap((s) => s.memoryKeys)])];
      db.run('UPDATE context_receipts SET data = ? WHERE profile = ? AND id = ?', [JSON.stringify(receipt), profileId, id]);
    });
  }

  linkTask(profileId: string, from: string, to: string): Promise<void> {
    return this.mutate((db) => {
      const task = this.task({ profileId, sessionId: from });
      db.run('INSERT OR IGNORE INTO context_sessions VALUES (?, ?, ?)', [profileId, from, task]);
      db.run('INSERT OR REPLACE INTO context_sessions VALUES (?, ?, ?)', [profileId, to, task]);
      this.bump(db, false);
    });
  }

  forgetTask(scope: ContextScope): Promise<void> {
    return this.mutate((db) => {
      const task = this.task(scope);
      for (const table of ['context_sources', 'context_checkpoints', 'context_receipts']) db.run(`DELETE FROM ${table} WHERE profile = ? AND task = ?`, [scope.profileId, task]);
      // Keep lineage so an existing continuation cannot rediscover a forgotten parent.
      this.bump(db);
    });
  }

  private invalidateFactContexts(db: Database, key: string): void {
    const affected = new Map<string, ContextScope>();
    const add = (scope: ContextScope) => affected.set(JSON.stringify([scope.profileId, this.task(scope)]), scope);
    const fact = this.facts().find((f) => f.key === key);
    if (fact) add(fact);
    for (const [json] of db.exec('SELECT data FROM context_sources')[0]?.values ?? []) {
      const source = JSON.parse(String(json)) as ConversationSource;
      if (source.memoryKeys?.includes(key)) add(source);
    }
    for (const [json] of db.exec('SELECT data FROM context_receipts')[0]?.values ?? []) {
      const receipt = JSON.parse(String(json)) as ContextReceipt;
      if (receipt.facts.some((f) => f.key === key) || receipt.memoryKeys?.includes(key) || receipt.checkpoint?.memoryKeys?.includes(key) || receipt.toolSources?.some((s) => s.memoryKeys?.includes(key))) add(receipt);
    }
    for (const scope of affected.values()) {
      for (const table of ['context_sources', 'context_checkpoints']) db.run(`DELETE FROM ${table} WHERE profile = ? AND task = ?`, [scope.profileId, this.task(scope)]);
    }
    db.run('DELETE FROM context_receipts');
  }

  private mutate(change: (db: Database) => void): Promise<void> {
    const work = this.tail.then(async () => {
      const next = new this.sql.Database(this.db.export());
      // SQLite normally leaves deleted text in free pages of the exported file.
      next.run('PRAGMA secure_delete = ON');
      const temp = `${this.path}.${randomUUID()}.tmp`;
      try {
        change(next);
        await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
        await writeFile(temp, next.export(), { mode: 0o600 });
        await rename(temp, this.path);
        this.db.close();
        this.db = next;
      } catch (e) {
        next.close();
        await rm(temp, { force: true }).catch(() => {});
        throw e;
      }
    });
    this.tail = work.catch(() => {});
    return work;
  }

  private bump(db: Database, review = true): void {
    db.run("INSERT OR REPLACE INTO metadata VALUES ('revision', ?)", [String(this.revision() + 1)]);
    if (review) db.run("INSERT OR REPLACE INTO metadata VALUES ('generation', ?)", [String(this.generation() + 1)]);
  }

  configure(settings: MemorySettings, reindexed?: StoredFact[], expectedRevision?: number): Promise<void> {
    return this.mutate((db) => {
      if (expectedRevision !== undefined && this.revision() !== expectedRevision) throw new Error('Memory changed. Refresh and try again.');
      for (const fact of reindexed ?? []) db.run('UPDATE facts SET data = ? WHERE key = ?', [JSON.stringify(fact), fact.key]);
      db.run("INSERT OR REPLACE INTO metadata VALUES ('settings', ?)", [JSON.stringify(settings)]);
      this.bump(db);
    });
  }

  /** A review action invalidates every in-flight capture, even across profiles. */
  put(facts: StoredFact[], expectedGeneration: number): Promise<void> {
    return this.mutate((db) => {
      if (this.generation() !== expectedGeneration || !this.settings().enabled) return;
      for (const fact of facts) {
        const blocked = db.exec('SELECT 1 FROM blocked WHERE hash = ?', [digest(fact.key)]);
        if (blocked.length) continue;
        db.run('INSERT OR REPLACE INTO facts VALUES (?, ?)', [fact.key, JSON.stringify(fact)]);
      }
      this.bump(db, false);
    });
  }

  forget(key: string): Promise<void> {
    return this.mutate((db) => {
      this.invalidateFactContexts(db, key);
      // Retain only a one-way topic hash so future automatic capture cannot resurrect it.
      db.run('INSERT OR IGNORE INTO blocked VALUES (?)', [digest(key)]);
      db.run('DELETE FROM facts WHERE key = ?', [key]);
      // Receipts contain snapshots of personal facts. A forgotten fact must leave them too.
      db.run('DELETE FROM context_receipts');
      this.bump(db);
    });
  }

  forgetAll(): Promise<void> {
    return this.mutate((db) => {
      for (const fact of this.facts()) db.run('INSERT OR IGNORE INTO blocked VALUES (?)', [digest(fact.key)]);
      db.run('DELETE FROM facts');
      db.run('DELETE FROM context_sources; DELETE FROM context_checkpoints; DELETE FROM context_receipts; DELETE FROM context_sessions;');
      // Stop future capture too; otherwise a clean slate would refill immediately.
      db.run("INSERT OR REPLACE INTO metadata VALUES ('settings', ?)", [JSON.stringify({ ...this.settings(), enabled: false })]);
      this.bump(db);
    });
  }

  edit(fact: StoredFact, expectedRevision: number): Promise<void> {
    return this.mutate((db) => {
      if (this.revision() !== expectedRevision) throw new Error('Memory changed. Refresh and try again.');
      this.invalidateFactContexts(db, fact.key);
      db.run('UPDATE facts SET data = ? WHERE key = ?', [JSON.stringify(fact), fact.key]);
      this.bump(db);
    });
  }
}
