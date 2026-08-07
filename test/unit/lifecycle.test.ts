import { describe, it, expect } from 'vitest';
import { installQuitHandler, type QuitApp } from '../../src/main/lifecycle';

/** Minimal stand-in for Electron's `app`, recording what the handler does to it. */
function fakeApp() {
  const listeners: ((e: { preventDefault(): void }) => void)[] = [];
  const calls = { quit: 0, prevented: 0 };
  const app: QuitApp = {
    on(_event, listener) {
      listeners.push(listener);
    },
    quit() {
      calls.quit++;
      // Electron re-emits before-quit on every quit() call.
      emitBeforeQuit();
    },
  };
  function emitBeforeQuit() {
    for (const l of [...listeners]) l({ preventDefault: () => calls.prevented++ });
  }
  return { app, calls, emitBeforeQuit };
}

/** A promise whose resolution the test controls. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('installQuitHandler', () => {
  it('holds the quit open until teardown resolves', async () => {
    const { app, calls, emitBeforeQuit } = fakeApp();
    const gate = deferred();
    installQuitHandler(app, () => gate.promise);

    emitBeforeQuit();

    // Teardown is still running: the quit must have been blocked, not allowed
    // to proceed into Electron's window/isolate destruction.
    expect(calls.prevented).toBe(1);
    expect(calls.quit).toBe(0);

    gate.resolve();
    await new Promise((r) => setImmediate(r));

    // Only now may the app actually go down.
    expect(calls.quit).toBe(1);
  });

  it('still quits when teardown fails, so a bad save cannot trap the app open', async () => {
    const { app, calls, emitBeforeQuit } = fakeApp();
    installQuitHandler(app, () => Promise.reject(new Error('disk full')));

    emitBeforeQuit();
    await new Promise((r) => setImmediate(r));

    expect(calls.quit).toBe(1);
  });

  it('runs teardown once however many times before-quit fires', async () => {
    const { app, emitBeforeQuit } = fakeApp();
    let runs = 0;
    installQuitHandler(app, () => {
      runs++;
      return Promise.resolve();
    });

    // window-all-closed calling app.quit() re-enters before-quit.
    emitBeforeQuit();
    emitBeforeQuit();
    await new Promise((r) => setImmediate(r));

    expect(runs).toBe(1);
  });
});
