import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HermesProfile, SoulHeading } from '../../shared/types';
import { withSoulHeading } from './soul';
import { enumerateProfiles } from './profiles';
import { execEnvFor } from './locate';

const run = promisify(execFile);

const RESERVED = new Set(['default']);

/**
 * Hermes's own help text says profile names are "lowercase, alphanumeric", but
 * `deep-thought` exists and works on real installs, so hyphens and underscores
 * are accepted here. The 32-character ceiling comes from spec §6, Screen 5.
 */
const ID_RE = /^[a-z0-9][a-z0-9_-]*$/;

export function validateProfileId(
  id: string,
  taken: string[],
): { ok: true } | { ok: false; message: string } {
  if (!id) return { ok: false, message: 'Name can’t be empty.' };
  if (id.length > 32) return { ok: false, message: 'Name can’t be longer than 32 characters.' };
  if (!ID_RE.test(id)) {
    return {
      ok: false,
      message: 'Use lowercase letters, numbers, hyphens, and underscores. Start with a letter or number.',
    };
  }
  if (RESERVED.has(id)) return { ok: false, message: 'That name is reserved by Hermes.' };
  if (taken.includes(id)) return { ok: false, message: 'A profile with that name already exists.' };
  return { ok: true };
}

export interface CreateProfileOptions {
  hermesBin: string;
  hermesHome: string;
  id: string;
  heading: SoulHeading;
  /** Optional free-text persona body from Screen 5, panel 5. */
  persona?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Creates one profile and writes its display-name heading. Touches nothing else
 * on disk — §4.9 forbids modifying any profile the user did not explicitly ask
 * Circe to modify, and §10.6 asserts it by hash.
 */
export async function createProfile(opts: CreateProfileOptions): Promise<HermesProfile> {
  const { hermesBin, hermesHome, id, heading, persona } = opts;

  // See execEnvFor in locate.ts: execFile's `env` option replaces rather than
  // merges, so a caller-supplied `env` needs the ambient PATH topped up to
  // keep resolving a shebang interpreter.
  const execEnv = execEnvFor(opts.env);

  const existing = await enumerateProfiles(hermesHome);
  const check = validateProfileId(id, existing.map((p) => p.id));
  if (!check.ok) throw new Error(check.message);

  // Hermes owns profile creation — Circe never scaffolds a profile directory
  // itself (§4.7). `profile create` is non-interactive and takes flags.
  try {
    await run(hermesBin, ['profile', 'create', id], { env: execEnv, timeout: 60_000 });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr?.trim();
    throw new Error(stderr || `Couldn’t create the profile "${id}".`);
  }

  const soulPath = join(hermesHome, 'profiles', id, 'SOUL.md');
  let existingSoul = '';
  try {
    existingSoul = await readFile(soulPath, 'utf8');
  } catch {
    existingSoul = '';
  }

  const body = persona?.trim() ? `${persona.trim()}\n` : existingSoul;
  await writeFile(soulPath, withSoulHeading(body, heading), 'utf8');

  const created = (await enumerateProfiles(hermesHome)).find((p) => p.id === id);
  if (!created) throw new Error(`Created "${id}" but couldn’t read it back.`);
  return created;
}
