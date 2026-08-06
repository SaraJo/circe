import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

/** sha256 of every file under `dir`, keyed by relative path. */
export function hashTree(
  dir: string,
  skip: (rel: string) => boolean = () => false,
): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string, prefix: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (skip(rel)) continue;
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full, rel);
      else if (entry.isFile())
        out[rel] = createHash('sha256').update(readFileSync(full)).digest('hex');
    }
  };
  if (statSync(dir, { throwIfNoEntry: false })) walk(dir, '');
  return out;
}
