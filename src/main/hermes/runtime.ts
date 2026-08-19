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

/**
 * A profile's face. Constraint 6 fixes the filename and constraint 10 fixes the
 * location: the face is an agent fact, so it lives with the agent, and the
 * default profile keeps its files at the home root exactly as `SOUL.md` does.
 * A user or an agent that drops an `avatar.png` here gets a face with no
 * involvement from Circe at all.
 */
export function avatarPath(profileId: string): string {
  return profileFilePath(profileId, 'avatar.png');
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
  /**
   * Read a file under the Hermes home as bytes. Null means absent, matching
   * `readHomeFile`'s contract exactly: a file that exists but cannot be read
   * rejects, so a caller can tell "nothing there" from "couldn't look".
   *
   * Separate from `readHomeFile` rather than replacing it because an avatar is
   * the only binary thing Circe touches, and forcing every persona read through
   * a Buffer would make the common case worse to serve the rare one.
   */
  readHomeFileBytes(relPath: string): Promise<Uint8Array | null>;
  /** Write bytes under the Hermes home, creating parent directories. */
  writeHomeFileBytes(relPath: string, bytes: Uint8Array): Promise<void>;
  /**
   * Watches the Hermes home for changes, calling back with the path that
   * changed, relative to the home. Returns a function that stops watching.
   *
   * Recursive, because `profiles/` does not exist on a fresh install and
   * watching a directory that is not there fails rather than waiting for it.
   * macOS only (constraint 1), which is where recursive watching works.
   */
  watchHome(onChange: (relPath: string) => void): () => void;
}
