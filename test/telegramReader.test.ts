import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalTelegramReader } from '../src/main/hermes/telegram';

const dirs: string[] = [];
const writers: ChildProcess[] = [];
afterEach(async () => {
  for (const writer of writers.splice(0)) { writer.stdin?.end(); await once(writer, 'exit'); }
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

// Keep the connection open: new rows live in WAL, not in the main SQLite file.
const fixture = `
import json, pathlib, sqlite3, sys
root = pathlib.Path(sys.argv[1]); (root / 'sessions').mkdir()
(root / 'sessions' / 'sessions.json').write_text(json.dumps({
 'direct': {'platform':'telegram', 'chat_type':'dm', 'session_id':'dm'},
 'group': {'platform':'telegram', 'chat_type':'group', 'session_id':'group'}
}))
db = sqlite3.connect(root / 'state.db')
db.execute('PRAGMA journal_mode=WAL')
db.executescript('CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT); CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, timestamp REAL, _compressed_summary INTEGER DEFAULT 0);')
db.executemany('INSERT INTO sessions VALUES (?, ?)', [('dm','telegram'),('group','telegram'),('cron','cron'),('window','acp')])
db.executemany('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?)', [
 (1,'dm','user','old personal fact',100,0),
 (2,'dm','assistant','assistant claim',300,0),
 (3,'group','user','group message',300,0),
 (4,'cron','user','scheduled job',300,0),
 (5,'window','user','already captured by Circe',300,0),
 (6,'dm','user','synthetic summary',300,1)
])
db.executemany('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?)', [(i,'dm','user','I live in Boston.',300,0) for i in range(7,32)])
if sys.argv[2] == 'columns':
    db.execute('ALTER TABLE sessions ADD COLUMN chat_type TEXT')
    db.execute("UPDATE sessions SET chat_type = 'dm' WHERE id = 'dm'")
    (root / 'sessions' / 'sessions.json').unlink()
db.commit()
print('ready', flush=True)
sys.stdin.read()
`;

describe('local Hermes Telegram reader', () => {
  it.each(['catalog', 'columns'])('reads committed WAL rows and excludes other sources using %s', async (mode) => {
    const home = await mkdtemp(join(tmpdir(), 'circe-telegram-reader-')); dirs.push(home);
    const writer = spawn(process.platform === 'win32' ? 'python' : 'python3', ['-I', '-c', fixture, home, mode], { stdio: ['pipe', 'pipe', 'pipe'] });
    writers.push(writer); await once(writer.stdout!, 'data');
    expect((await stat(join(home, 'state.db-wal'))).size).toBeGreaterThan(0);
    const reader = new LocalTelegramReader({ home, bin: join(home, 'bin', 'hermes') });
    const first = await reader.telegramMessages('default', 0, 200);
    expect(first).toHaveLength(20);
    expect(first[0]?.id).toBe(7);
    expect(first.every((message) => message.sessionId === 'dm')).toBe(true);
    const second = await reader.telegramMessages('default', first.at(-1)!.id, 200);
    expect(second).toHaveLength(5);
    expect(await reader.telegramMessages('default', second.at(-1)!.id, 200)).toEqual([]);
    expect(await reader.telegramMessages('default', 0, 400)).toEqual([]);
  });

  it('does not create missing gateway databases or accept profile path traversal', async () => {
    const home = await mkdtemp(join(tmpdir(), 'circe-telegram-missing-')); dirs.push(home);
    const reader = new LocalTelegramReader({ home, bin: join(home, 'hermes') });
    expect(await reader.telegramMessages('default', 0, 1)).toEqual([]);
    await expect(stat(join(home, 'state.db'))).rejects.toThrow();
    await expect(reader.telegramMessages('../outside', 0, 1)).rejects.toThrow('Invalid Telegram profile');
  });
});
