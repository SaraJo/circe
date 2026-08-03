import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { HermesProfile } from '../../shared/types';
import { parseSoulHeading } from './soul';

/**
 * §5.4 — the realness rule.
 *
 * Hermes seeds a scaffold SOUL.md that is bare prose with no Markdown heading
 * (see `hermes_cli/default_soul.py`). Every user-configured profile observed on
 * disk starts with a level-1 heading. Named profiles under `profiles/` only
 * exist because the user ran `hermes profile create`, which is itself an
 * explicit act, so they are real regardless of their SOUL contents.
 */
export function isRealProfile(p: { isDefault: boolean; soulMarkdown: string | null }): boolean {
  if (!p.isDefault) return true;
  if (p.soulMarkdown === null) return false;
  return parseSoulHeading(p.soulMarkdown) !== null;
}

const CODING_RE = /\b(cod(e|ing)|engineer|developer|repo|git|filesystem|shell)\b/i;

/**
 * §5.5 fallback, used only for pre-existing profiles Circe found on disk that
 * never went through the Screen 5 walkthrough. An explicit role pick always wins.
 */
export function inferCodingProfile(soulMarkdown: string): boolean {
  return CODING_RE.test(soulMarkdown);
}

async function readSoul(soulPath: string): Promise<string | null> {
  try {
    return await readFile(soulPath, 'utf8');
  } catch {
    return null;
  }
}

async function buildProfile(
  id: string,
  dir: string,
  isDefault: boolean,
): Promise<HermesProfile> {
  const soulPath = join(dir, 'SOUL.md');
  const soulMarkdown = await readSoul(soulPath);
  const heading = soulMarkdown ? parseSoulHeading(soulMarkdown) : null;
  return {
    id,
    path: dir,
    soulPath,
    isDefault,
    real: isRealProfile({ isDefault, soulMarkdown }),
    displayName: heading?.name ?? id,
    tagline: heading?.tagline ?? null,
  };
}

/**
 * Enumerates every profile in a Hermes home. The root profile is `default` and
 * lives at the home directory itself; named profiles live one level down under
 * `profiles/`. Confirmed against `hermes profile show default`, which reports
 * Path: ~/.hermes for the default and ~/.hermes/profiles/<id> for the rest.
 */
export async function enumerateProfiles(hermesHome: string): Promise<HermesProfile[]> {
  try {
    await stat(hermesHome);
  } catch {
    return [];
  }

  const out: HermesProfile[] = [await buildProfile('default', hermesHome, true)];

  let entries;
  try {
    entries = await readdir(join(hermesHome, 'profiles'), { withFileTypes: true });
  } catch {
    return out;
  }

  const named = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  for (const id of named) {
    out.push(await buildProfile(id, join(hermesHome, 'profiles', id), false));
  }
  return out;
}
