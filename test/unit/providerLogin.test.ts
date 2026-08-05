import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProviderLogin } from '../../src/main/hermes/provider';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOCK_BIN = resolve(HERE, '../fixtures/mock-hermes/hermes');

let home: string;

/** Base env: trace on so tests can assert which subcommands actually ran. */
function env(over: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { MOCK_HERMES_HOME: home, MOCK_HERMES_TRACE: '1', ...over };
}

function traced(name: string): unknown[] {
  const file = join(home, `${name}.log`);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'circe-login-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('ProviderLogin', () => {
  it('reports success only after `hermes status` confirms it (§5.2)', async () => {
    const login = new ProviderLogin({ hermesBin: MOCK_BIN, provider: 'nous', env: env() });
    const result = await login.run();

    expect(result).toEqual({ ok: true, message: 'Connected.' });
    expect(traced('status')).toHaveLength(1);
  });

  it('spawns `login --provider <p> --no-browser`', async () => {
    const login = new ProviderLogin({ hermesBin: MOCK_BIN, provider: 'xai-oauth', env: env() });
    await login.run();

    expect(traced('login')[0]).toEqual({
      argv: ['login', '--provider', 'xai-oauth', '--no-browser'],
    });
  });

  it('scrapes the device prompt even though the url and code arrive in different chunks', async () => {
    const prompts: { url: string; code: string }[] = [];
    const login = new ProviderLogin({
      hermesBin: MOCK_BIN,
      provider: 'nous',
      env: env(),
      onPrompt: (p) => prompts.push(p),
    });
    await login.run();

    expect(prompts).toEqual([
      { url: 'https://portal.nousresearch.com/device', code: 'ABCD-1234' },
    ]);
  });

  it('streams the raw log lines for the wizard to display', async () => {
    const lines: string[] = [];
    const login = new ProviderLogin({
      hermesBin: MOCK_BIN,
      provider: 'nous',
      env: env(),
      onLog: (l) => lines.push(l),
    });
    await login.run();

    expect(lines.some((l) => l.includes('Starting device authorization'))).toBe(true);
    expect(lines.some((l) => l.includes('ABCD-1234'))).toBe(true);
  });

  it('fails without consulting `hermes status` when login exits non-zero', async () => {
    const login = new ProviderLogin({
      hermesBin: MOCK_BIN,
      provider: 'nous',
      env: env({ MOCK_HERMES_LOGIN_EXIT: '7' }),
    });
    const result = await login.run();

    expect(result.ok).toBe(false);
    expect(result.message).toContain('You can retry');
    // Exit 0 is a precondition for even asking — a failed login never gets here.
    expect(traced('status')).toHaveLength(0);
  });

  it('refuses to trust a clean exit that `hermes status` cannot confirm (§5.2)', async () => {
    const login = new ProviderLogin({
      hermesBin: MOCK_BIN,
      provider: 'nous',
      env: env({ MOCK_HERMES_STATUS_EXIT: '1' }),
    });
    const result = await login.run();

    expect(result.ok).toBe(false);
    expect(result.message).toContain('confirm');
    expect(traced('status')).toHaveLength(1);
  });

  it('still resolves when the output carries no parseable prompt (COMPAT fallback)', async () => {
    const prompts: unknown[] = [];
    const login = new ProviderLogin({
      hermesBin: MOCK_BIN,
      provider: 'nous',
      env: env({ MOCK_HERMES_LOGIN_MODE: 'silent' }),
      onPrompt: (p) => prompts.push(p),
    });
    const result = await login.run();

    expect(prompts).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('reports a readable error when the binary does not exist', async () => {
    const login = new ProviderLogin({ hermesBin: '/nonexistent/hermes', provider: 'nous' });
    const result = await login.run();

    expect(result.ok).toBe(false);
    expect(result.message).toContain('start the sign-in flow');
  });

  it('cancel() ends a login that is still waiting on the browser', async () => {
    const lines: string[] = [];
    const login = new ProviderLogin({
      hermesBin: MOCK_BIN,
      provider: 'nous',
      env: env({ MOCK_HERMES_LOGIN_MODE: 'hang' }),
      onLog: (l) => lines.push(l),
    });
    const done = login.run();

    await vi.waitFor(() => expect(lines.length).toBeGreaterThan(0));
    login.cancel();

    const result = await done;
    expect(result.ok).toBe(false);
    expect(traced('status')).toHaveLength(0);
  });
});
