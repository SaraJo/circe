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

const VERSION_RE = /(?:Hermes Agent v)?(\d+\.\d+(?:\.\d+)?)/;

export function parseVersion(stdout: string): string | null {
  const m = VERSION_RE.exec(stdout.trim());
  return m ? m[1]! : null;
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

  // execFile's `env` option replaces the child's entire environment rather than
  // merging with it. `bin` is already an absolute path, so the child doesn't
  // need PATH to find *itself* — but if it's a shebang script (as the mock
  // fixture is, and as some real installs are), its interpreter is resolved
  // via PATH too, and a real GUI app's inherited PATH is already minimal
  // (see the ~/.local/bin fallback above). So the exec environment inherits
  // the real process environment and layers the caller's overrides on top,
  // appending rather than replacing PATH, instead of using the caller's env
  // (which exists to steer *lookup*, i.e. findOnPath) verbatim.
  const execEnv: NodeJS.ProcessEnv = { ...process.env, ...env };
  if (env.PATH) {
    execEnv.PATH = process.env.PATH ? `${process.env.PATH}${delimiter}${env.PATH}` : env.PATH;
  }

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
