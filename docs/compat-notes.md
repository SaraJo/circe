# Compat notes

Every place Circe depends on Hermes behaviour that is not versioned or documented.
When Hermes changes under us, the fix is in one of these places.

Verified against **Hermes Agent v0.14.0 (2026.5.16)**.

## 1. The `-p <profile>` global flag and `--accept-hooks`

`hermes -p <profile> acp` is the §4.3 transport. Neither `-p` nor `--accept-hooks`
appears in `hermes --help` output. They work, and the prototype relied on them, but they
are undocumented and could be renamed without a deprecation notice.

The full spawn is `['-p', <id>, 'acp', '--accept-hooks']`.

- **Used in:** `src/main/hermes/acpClient.ts` (`spawnArgs`)
- **If it breaks:** every tile fails to spawn. `acpClient` surfaces
  `hermes acp exited (<code>)` and fails all in-flight requests. Detect with
  `hermes -p <id> acp --version`.

## 2. `hermes --version` output format

Parsed by an **anchored** regex accepting exactly two shapes, per line:

```js
/^(?:Hermes Agent v(\d+\.\d+(?:\.\d+)?)\b|(\d+\.\d+(?:\.\d+)?)\s*$)/m
```

— the `Hermes Agent v<semver>` banner, or a line that is *nothing but* a version.

The anchoring is load-bearing and was added after a live defect. The original pattern
made the banner prefix optional but left the whole expression unanchored, so it matched
the first number-shaped token **anywhere** in the output. Against
`Hermes Agent vnot-a-version (2026.5.16)` it returned `2026.5.16` — the **build date** —
and reported `ok: true`, accepting a binary whose version was never actually read.

- **Used in:** `src/main/hermes/locate.ts` (`parseVersion`, `VERSION_RE`)
- **If it breaks:** Circe reports `unreadable-version` and refuses to run, with an
  actionable message rather than a stack trace.
- **Watch for:** a release that prints the version only in a third shape, or that adds a
  line matching the bare-version branch before the banner.

## 3. Profile directory layout

The `default` profile lives at the Hermes home root (`~/.hermes`); named profiles live
at `~/.hermes/profiles/<id>/`. Confirmed via `hermes profile show default`, which
reports `Path: /Users/<user>/.hermes`. Each profile's persona is `SOUL.md`.

This asymmetry is why Screen 4a creates rather than adopts — see
[ADR 0009](adr/0009-default-profile-not-adopted.md).

**Verified read-only against a real install (2026-08-04):** 8 profiles enumerated, 8
classified real, routing to Screen 4b. Root `default` is `# Trillian — Central
Coordinator`, plus seven named profiles. This is the count the E2E and manual runbooks
expect on this machine.

One profile's heading uses a comma (`# Zaphod, Wealth Planner`) where the other seven
use an em dash. `soul.ts`'s `SEPARATOR` already accepts comma, en dash, and hyphen —
that leniency is load-bearing against real data, not speculative.

- **Used in:** `src/main/hermes/profiles.ts` (`enumerateProfiles`),
  `src/main/hermes/soul.ts` (`SEPARATOR`)
- **If it breaks:** profile detection returns nothing and the wizard routes every user
  to Screen 4a as if fresh.

## 4. The scaffold SOUL.md has no heading

`hermes_cli/default_soul.py` seeds `DEFAULT_SOUL_MD`, which is bare prose. The §5.4
realness rule keys on the *absence* of a level-1 heading — see
[ADR 0004](adr/0004-real-profile-heuristic.md). If Hermes ever seeds a scaffold that
starts with `# Hermes Agent`, every fresh install would be misclassified as having a
real profile.

- **Used in:** `src/main/hermes/profiles.ts` (`isRealProfile`)
- **If it breaks:** fresh installs route to Screen 4b showing a boilerplate profile.
  Detect with the "fresh install produces zero real profiles" unit test — refresh the
  fixture against a current Hermes to exercise it.

## 5. `hermes profile create` flags and failure output

Non-interactive. Takes `--description`, `--clone`, `--no-alias`, `--no-skills`. Circe
uses **only the positional name**: `hermes profile create <id>`.

- **Used in:** `src/main/hermes/create.ts`
- **If it breaks:** agent creation fails with the CLI's own stderr surfaced to the user.

**Unverified:** the real `hermes` stderr shape for its non-zero exits. `create.ts`
forwards stderr **verbatim** into a user-facing `Error`, so a Python traceback would
become UI text and violate §1.4's copy rules. This was deliberately **not** probed —
`hermes profile create` is write-capable against the user's real `~/.hermes`, and §4.9
forbids Circe touching it uninvited. It can only be settled on a machine where a throwaway
Hermes home is acceptable.

If that check is ever run and the output is unfriendly, the fix is to key on `err.code`
for the known exits rather than forwarding raw text.

## 6. Profile name validation

`hermes profile create --help` says names are "lowercase, alphanumeric", but
`deep-thought` exists on real installs and works. Circe validates against observed
behaviour, not the help string — see
[ADR 0010](adr/0010-profile-id-vs-display-name.md):

```js
ID_RE = /^[a-z0-9][a-z0-9_-]*$/
```

- **Used in:** `src/main/hermes/create.ts` (`validateProfileId`)

**Caveat — this is untested against real Hermes.** The mock fixture's validation pattern
is byte-identical to `ID_RE` by construction, so no input can pass one and fail the
other, and the mock's rejection path is unreachable through `createProfile`'s public API.
The equivalence is a property of the **mock**, not of Hermes. If real Hermes validates
differently, that divergence is exercised only on a real install, and it surfaces through
the unverified stderr path in §5 above.

## 7. `hermes login` device-flow output

The verification URL and user code are scraped from stdout of
`hermes login --provider <nous|openai-codex|xai-oauth> --no-browser`. Success is
confirmed by exit code 0 **plus** a `hermes status` check — never by the printed text.
See [ADR 0002](adr/0002-provider-oauth.md).

- **Used in:** `src/main/hermes/provider.ts` (`parseDeviceCode`)
- **If it breaks:** `parseDeviceCode` returns `null`, the wizard shows the raw log, and
  the user can still take the Skip path.
- **Also unversioned:** the accepted `--provider` value set.

## 8. `hermes profile show` output format

Key-value lines including `Model: <model> (<provider>)`. **Not parsed in Phase 1.**
Phase 2 uses it for §5.3 image-capability detection
([ADR 0003](adr/0003-image-generation-detection.md)) and the tile's model label.
