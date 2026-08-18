import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Character } from '../../shared/types';

/**
 * In a packaged build electron-vite copies `resources/` next to the compiled
 * main bundle, so `__dirname/../resources/...` resolves directly. Under
 * vitest and `electron-vite dev`, `__dirname` is `src/main/orchestrator`
 * (source, not `out/main`), so that packaged path doesn't exist yet — walk
 * up to the repo root instead.
 */
function resolveTemplate(): string {
  const packaged = join(__dirname, '../resources/orchestrator/SOUL.template.md');
  if (existsSync(packaged)) return packaged;
  // Running from source (vitest, electron-vite dev): walk up to the repo root.
  return join(__dirname, '../../../resources/orchestrator/SOUL.template.md');
}

export const ORCHESTRATOR_TEMPLATE_PATH = resolveTemplate();

export async function loadTemplate(): Promise<string> {
  return readFile(ORCHESTRATOR_TEMPLATE_PATH, 'utf8');
}

/**
 * What goes under `## Voice`. An empty voice is not a failure — it is the
 * plain-spoken setting, and the same text a user gets after asking to be
 * spoken to plainly, so the file reads the same either way.
 */
function voiceOrPlain(voice: string): string {
  return voice.trim() || 'Speak plainly. No accent, no mannerisms, no performance.';
}

export function renderOrchestratorSoul(c: Character, template: string): string {
  // Replacer functions, not replacement strings: a plain string handed to
  // replaceAll still honours $&, $$, $`, and $' as special patterns, so a
  // derived name or tagline containing one would splice in matched text
  // instead of its own literal characters.
  return template
    .replaceAll('{{NAME}}', () => c.name)
    .replaceAll('{{TAGLINE}}', () => c.tagline)
    .replaceAll('{{FANDOM}}', () => c.fandom)
    .replaceAll('{{VOICE}}', () => voiceOrPlain(c.voice));
}
