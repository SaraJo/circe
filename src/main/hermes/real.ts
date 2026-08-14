import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { HermesProfile } from '../../shared/types';
import { hermesPaths, soulPath, type HermesPaths, type HermesRuntime } from './runtime';
import { displayNameFor, isRealSoul } from '../profiles';

const run = promisify(execFile);

/** Hermes prints its version as `Hermes Agent v0.14.0 (2026.5.16)`. */
const VERSION = /Hermes Agent v(\d+\.\d+\.\d+)/;

/** A `hermes profile list` row: an optional bullet, the id, then the model. */
const PROFILE_ROW = /^\s*[◆◇•]?\s*([a-z0-9][a-z0-9_-]*)\s+(\S+)/;

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
      const out = await this.exec(['auth', 'status'], 15_000);
      return !/no (provider|credentials)/i.test(out);
    } catch {
      return false;
    }
  }

  async listProfiles(): Promise<HermesProfile[]> {
    let stdout: string;
    try {
      stdout = await this.exec(['profile', 'list'], 20_000);
    } catch {
      return [];
    }
    const seen = new Map<string, string>();
    for (const raw of stdout.split('\n')) {
      // Strip ANSI colour before matching — `profile list` is a styled table.
      const line = raw.replace(/\[[0-9;]*m/g, '');
      const m = PROFILE_ROW.exec(line);
      if (!m) continue;
      const id = m[1]!;
      if (id === 'profile' || id === 'name') continue;
      seen.set(id, m[2]!);
    }
    if (!seen.has('default')) seen.set('default', 'unknown');

    const out: HermesProfile[] = [];
    for (const [id, model] of seen) {
      const soul = await this.readFileOrNull(soulPath(this.p.home, id));
      out.push({ id, displayName: displayNameFor(id, soul), model, isReal: isRealSoul(soul) });
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

  private async readFileOrNull(abs: string): Promise<string | null> {
    try {
      return await readFile(abs, 'utf8');
    } catch {
      return null;
    }
  }
}
