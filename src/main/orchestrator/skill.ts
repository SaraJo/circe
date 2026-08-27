import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HermesProfile } from '../../shared/types';
import type { HermesRuntime } from '../hermes/runtime';

export const SKILL_NAME = 'circe-orchestrator';

function resolveSkillResource(file: string): string {
  const rel = `resources/orchestrator/skills/${SKILL_NAME}/${file}`;
  const packaged = join(__dirname, '..', rel);
  if (existsSync(packaged)) return packaged;
  return join(__dirname, '../../..', rel);
}

export const SKILL_SOURCE_PATH = resolveSkillResource('SKILL.md');
export const CIRCE_REFERENCE_SOURCE_PATH = resolveSkillResource('references/circe.md');

const MANIFEST_VERSION = 1;
const MANIFEST_FILE = 'circe-managed.json';
const SHA256 = /^[0-9a-f]{64}$/;
/** Exact skill shipped in beta commit 2078945, before managed manifests existed. */
const LEGACY_SKILL_HASHES = new Set([
  'd1331fe5a4bd6dd23c7d00f3b5087d1d2c21ae943c556c5582c96d683e4ea04c',
]);

interface ManagedManifest {
  version: 1;
  /** Null means the user owns this file and Circe must never refresh it. */
  skillSha256: string | null;
  referenceSha256: string | null;
}

export interface SkillRefreshResult {
  /** Profiles where an orchestrator skill exists, whether managed or customized. */
  installedProfileIds: string[];
  /** Profiles where at least one Circe-managed file was brought up to date. */
  refreshedProfileIds: string[];
  /** Profiles containing a customized file Circe deliberately left alone. */
  preservedProfileIds: string[];
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function skillDir(profileId: string): string {
  const root = profileId === 'default' ? '' : `profiles/${profileId}/`;
  return `${root}skills/${SKILL_NAME}`;
}

function parseManifest(json: string | null): ManagedManifest | null {
  if (json === null) return null;
  try {
    const value = JSON.parse(json) as Partial<ManagedManifest>;
    if (value.version !== MANIFEST_VERSION) return null;
    const validHash = (v: unknown) => v === null || (typeof v === 'string' && SHA256.test(v));
    if (!validHash(value.skillSha256) || !validHash(value.referenceSha256)) return null;
    return value as ManagedManifest;
  } catch {
    return null;
  }
}

function serializeManifest(manifest: ManagedManifest): string {
  return JSON.stringify(manifest, null, 2);
}

/**
 * Installs the skill into one profile's own skills directory. The default
 * profile's skills live at the home root; a named profile's live under it.
 * Either way this is one profile's directory, never the shared global set.
 */
export async function installOrchestratorSkill(
  hermes: HermesRuntime,
  profileId: string,
): Promise<string> {
  const dir = skillDir(profileId);
  const skillRel = `${dir}/SKILL.md`;
  const referenceRel = `${dir}/references/circe.md`;
  const skill = await readFile(SKILL_SOURCE_PATH, 'utf8');
  const reference = await readFile(CIRCE_REFERENCE_SOURCE_PATH, 'utf8');
  await hermes.writeHomeFile(skillRel, skill);
  await hermes.writeHomeFile(referenceRel, reference);
  await hermes.writeHomeFile(
    `${dir}/${MANIFEST_FILE}`,
    serializeManifest({
      version: MANIFEST_VERSION,
      skillSha256: sha256(skill),
      referenceSha256: sha256(reference),
    }),
  );
  return skillRel;
}

/**
 * Refreshes resources Circe previously installed without overwriting edits.
 *
 * Each manifest records the exact bytes Circe last wrote. A file is eligible
 * for replacement only while its current hash still matches that record. The
 * pre-manifest beta is migrated through one allowlisted legacy hash; any other
 * unmanifested skill is treated as user-owned and left untouched.
 */
export async function refreshInstalledOrchestratorSkills(
  hermes: HermesRuntime,
  profiles: HermesProfile[],
): Promise<SkillRefreshResult> {
  const result: SkillRefreshResult = {
    installedProfileIds: [],
    refreshedProfileIds: [],
    preservedProfileIds: [],
  };
  const nextSkill = await readFile(SKILL_SOURCE_PATH, 'utf8');
  const nextReference = await readFile(CIRCE_REFERENCE_SOURCE_PATH, 'utf8');
  const nextSkillHash = sha256(nextSkill);
  const nextReferenceHash = sha256(nextReference);

  for (const profile of profiles) {
    const dir = skillDir(profile.id);
    try {
      const skillRel = `${dir}/SKILL.md`;
      const referenceRel = `${dir}/references/circe.md`;
      const manifestRel = `${dir}/${MANIFEST_FILE}`;
      const currentSkill = await hermes.readHomeFile(skillRel);
      if (currentSkill === null) continue;
      result.installedProfileIds.push(profile.id);

      const manifest = parseManifest(await hermes.readHomeFile(manifestRel));
      const currentSkillHash = sha256(currentSkill);
      const legacyManaged = manifest === null && LEGACY_SKILL_HASHES.has(currentSkillHash);
      const skillManaged = legacyManaged || manifest?.skillSha256 === currentSkillHash;

      let refreshed = false;
      let preserved = false;
      let skillSha256: string | null = manifest?.skillSha256 ?? null;
      let referenceSha256: string | null = manifest?.referenceSha256 ?? null;

      if (skillManaged) {
        if (currentSkillHash !== nextSkillHash) {
          await hermes.writeHomeFile(skillRel, nextSkill);
          refreshed = true;
        }
        skillSha256 = nextSkillHash;
      } else {
        preserved = true;
        skillSha256 = null;
      }

      const currentReference = await hermes.readHomeFile(referenceRel);
      const currentReferenceHash = currentReference === null ? null : sha256(currentReference);
      const referenceManaged = legacyManaged
        ? currentReference === null
        : manifest?.referenceSha256 !== null &&
          manifest?.referenceSha256 !== undefined &&
          manifest.referenceSha256 === currentReferenceHash;

      if (referenceManaged) {
        if (currentReferenceHash !== nextReferenceHash) {
          await hermes.writeHomeFile(referenceRel, nextReference);
          refreshed = true;
        }
        referenceSha256 = nextReferenceHash;
      } else {
        preserved = true;
        referenceSha256 = null;
      }

      // A custom unmanifested skill is not ours to annotate. Otherwise the
      // manifest records which individual files remain managed.
      if (manifest !== null || legacyManaged) {
        await hermes.writeHomeFile(
          manifestRel,
          serializeManifest({
            version: MANIFEST_VERSION,
            skillSha256,
            referenceSha256,
          }),
        );
      }
      if (refreshed) result.refreshedProfileIds.push(profile.id);
      if (preserved) result.preservedProfileIds.push(profile.id);
    } catch (err) {
      console.warn(`Could not refresh Circe's orchestrator guide for "${profile.id}".`, err);
    }
  }
  return result;
}
