import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Exactly the values `hermes login --provider` accepts on Hermes 0.14.0. */
export const PROVIDERS = [
  { id: 'nous', label: 'Nous Research' },
  { id: 'openai-codex', label: 'OpenAI' },
  { id: 'xai-oauth', label: 'xAI' },
] as const;

const URL_RE = /(https?:\/\/[^\s]+?)[.,]?(?=\s|$)/;
const CODE_RE = /\b([A-Z0-9]{4,8}-[A-Z0-9]{4,8})\b/;

/**
 * Scrapes the verification URL and user code out of `hermes login` stdout.
 *
 * COMPAT: this parses unversioned CLI output. If Hermes changes its device-flow
 * wording, this returns null and the wizard falls back to showing the raw log
 * plus a "run it in a terminal" affordance. See docs/compat-notes.md.
 */
export function parseDeviceCode(text: string): { url: string; code: string } | null {
  const url = URL_RE.exec(text)?.[1];
  const code = CODE_RE.exec(text)?.[1];
  return url && code ? { url, code } : null;
}

export interface ProviderLoginOptions {
  hermesBin: string;
  provider: string;
  env?: NodeJS.ProcessEnv;
  onPrompt?: (prompt: { url: string; code: string }) => void;
  onLog?: (line: string) => void;
}

export class ProviderLogin {
  private child: ChildProcess | null = null;
  private buffer = '';
  private prompted = false;

  constructor(private readonly opts: ProviderLoginOptions) {}

  /**
   * Runs the device flow to completion. Resolves with ok=true only when the
   * process exits 0 AND `hermes status` confirms it — never on printed text
   * alone, which is unversioned and could change meaning.
   */
  run(): Promise<{ ok: boolean; message: string }> {
    return new Promise((resolve) => {
      const env = { ...process.env, ...this.opts.env };
      this.child = spawn(
        this.opts.hermesBin,
        ['login', '--provider', this.opts.provider, '--no-browser'],
        { env, stdio: ['ignore', 'pipe', 'pipe'] },
      );

      const absorb = (chunk: Buffer) => {
        const text = chunk.toString();
        this.buffer += text;
        for (const line of text.split(/\r?\n/)) {
          if (line.trim()) this.opts.onLog?.(line);
        }
        if (!this.prompted) {
          const prompt = parseDeviceCode(this.buffer);
          if (prompt) {
            this.prompted = true;
            this.opts.onPrompt?.(prompt);
          }
        }
      };

      this.child.stdout!.on('data', absorb);
      this.child.stderr!.on('data', absorb);

      this.child.on('error', (err) =>
        resolve({ ok: false, message: `Couldn’t start the sign-in flow: ${err.message}` }),
      );

      this.child.on('exit', async (code) => {
        this.child = null;
        if (code !== 0) {
          resolve({ ok: false, message: 'Sign-in didn’t complete. You can retry, or skip and connect later.' });
          return;
        }
        try {
          await run(this.opts.hermesBin, ['status'], { env, timeout: 20_000 });
          resolve({ ok: true, message: 'Connected.' });
        } catch {
          resolve({ ok: false, message: 'Sign-in finished but Hermes couldn’t confirm it. Retry, or skip for now.' });
        }
      });
    });
  }

  cancel(): void {
    this.child?.kill();
    this.child = null;
  }
}
