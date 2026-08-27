import type { SoulHeading } from '../shared/types';
import { soulPath, type HermesRuntime } from './hermes/runtime';
import { findH1, isRealSoul, splitHeading } from './profiles';

/**
 * Parses the document's H1, if any, into a name and optional tagline.
 * Delegates heading detection to `profiles.ts`'s `findH1` so this always
 * agrees with `isRealSoul`/`displayNameFor` on what counts as a heading —
 * front matter, setext headings, and H2s included.
 */
export function parseSoulHeading(markdown: string): SoulHeading | null {
  const found = findH1(markdown);
  if (found === null) return null;
  return splitHeading(found.text);
}

/** Circe always writes the canonical em-dash form, whatever it read. */
export function renderSoulHeading(h: SoulHeading): string {
  return h.tagline ? `# ${h.name} — ${h.tagline}` : `# ${h.name}`;
}

/**
 * Replaces the document's heading with the canonical ATX form, or prepends
 * one to prose that has none. The rest of the document is preserved
 * byte-for-byte: a heading behind front matter is replaced in place with the
 * front matter left untouched, and a setext heading (text line + `===`
 * underline) collapses to the single canonical `# Name — tagline` line.
 */
export function withSoulHeading(markdown: string, h: SoulHeading): string {
  const line = renderSoulHeading(h);
  const found = findH1(markdown);
  if (found === null) {
    return markdown.trim() === '' ? `${line}\n` : `${line}\n\n${markdown}`;
  }
  const lines = markdown.split(/\r?\n/);
  if (found.style === 'setext') {
    // Text line + its `===` underline collapse into the single ATX line.
    lines.splice(found.lineIndex, 2, line);
  } else {
    lines[found.lineIndex] = line;
  }
  return lines.join('\n');
}

/** Matches Hermes's own backup convention: `config.yaml.bak-20260810-165402`. */
export function backupSuffix(now: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `bak-${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}` +
    `-${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`
  );
}

export interface WriteSoulOptions {
  hermes: HermesRuntime;
  profileId: string;
  contents: string;
  now?: Date;
  /** Preserve any existing prose, even when it has no H1 heading. */
  backupExisting?: boolean;
}

export interface WriteSoulResult {
  /** Path relative to the Hermes home. */
  path: string;
  /** Relative path of the backup, or null when nothing needed preserving. */
  backedUpTo: string | null;
}

/**
 * `backupSuffix` has one-second resolution, so two writes inside the same
 * UTC second want the same backup path. Never overwrite an existing backup:
 * append `-2`, `-3`, ... until a free path is found. Bounded so a
 * pathological case throws instead of silently destroying a backup.
 */
const MAX_BACKUP_ATTEMPTS = 1000;

async function freeBackupPath(hermes: HermesRuntime, base: string): Promise<string> {
  if ((await hermes.readHomeFile(base)) === null) return base;
  for (let n = 2; n <= MAX_BACKUP_ATTEMPTS; n++) {
    const candidate = `${base}-${n}`;
    if ((await hermes.readHomeFile(candidate)) === null) return candidate;
  }
  throw new Error(`writeSoul: could not find a free backup path for ${base}`);
}

/**
 * Writes a persona, preserving anything the user wrote first (Global Constraint 4).
 * An untouched scaffold is not worth preserving and is overwritten silently.
 *
 * A file that is present but unreadable stops the write dead. Backing it up
 * would mean copying bytes we were just refused, and `HermesRuntime` has no
 * copy operation to do that with — so there is no version of "proceed" here
 * that keeps the user's persona. Refusing is the only outcome that can't
 * destroy it, and the wizard's `write-failed` screen carries the reason.
 */
export async function writeSoul(opts: WriteSoulOptions): Promise<WriteSoulResult> {
  const { hermes, profileId, contents, now = new Date(), backupExisting = false } = opts;
  // soulPath with an empty home yields the home-relative path the runtime wants.
  const rel = soulPath('', profileId).replace(/^\//, '');

  let existing: string | null;
  try {
    existing = await hermes.readHomeFile(rel);
  } catch (err) {
    throw new Error(
      `Refusing to overwrite ${rel}: it exists but couldn't be read, so it can't be ` +
        `backed up first. Nothing was changed. (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  let backedUpTo: string | null = null;
  if (existing !== null && (backupExisting || isRealSoul(existing))) {
    const base = `${rel}.${backupSuffix(now)}`;
    backedUpTo = await freeBackupPath(hermes, base);
    await hermes.writeHomeFile(backedUpTo, existing!);
  }

  await hermes.writeHomeFile(rel, contents);
  return { path: rel, backedUpTo };
}
