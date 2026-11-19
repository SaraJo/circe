import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { profileFilePath, type HermesPaths } from './runtime';

export interface TelegramMessage { id: number; sessionId: string; text: string }
export interface TelegramReader {
  telegramMessages(profileId: string, afterId: number, since: number): Promise<TelegramMessage[]>;
}

// Read committed WAL rows through standard SQLite, without copying or writing
// the gateway database. No Telegram credentials or network requests.
export const TELEGRAM_QUERY = `
import json, pathlib, sqlite3, sys
root, after, since = pathlib.Path(sys.argv[1]), int(sys.argv[2]), float(sys.argv[3])
path = root / 'state.db'
if not path.exists():
    print('[]')
    sys.exit(0)
catalog = root / 'sessions' / 'sessions.json'
direct = set()
if catalog.exists():
    entries = json.loads(catalog.read_text(encoding='utf-8'))
    for entry in entries.values():
        if not isinstance(entry, dict) or entry.get('platform') != 'telegram' or entry.get('chat_type') != 'dm':
            continue
        for key in ('session_id', 'prev_session_id'):
            if isinstance(entry.get(key), str):
                direct.add(entry[key])
db = sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True, timeout=2)
db.execute('PRAGMA query_only = ON')
columns = {row[1] for row in db.execute('PRAGMA table_info(sessions)')}
message_columns = {row[1] for row in db.execute('PRAGMA table_info(messages)')}
if not columns or not message_columns:
    raise RuntimeError('Hermes gateway history has no supported sessions/messages tables.')
scope = []
params = [after, since]
if 'chat_type' in columns:
    scope.append("s.chat_type IN ('dm', 'private')")
if direct:
    scope.append('m.session_id IN (' + ','.join('?' for _ in direct) + ')')
    params.extend(sorted(direct))
if not scope:
    print('[]')
    sys.exit(0)
original = ' AND COALESCE(m._compressed_summary, 0) = 0' if '_compressed_summary' in message_columns else ''
query = """SELECT m.id, m.session_id,
    CASE WHEN length(m.content) <= 12000 THEN m.content ELSE '' END
    FROM messages m JOIN sessions s ON s.id = m.session_id
    WHERE m.id > ? AND m.timestamp >= ? AND s.source = 'telegram'
    AND m.role = 'user' AND (""" + ' OR '.join(scope) + ')' + original + ' ORDER BY m.id LIMIT 20'
rows = db.execute(query, params).fetchall()
print(json.dumps([{'id': row[0], 'sessionId': row[1], 'text': row[2] or ''} for row in rows]))
`;

const run = promisify(execFile);

export class LocalTelegramReader implements TelegramReader {
  private python: string | undefined;
  constructor(private paths: HermesPaths) {}

  private async interpreter(): Promise<string> {
    if (this.python) return this.python;
    const executable = process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python';
    for (const candidate of [
      join(this.paths.home, 'hermes-agent', 'venv', executable),
      join(this.paths.home, 'hermes-agent', '.venv', executable),
      join(dirname(this.paths.bin), process.platform === 'win32' ? 'python.exe' : 'python3'),
    ]) {
      try { await access(candidate); this.python = candidate; return candidate; } catch { /* Try the next standard installation. */ }
    }
    return process.platform === 'win32' ? 'python' : 'python3';
  }

  async telegramMessages(profileId: string, afterId: number, since: number): Promise<TelegramMessage[]> {
    if (!/^(?:default|[a-z0-9][a-z0-9_-]*)$/.test(profileId)) throw new Error('Invalid Telegram profile.');
    const root = profileId === 'default' ? this.paths.home : join(this.paths.home, profileFilePath(profileId, ''));
    let stdout: string;
    try {
      ({ stdout } = await run(await this.interpreter(), ['-I', '-c', TELEGRAM_QUERY, root, String(afterId), String(since)], {
        timeout: 10_000, maxBuffer: 1024 * 1024, windowsHide: true,
      }));
    } catch (e) {
      const failure = e as { code?: string; stderr?: string };
      if (failure.code === 'ENOENT') throw new Error('Telegram capture needs the Python runtime installed with Hermes.');
      const detail = failure.stderr?.trim().split('\n').at(-1)?.slice(0, 240);
      throw new Error(`Could not read local Telegram history${detail ? `: ${detail}` : '. Check that the Hermes gateway is available.'}`);
    }
    const messages: unknown = JSON.parse(stdout);
    if (!Array.isArray(messages) || messages.length > 20 || !messages.every((m) => m && Number.isSafeInteger(m.id) && m.id > afterId && typeof m.sessionId === 'string' && typeof m.text === 'string' && m.text.length <= 12_000)) {
      throw new Error('Hermes returned invalid Telegram history.');
    }
    return messages;
  }
}
