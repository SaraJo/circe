import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { homedir } from 'node:os';

const run = promisify(execFile);

/** Declared in the README and enforced here (§8.1). */
export const MIN_HERMES_VERSION = '0.14.0';

export type HermesLocation =
  | { ok: true; bin: string; version: string }
  | {
      ok: false;
      reason: 'not-found' | 'unreadable-version' | 'too-old';
      bin: string | null;
      version: string | null;
      message: string;
    };

// Anchored deliberately. An unanchored `(\d+\.\d+...)` matches the first
// number-shaped token *anywhere* in the output, so a banner like
// `Hermes Agent vnot-a-version (2026.5.16)` reports the build date as the
// version and we accept a binary whose version we never actually read. Only
// two shapes count: the `Hermes Agent v<semver>` banner, or a line that is
// nothing but a version.
const VERSION_RE = /^(?:Hermes Agent v(\d+\.\d+(?:\.\d+)?)\b|(\d+\.\d+(?:\.\d+)?)\s*$)/m;

export function parseVersion(stdout: string): string | null {
  const m = VERSION_RE.exec(stdout.trim());
  if (!m) return null;
  return m[1] ?? m[2]!;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

function findOnPath(env: NodeJS.ProcessEnv, home: string): string | null {
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, 'hermes');
    if (existsSync(candidate)) return candidate;
  }
  // The managed install puts it here, and it is frequently absent from a GUI
  // app's inherited PATH because Electron does not source a login shell.
  const fallback = join(home, '.local', 'bin', 'hermes');
  return existsSync(fallback) ? fallback : null;
}

/**
 * Resolves the environment a Hermes child process should actually run with.
 *
 * execFile's `env` option replaces the child's entire environment rather than
 * merging with it. The Hermes binary may be a shebang script (as the mock
 * fixture is, and as some real installs are), so its interpreter is resolved
 * via PATH too — and a real GUI app's inherited PATH is already minimal (see
 * the ~/.local/bin fallback above `findOnPath`).
 *
 * A caller who passes no `env` is the production case: run with
 * `process.env` untouched. A caller who deliberately passes a restricted
 * `env` — to sandbox what the subprocess sees, as tests do — gets exactly
 * that env, with only the ambient PATH appended (not the whole ambient
 * environment merged on top) so the shebang can still resolve its
 * interpreter. This keeps the `env` option able to actually restrict what
 * the subprocess sees. Shared by every call site that spawns Hermes
 * (`locateHermes` here, `createProfile` in create.ts, and the ACP session
 * launch in Task 7) so the policy lives in exactly one place.
 */
export function execEnvFor(callerEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return callerEnv
    ? {
        ...callerEnv,
        PATH: [callerEnv.PATH, process.env.PATH].filter(Boolean).join(delimiter) || undefined,
      }
    : process.env;
}

export async function locateHermes(
  opts: { env?: NodeJS.ProcessEnv; home?: string } = {},
): Promise<HermesLocation> {
  const env = opts.env ?? process.env;
  const home = opts.home ?? homedir();

  const bin = findOnPath(env, home);
  if (!bin) {
    return {
      ok: false,
      reason: 'not-found',
      bin: null,
      version: null,
      message: 'Hermes isn’t installed. Circe can install it, or you can run the installer yourself and retry.',
    };
  }

  const execEnv = execEnvFor(opts.env);

  let stdout: string;
  try {
    ({ stdout } = await run(bin, ['--version'], { env: execEnv, timeout: 10_000 }));
  } catch {
    return {
      ok: false,
      reason: 'unreadable-version',
      bin,
      version: null,
      message: `Found Hermes at ${bin} but couldn’t run it. Check that it’s executable.`,
    };
  }

  const version = parseVersion(stdout);
  if (!version) {
    return {
      ok: false,
      reason: 'unreadable-version',
      bin,
      version: null,
      message: `Couldn’t read a version from ${bin}. Circe needs Hermes ${MIN_HERMES_VERSION} or newer.`,
    };
  }

  if (compareVersions(version, MIN_HERMES_VERSION) < 0) {
    return {
      ok: false,
      reason: 'too-old',
      bin,
      version,
      message: `Hermes ${version} is too old. Circe needs ${MIN_HERMES_VERSION} or newer — run \`hermes update\`.`,
    };
  }

  // Newer than tested-against is fine; §8.1 forbids failing closed on that alone.
  return { ok: true, bin, version };
}
