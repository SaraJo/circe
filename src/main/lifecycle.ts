/** The slice of Electron's `app` the quit handler needs, so tests can fake it. */
export interface QuitApp {
  on(event: 'before-quit', listener: (e: { preventDefault(): void }) => void): void;
  quit(): void;
}

/**
 * Makes an asynchronous teardown safe to run on quit.
 *
 * Electron's quit sequence is synchronous: once `before-quit` returns, it
 * proceeds to destroy windows and dispose the V8 isolate. Teardown work that is
 * merely *started* in the handler keeps running into that destruction, and its
 * continuations resume on an isolate that no longer exists.
 *
 * So the first `before-quit` cancels the quit, runs teardown to completion, and
 * only then quits for real. The second pass is let through untouched.
 */
export function installQuitHandler(app: QuitApp, teardown: () => Promise<void>): void {
  let tearingDown = false;

  app.on('before-quit', (e) => {
    if (tearingDown) return;
    tearingDown = true;
    e.preventDefault();
    // A failed teardown must not trap the app open — quit either way, and say
    // what went wrong, because this is the path that persists the state file.
    void teardown().then(
      () => app.quit(),
      (err) => {
        console.error('Circe: teardown failed, quitting anyway.', err);
        app.quit();
      },
    );
  });
}
