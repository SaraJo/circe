import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HermesRuntime } from '../hermes/runtime';

export const SKILL_NAME = 'circe-orchestrator';

function resolveSkill(): string {
  const rel = `resources/orchestrator/skills/${SKILL_NAME}/SKILL.md`;
  const packaged = join(__dirname, '..', rel);
  if (existsSync(packaged)) return packaged;
  return join(__dirname, '../../..', rel);
}

export const SKILL_SOURCE_PATH = resolveSkill();

/**
 * Installs the skill into one profile's own skills directory. The default
 * profile's skills live at the home root; a named profile's live under it.
 * Either way this is one profile's directory, never the shared global set.
 */
export async function installOrchestratorSkill(
  hermes: HermesRuntime,
  profileId: string,
): Promise<string> {
  const rel =
    profileId === 'default'
      ? `skills/${SKILL_NAME}/SKILL.md`
      : `profiles/${profileId}/skills/${SKILL_NAME}/SKILL.md`;
  await hermes.writeHomeFile(rel, await readFile(SKILL_SOURCE_PATH, 'utf8'));
  return rel;
}
