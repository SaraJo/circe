import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DEFAULT_MEMORY_SETTINGS, type MemorySettings, type PersonalFact } from '../../shared/memory';

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
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    return new FactStore(sql, db, path);
  }

  settings(): MemorySettings {
    const row = this.db.exec("SELECT value FROM metadata WHERE key = 'settings'")[0]?.values[0];
    return row ? JSON.parse(String(row[0])) : { ...DEFAULT_MEMORY_SETTINGS };
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
      // Retain only a one-way topic hash so future automatic capture cannot resurrect it.
      db.run('INSERT OR IGNORE INTO blocked VALUES (?)', [digest(key)]);
      db.run('DELETE FROM facts WHERE key = ?', [key]);
      this.bump(db);
    });
  }

  forgetAll(): Promise<void> {
    return this.mutate((db) => {
      for (const fact of this.facts()) db.run('INSERT OR IGNORE INTO blocked VALUES (?)', [digest(fact.key)]);
      db.run('DELETE FROM facts');
      // Stop future capture too; otherwise a clean slate would refill immediately.
      db.run("INSERT OR REPLACE INTO metadata VALUES ('settings', ?)", [JSON.stringify({ ...this.settings(), enabled: false })]);
      this.bump(db);
    });
  }

  edit(fact: StoredFact, expectedRevision: number): Promise<void> {
    return this.mutate((db) => {
      if (this.revision() !== expectedRevision) throw new Error('Memory changed. Refresh and try again.');
      db.run('UPDATE facts SET data = ? WHERE key = ?', [JSON.stringify(fact), fact.key]);
      this.bump(db);
    });
  }
}
