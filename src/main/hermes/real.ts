import { execFile } from 'node:child_process';
import { watch } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { HermesProfile } from '../../shared/types';
import { displayNameFor, isRealSoul } from '../profiles';
import { hermesPaths, soulPath, type HermesPaths, type HermesRuntime } from './runtime';

const run = promisify(execFile);

/** Hermes prints its version as `Hermes Agent v0.14.0 (2026.5.16)`. */
const VERSION = /Hermes Agent v(\d+\.\d+\.\d+)/;

/** A `hermes profile list` row: an optional bullet, the id, then the model. */
const PROFILE_ROW = /^\s*[◆◇•]?\s*([a-z0-9][a-z0-9_-]*)\s+(\S+)/;

/**
 * Parses `hermes profile list` output into id -> model. Reports only what
 * the table actually contains — including omitting `default` entirely when
 * the table doesn't list it. Injecting a fallback for a missing `default` is
 * the caller's job (`RealHermes.listProfiles`), not this parser's.
 */
export function parseProfileRows(stdout: string): Map<string, string> {
  const seen = new Map<string, string>();
  for (const raw of stdout.split('\n')) {
    // Strip ANSI colour before matching — `profile list` is a styled table.
    const line = raw.replace(/\x1b\[[0-9;]*m/g, '');
    const m = PROFILE_ROW.exec(line);
    if (!m) continue;
    const id = m[1]!;
    if (id === 'profile' || id === 'name') continue;
    seen.set(id, m[2]!);
  }
  return seen;
}

/** `Provider:` values `hermes status` prints when nothing is configured. */
const NO_PROVIDER = /^(none|not set|-)$/i;

/**
 * Extracts the active provider from `hermes status`'s human-readable
 * `Environment` block. Returns null when there is no `Provider:` line, or
 * when its value is one of Hermes's "nothing configured" placeholders.
 *
 * This parses human-readable CLI output, not a stable machine format — if
 * Hermes ever reformats `status` and this stops matching, the fallback is
 * `hermes auth status <provider>` once per known provider instead.
 */
export function parseProviderFromStatus(stdout: string): string | null {
  const m = /^\s*Provider:\s*(\S.*?)\s*$/m.exec(stdout);
  if (!m) return null;
  const value = m[1]!;
  return NO_PROVIDER.test(value) ? null : value;
}

export class RealHermes implements HermesRuntime {
  private readonly p: HermesPaths;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.p = hermesPaths(env);
  }

  paths(): HermesPaths {
    return this.p;
  }

  private async exec(args: string[], timeout = 30_000): Promise<string> {
    const { stdout } = await run(this.p.bin, args, {
      timeout,
      env: { ...process.env, HERMES_ACCEPT_HOOKS: '1' },
      maxBuffer: 8 * 1024 * 1024,
    });
    return stdout;
  }

  async version(): Promise<string | null> {
    try {
      return VERSION.exec(await this.exec(['--version'], 10_000))?.[1] ?? null;
    } catch {
      return null;
    }
  }

  async hasProvider(): Promise<boolean> {
    try {
      const out = await this.exec(['status'], 15_000);
      return parseProviderFromStatus(out) !== null;
    } catch {
      return false;
    }
  }

  async createProfile(profileId: string, description: string): Promise<void> {
    await this.exec(['profile', 'create', profileId, '--clone', '--description', description]);
  }

  async listProfiles(): Promise<HermesProfile[]> {
    let stdout: string;
    try {
      stdout = await this.exec(['profile', 'list'], 20_000);
    } catch {
      return [];
    }
    const seen = parseProfileRows(stdout);
    if (!seen.has('default')) seen.set('default', 'unknown');

    const out: HermesProfile[] = [];
    for (const [id, model] of seen) {
      // A SOUL.md that exists but can't be read is treated as real. The
      // realness heuristic guards a destructive write, so its two error
      // directions aren't symmetric (see `profiles.ts`): calling an
      // unreadable file "scaffold" here is exactly how a hand-written
      // persona gets silently replaced. Failing toward "real" costs the user
      // a confirm screen they can decline; `writeSoul` then refuses the
      // write outright when it hits the same unreadable file.
      let soul: string | null = null;
      let unreadable = false;
      try {
        soul = await this.readFileOrNull(soulPath(this.p.home, id));
      } catch (err) {
        unreadable = true;
        console.warn(`Treating profile "${id}" as configured: ${(err as Error).message}`);
      }
      out.push({
        id,
        displayName: unreadable ? id : displayNameFor(id, soul),
        model,
        isReal: unreadable || isRealSoul(soul),
      });
    }
    return out;
  }

  async query(profileId: string, prompt: string): Promise<string> {
    // `-z` is Hermes's one-shot prompt flag; `-p` selects the profile.
    return (await this.exec(['-p', profileId, '-z', prompt], 180_000)).trim();
  }

  async readHomeFile(relPath: string): Promise<string | null> {
    return this.readFileOrNull(join(this.p.home, relPath));
  }

  async writeHomeFile(relPath: string, contents: string): Promise<void> {
    const abs = join(this.p.home, relPath);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, contents, 'utf8');
  }

  async readHomeFileBytes(relPath: string): Promise<Uint8Array | null> {
    const abs = join(this.p.home, relPath);
    try {
      return new Uint8Array(await readFile(abs));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return null;
      throw new Error(`Cannot read ${abs} (${code ?? 'unknown error'}): ${(err as Error).message}`);
    }
  }

  async writeHomeFileBytes(relPath: string, bytes: Uint8Array): Promise<void> {
    const abs = join(this.p.home, relPath);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, bytes);
  }

  watchHome(onChange: (relPath: string) => void): () => void {
    let watcher: import('node:fs').FSWatcher;
    try {
      watcher = watch(this.p.home, { recursive: true, persistent: false }, (_event, filename) => {
        // `filename` is null on some events; there is nothing to attribute
        // them to, and the caller re-enumerates anyway on the ones we forward.
        if (filename) onChange(filename.toString());
      });
    } catch (err) {
      // A home that cannot be watched costs the live-update half of the fleet:
      // tiles still open at boot, new agents just need a restart to appear.
      // Failing the app over it would be worse.
      console.warn(`Could not watch the Hermes home; new agents will need a restart.`, err);
      return () => {};
    }
    watcher.on('error', (err) => {
      console.warn('Stopped watching the Hermes home.', err);
    });
    return () => watcher.close();
  }

  /**
   * Null means *absent*, and nothing else. Swallowing every error here was
   * the last path by which Circe could destroy something unrecoverable: an
   * `EACCES` or transient I/O failure reading a hand-written `SOUL.md` read
   * back as `null`, so `isRealSoul` said "scaffold", so `writeSoul` took no
   * backup and `hasConfiguredDefault` showed no confirm — and the persona
   * was overwritten with nothing kept.
   *
   * `ENOTDIR` counts as absent too: it means a parent path component isn't a
   * directory, so the file genuinely isn't there. Everything else — the file
   * is present, we just can't read it — is raised, and callers decide.
   */
  private async readFileOrNull(abs: string): Promise<string | null> {
    try {
      return await readFile(abs, 'utf8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return null;
      throw new Error(`Cannot read ${abs} (${code ?? 'unknown error'}): ${(err as Error).message}`);
    }
  }
}
