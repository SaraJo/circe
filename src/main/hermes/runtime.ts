import { homedir } from 'node:os';
import { join } from 'node:path';
import type { HermesProfile } from '../../shared/types';

export interface HermesPaths {
  bin: string;
  home: string;
}

/** Env overrides exist so tests and the fake can point somewhere harmless. */
export function hermesPaths(env: NodeJS.ProcessEnv = process.env): HermesPaths {
  return {
    bin: env.CIRCE_HERMES_BIN ?? join(homedir(), '.local', 'bin', 'hermes'),
    home: env.HERMES_HOME ?? join(homedir(), '.hermes'),
  };
}

/** SOUL.md path for a profile. The root profile keeps its SOUL at the home root. */
export function soulPath(home: string, profileId: string): string {
  return profileId === 'default'
    ? join(home, 'SOUL.md')
    : join(home, 'profiles', profileId, 'SOUL.md');
}

/**
 * A file inside one profile's own directory, relative to the Hermes home.
 * The root profile keeps its files at the home root, exactly as `soulPath`
 * does and as `installOrchestratorSkill` already hand-rolls. Relative because
 * that is what `readHomeFile`/`writeHomeFile` take.
 */
export function profileFilePath(profileId: string, file: string): string {
  return profileId === 'default' ? file : `profiles/${profileId}/${file}`;
}

/** Everything Circe is allowed to ask of Hermes. Nothing else may shell out. */
export interface HermesRuntime {
  paths(): HermesPaths;
  /** Resolved version string, or null when Hermes is not installed. */
  version(): Promise<string | null>;
  /** Profiles on disk, including `default`, with realness already computed. */
  listProfiles(): Promise<HermesProfile[]>;
  /** True when at least one provider is authenticated. */
  hasProvider(): Promise<boolean>;
  /** One-shot non-interactive query. Returns the agent's text reply. */
  query(profileId: string, prompt: string): Promise<string>;
  /**
   * Read a file under the Hermes home. Null means the file is *absent*, and
   * only that — a file that exists but can't be read rejects, so callers
   * guarding a destructive write can tell "nothing there" from "couldn't
   * look". See `RealHermes.readFileOrNull`.
   */
  readHomeFile(relPath: string): Promise<string | null>;
  /** Write a file under the Hermes home, creating parent directories. */
  writeHomeFile(relPath: string, contents: string): Promise<void>;
}
