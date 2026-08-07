# ADR 0012 — Asynchronous teardown holds the quit open

**Date:** 2026-08-07
**Status:** Accepted
**Spec reference:** §10.5, §6.3.4

> Recorded after the Phase 1 plan was written, in response to a defect found by
> Task 17. The plan's ADR list ends at 0011.

## Question

Circe's teardown is asynchronous: closing a tile persists its bounds, and the
state file is written with three filesystem hops (`mkdir` → `writeFile` →
`rename`). Electron's quit sequence is synchronous — once `before-quit` returns,
it destroys windows and disposes the V8 isolate. How does async teardown run
safely against that?

## Options considered

- **A — Start teardown in `before-quit` and let the quit proceed.** Simple, no
  lifecycle gymnastics.
- **B — Make teardown synchronous.** Use `writeFileSync` so nothing outlives the
  handler.
- **C — Hold the quit open.** `preventDefault()` the first `before-quit`, run
  teardown to completion, then quit for real.

## Decision

**C.** `installQuitHandler` (`src/main/lifecycle.ts`) cancels the first
`before-quit`, awaits teardown, and only then calls `app.quit()`. The second
pass is let through untouched.

Teardown is `TileManager.shutdown()` followed by `StateStore.whenIdle()`, so
every queued write — including the unawaited ones `closeTile` fires — is durable
before the process goes down.

If teardown rejects, Circe quits anyway and logs the reason. An unquittable app
is a worse failure than a lost save.

## Reasoning

Option A is what Circe originally shipped, and it is a genuine memory-safety bug,
not merely untidy. Instrumenting the quit path showed `will-quit` and `quit`
both firing while `store.save()` was still pending — its continuation had been
scheduled to resume on an isolate Electron was concurrently disposing. The
observed result was a `SIGSEGV` in `v8::HandleScope::HandleScope(v8::Isolate*)`,
reached from `-[NSWindow __close]` re-entering V8, plus an intermittent hang on
quit. Exposure scaled with tile count, because each open tile adds another
unawaited write racing the teardown.

Option B would work, but it buys safety by making every future teardown step
synchronous too. Killing a subprocess, flushing an ACP session, or awaiting
anything at all would reintroduce the bug, and `writeFileSync` gives up the
atomic temp-file-plus-rename that makes the state file crash-safe in the first
place (`store.ts`). It trades a durable invariant for a narrower one.

Option C fixes the category rather than the instance: *any* async teardown work
added later is covered, because the quit is already being held. It is also the
pattern Electron's `before-quit` event is designed for — `preventDefault` exists
precisely so an app can finish work before going down.

The guard flag matters as much as the `preventDefault`. `window-all-closed`
calls `app.quit()`, and the re-quit at the end of teardown re-enters
`before-quit`; without the flag the handler would cancel its own quit forever
and the app could never exit.

**Verified:** the E2E suite went from a 4.2-minute run with one timeout failure
to three consecutive 8/8 runs at 14 seconds each, with zero crash reports.

## How this can break

The invariant is "no async work outlives `before-quit`," and nothing enforces it
mechanically. Code added directly to a `before-quit`, `will-quit`, or
`window-all-closed` listener — rather than inside the `installQuitHandler`
teardown callback — reintroduces exactly this bug, and it will present as an
unrelated intermittent E2E failure somewhere else in the suite.

Teardown now blocks the quit, so a hung await there makes Circe unquittable
until force-killed. The rejection path is handled; an await that never settles is
not. If teardown grows anything that can block indefinitely — a subprocess that
ignores `SIGTERM`, a network call — it needs its own timeout.

`test/unit/lifecycle.test.ts` covers the hold, the failure path, and the
run-once guard, but it fakes `app`. That the real Electron `before-quit` honours
`preventDefault` the way the fake does rests on the E2E suite.
