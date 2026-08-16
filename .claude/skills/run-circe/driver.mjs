// REPL driver for Circe Desktop. Commands on stdin, output on stdout.
//
// HERMES_HOME points at a throwaway sandbox so the operator's real
// ~/.hermes/SOUL.md is never touched — onboarding writes the `default`
// profile's persona, and for `default` that IS ~/.hermes/SOUL.md.
// CIRCE_HERMES_BIN stays the real hermes so ACP and derivation are genuine.
import { _electron as electron } from 'playwright-core';
import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const APP_DIR = path.resolve(import.meta.dirname, '../../..');
const SHOT_DIR = process.env.SCREENSHOT_DIR || path.join(os.tmpdir(), 'circe-shots');
const SANDBOX_HOME = process.env.CIRCE_SANDBOX_HOME || path.join(os.tmpdir(), 'circe-hermes-home');
fs.mkdirSync(SHOT_DIR, { recursive: true });
fs.mkdirSync(SANDBOX_HOME, { recursive: true });

// Credentials only — never the real SOUL.md or profiles/.
for (const f of ['auth.json', '.env', 'config.yaml']) {
  const src = path.join(os.homedir(), '.hermes', f);
  const dst = path.join(SANDBOX_HOME, f);
  if (fs.existsSync(src) && !fs.existsSync(dst)) fs.copyFileSync(src, dst);
}

let app = null;
let page = null;

const electronBin =
  process.platform === 'darwin'
    ? path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
    : path.join(APP_DIR, 'node_modules/electron/dist/electron');

function pickPage(match) {
  const ws = app.windows().filter((w) => !w.url().startsWith('devtools://'));
  if (match) return ws.find((w) => w.url().includes(match)) ?? ws[0];
  return ws[ws.length - 1];
}

const COMMANDS = {
  async launch() {
    if (app) return console.log('already launched');
    app = await electron.launch({
      executablePath: electronBin,
      args: [APP_DIR],
      env: {
        ...process.env,
        HERMES_HOME: SANDBOX_HOME,
        CIRCE_HERMES_BIN:
          process.env.CIRCE_HERMES_BIN || path.join(os.homedir(), '.local/bin/hermes'),
      },
      timeout: 30_000,
    });
    await new Promise((r) => setTimeout(r, 4_000));
    page = pickPage();
    console.log('launched. sandbox:', SANDBOX_HOME);
    for (const w of app.windows()) console.log(' ', w.url());
  },

  /** Re-point at another window. The tile opens as a second window and the
   *  wizard closes, which invalidates `page` — call `use tile` after accept. */
  async use(match) {
    page = pickPage(match || null);
    console.log('using:', page ? page.url() : '(none)');
  },

  async windows() {
    for (const w of app.windows()) console.log(' ', w.url());
  },

  async ss(name) {
    const f = path.join(SHOT_DIR, (name || `ss-${Date.now()}`) + '.png');
    await page.screenshot({ path: f });
    console.log('screenshot:', f);
  },

  async click(sel) {
    console.log(
      'click',
      sel,
      '→',
      await page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return 'NOT_FOUND';
        el.click();
        return 'OK';
      }, sel),
    );
  },

  async 'click-text'(text) {
    console.log(
      'click-text',
      JSON.stringify(text),
      '→',
      await page.evaluate((t) => {
        const els = [...document.querySelectorAll('button, a, [role="button"]')];
        const el =
          els.find((e) => e.textContent?.trim() === t) ??
          els.find((e) => e.textContent?.includes(t));
        if (!el) return 'NOT_FOUND';
        if (el.disabled) return 'DISABLED';
        el.click();
        return 'OK';
      }, text),
    );
  },

  /** Sets value through the native setter so the framework sees the input. */
  async fill(arg) {
    const i = arg.indexOf(' ');
    const [sel, val] = [arg.slice(0, i), arg.slice(i + 1)];
    console.log(
      'fill',
      sel,
      '→',
      await page.evaluate(
        ([s, v]) => {
          const el = document.querySelector(s);
          if (!el) return 'NOT_FOUND';
          const proto =
            el instanceof HTMLTextAreaElement
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return 'OK';
        },
        [sel, val],
      ),
    );
  },

  async type(text) {
    await page.keyboard.type(text, { delay: 20 });
  },
  async press(key) {
    await page.keyboard.press(key);
  },
  async focus(sel) {
    console.log(
      await page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return 'NOT_FOUND';
        el.focus();
        return 'OK';
      }, sel),
    );
  },

  async wait(sel) {
    try {
      await page.waitForSelector(sel, { timeout: 15_000 });
      console.log('found:', sel);
    } catch {
      console.log('TIMEOUT:', sel);
    }
  },

  async text(sel) {
    console.log(
      await page.evaluate(
        (s) => (s ? document.querySelector(s) : document.body)?.innerText ?? '(null)',
        sel || null,
      ),
    );
  },

  async eval(expr) {
    try {
      console.log(JSON.stringify(await page.evaluate(expr)));
    } catch (e) {
      console.log('ERROR:', e.message);
    }
  },

  /** Every interactive element on the current screen — the fastest way to
   *  find out which step the wizard is on. */
  async probe() {
    console.log(
      await page.evaluate(() =>
        [...document.querySelectorAll('button, input, textarea, select, [role="button"], a')]
          .map(
            (el) =>
              el.tagName.toLowerCase() +
              (el.id ? `#${el.id}` : '') +
              (el.disabled ? ' [disabled]' : '') +
              (el.placeholder ? ` ph=${JSON.stringify(el.placeholder)}` : '') +
              ` :: ${JSON.stringify((el.textContent || '').trim().slice(0, 60))}`,
          )
          .join('\n'),
      ),
    );
  },

  async quit() {
    if (app) await app.close().catch(() => {});
    app = null;
    page = null;
  },
  help() {
    console.log('commands:', Object.keys(COMMANDS).join(', '));
  },
};

// Electron steals the normal stdin; read the fd directly.
const stdin = fs.createReadStream(null, { fd: fs.openSync('/dev/stdin', 'r') });
const rl = readline.createInterface({ input: stdin, output: process.stdout, prompt: 'driver> ' });

rl.on('line', async (line) => {
  const t = line.trim();
  if (!t) return rl.prompt();
  const i = t.indexOf(' ');
  const cmd = i === -1 ? t : t.slice(0, i);
  const fn = COMMANDS[cmd];
  if (!fn) {
    console.log('unknown:', cmd, '— try: help');
    return rl.prompt();
  }
  try {
    await fn(i === -1 ? '' : t.slice(i + 1));
  } catch (e) {
    console.log('ERROR:', e.message);
  }
  if (cmd === 'quit') {
    rl.close();
    process.exit(0);
  }
  rl.prompt();
});
rl.on('close', async () => {
  await COMMANDS.quit();
  process.exit(0);
});

console.log('circe driver — "help" for commands, "launch" to start');
rl.prompt();
