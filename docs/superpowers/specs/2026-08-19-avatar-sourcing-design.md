# Avatar Sourcing — Design

**Status:** approved 2026-08-19, ready for an implementation plan.
**Spec:** `~/Code/circe-oss-spec.md` — constraint 4, constraint 6 (§4.6), constraint 9, constraint 10,
§6.2 Step 5, §6.3, §8.4, §9 Phase 2, §10.7.

## Goal

A character derived from a fandom gets that character's face, fetched from Wikipedia on the user's
behalf and written into the profile it belongs to. When Wikipedia has nothing usable — or has the
wrong thing — the user gets today's initials avatar and never learns a lookup happened.

## Scope

**In.** The Wikipedia lookup, the guardrails that decide whether to trust its answer, PNG storage in
the profile, delivery to the renderer, and display on the meet screen and in the tile header.

**Out, deliberately.** Upload, the file picker, circular crop, and force-initials. The spec only ever
sites those controls inside Step 5's **Adjust** affordance (§6.2) and §6.6's re-skin editor, and
Adjust is deferred until this work lands — its Face item is meaningless while initials are the only
possible face. Building the upload control now would mean designing a control we have already agreed
to redesign. They ship together, later.

Model-generated avatars are cut (§4.6, §5.3 withdrawn) and are not revisited here.

## What the spec already fixes

These are not decisions this document makes. They are constraints it obeys.

- **Three sources only** (constraint 6): a Wikipedia lookup performed by the main process, a file the
  user picked, or a locally-rendered initials avatar. The repo bundles zero images.
- **Two hosts, not one** (constraint 6): `en.wikipedia.org` for the REST summary, and
  `upload.wikimedia.org` for the thumbnail it points at. The allowlist names both and nothing else.
- **The image lands in the profile** (constraints 6 and 10): a face is an agent fact, so it lives
  with the agent. Circe keeps no private avatar directory. A user or an agent that drops an
  `avatar.png` into a profile gets a face with no involvement from Circe.
- **The renderer never loads a remote image** (constraint 6, §10.7): the main process fetches, the
  renderer only ever sees local bytes.

## Evidence: what Wikipedia actually returns

Measured 2026-08-19 against the live REST summary endpoint, fourteen character names.
**Nine of thirteen successful lookups carried a thumbnail**, every one served from
`upload.wikimedia.org`. The fourteenth returned `429`; see "Rate limiting" below.

The misses are three distinct kinds, and each has a clean signal:

| Kind | Example | Signal |
|---|---|---|
| Redirects to a list article | "Cher Horowitz" → *List of Clueless characters*; "Ogion" → *List of Earthsea characters* | resolved title begins "List of" |
| Disambiguation page | "Trillian" → type `disambiguation` | the `type` field |
| Article exists, no free image | "Samwise Gamgee" | no `thumbnail` key |

A fourth kind is the one that matters most and does not appear in that table, because the sample got
lucky: **a name that resolves cleanly to the wrong subject.** "Trillian" happened to land on a
disambiguation page, but had Wikipedia sent it to the instant-messaging client of the same name, the
lookup would have written that logo to disk and presented it as the user's agent. Redirects are not
inherently suspect — "Captain Picard" → "Jean-Luc Picard" is one we want — so "the resolved title
must match the query" is the wrong rule.

**A wrong face is worse than no face.** Initials are honest; a stranger's photograph presented as
your coordinator is not. Every rule below is tuned to that asymmetry.

## The matching rules

A summary is accepted only when **all** of these hold. Any failure yields initials, silently.

1. `type === 'standard'` — rejects disambiguation pages and stubs.
2. The resolved title does not begin with `List of` — rejects the character-list redirect.
3. A `thumbnail.source` exists, and its host is `upload.wikimedia.org`.
4. **The extract mentions the fandom.** This is what catches the wrong-subject case: Long John
   Silver's extract says "Treasure Island"; an instant-messaging client's would never say
   "Hitchhiker's Guide to the Galaxy".

   Made precise, because "mentions" is the kind of word that becomes three different
   implementations: lowercase both sides, split the user's fandom string on non-letters, drop tokens
   of three characters or fewer (which removes "the", "of", "a" and most noise), and accept if **any
   remaining token appears in the extract**. "the Wire" reduces to `wire` and matches an extract
   naming "The Wire"; "Hitchhiker's Guide to the Galaxy" reduces to
   `hitchhiker, guide, galaxy` and matches on any of them. A fandom that reduces to no tokens at all
   (someone types "up") cannot be checked, and the rule fails closed: no tokens, no match, initials.

Rule 4 is the cheap half of the design and the reason approach A was chosen over a bare name lookup:
it costs one string comparison over data already in hand, and it converts the worst failure mode from
"wrong person's face" into "initials".

## Architecture

### `src/main/avatar.ts` (new)

```
findAvatar(name, fandom, deps) -> { bytes, articleUrl, title, license: 'commons' | 'non-free' } | null
```

Main process only. Two requests: the summary, then the thumbnail. Applies the four rules above.
**Never throws** — a network error, a timeout, a non-JSON body, a non-image body, an oversized image
and a rejected match are all the same outcome, `null`, because §10.7 requires that failure be silent
and indistinguishable from "Wikipedia had nothing".

`deps` carries the fetch function so tests never touch the network, following the `HermesRuntime`
injection the codebase already uses.

**Rate limiting.** The probe hit `429` on its fourteenth rapid request. Real usage is one lookup per
onboarding, so this is not a product concern, but the client sends a descriptive `User-Agent` (which
Wikimedia's policy asks for) and retries once on `429` or `5xx` before giving up. A timeout bounds
the whole operation, since nothing downstream may wait on it.

### Storage

`profileFilePath(profileId, 'avatar.png')` — the helper exists already and already encodes the rule
that the default profile keeps its files at the home root rather than under `profiles/`, exactly as
`SOUL.md` and `circe.json` do. The coordinator is the `default` profile, so its face is
`~/.hermes/avatar.png`; a specialist's is `~/.hermes/profiles/<id>/avatar.png`.

`HermesRuntime` currently reads and writes strings only. It gains binary siblings —
`readHomeFileBytes` / `writeHomeFileBytes` — on the interface, the real implementation and the fake.
JPEG-to-PNG conversion uses Electron's `nativeImage`, so this adds no dependency.

### Timing: the lookup and the write are different moments

**The lookup fires when derivation resolves.** That is the earliest instant the character's name
exists, and it resolves a contradiction in the spec: constraint 4 says the lookup is "triggered by
the user reaching Step 4", while §10.7 says Step 5. Step 4 is impossible — there is no name yet — so
Step 5 is the accurate reading, and §6.2's "the lookup has already run by the time this screen opens"
is the intent.

It is **non-blocking**. Derivation already takes 20–60 seconds and the meet screen must not wait on a
second network call. The screen renders initials immediately and swaps in the face if and when it
arrives — the same "arrives late, applied live" pattern D1 established for palettes, and the same
rule: a malformed or absent update leaves what is showing alone.

**The write happens on accept, not before.** Constraint 9 forbids modifying a profile the user has
not asked Circe to modify in this session, and §10.6 tests it. So the bytes are held in memory
through the meet screen and reach disk only inside `commitAccept`, alongside the persona. "Try
someone else" discards them and leaves nothing behind.

### Display and the CSP

Two sites: the meet screen's preview and the tile header (§6.3 — "the avatar shown in the tile header
comes from the profile's avatar file... if none, the tile shows the character's first initial in a
colored circle").

The main process reads the bytes and hands the renderer a `data:` URL over IPC. Not via the tile's
URL query, which already carries the character as JSON and where a base64 PNG would not fit.

**The CSP must change, and this is worth stating plainly because §10.7 describes it as a thing to
hold rather than a thing to add.** Both renderers currently declare
`default-src 'self'; style-src 'self' 'unsafe-inline'` with no `img-src` at all, so images inherit
`default-src 'self'` and a `data:` URL is refused today. The policy gains exactly `img-src 'self'
data:` — the string §10.7 says a test should pin — and nothing else. Remote image loads stay refused.

Initials remain the fallback element rather than a special case, so a lookup that fails renders
precisely today's screen.

## Failure handling

Every one of these produces initials and no user-visible error:

- Wikipedia unreachable, slow, or returning `4xx`/`5xx` after the single retry.
- A body that is not JSON, or JSON without the fields the rules read.
- A summary rejected by any of the four matching rules.
- A thumbnail that is not an image, is empty, or exceeds the size bound.
- Any failure converting to PNG.

Nothing in this feature can fail an onboarding. An agent with no face is a working agent.

## Testing

Against an injected fetch, so no test touches the network:

- Good summary with a thumbnail → bytes returned, host asserted.
- List-article redirect → `null`.
- Disambiguation type → `null`.
- Standard article with no thumbnail → `null`.
- **Wrong subject**: standard article, real thumbnail, extract that never names the fandom → `null`.
- Redirect we want ("Captain Picard" → "Jean-Luc Picard") → accepted, proving rule 4 does not reject
  legitimate redirects.
- Network error, timeout, `429` then success on retry, non-image body → `null` or bytes as
  appropriate, never a throw.
- A `/wikipedia/commons/` thumbnail is recorded `commons`; a `/wikipedia/en/` one is recorded
  `non-free`. This is the data the unresolved licensing decision will be made on, so it is pinned.

Plus the §10.7 invariants:

- The repo contains no character-representative images.
- The CSP string is exactly `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'
  data:` in both renderers.
- A failed lookup yields an initials avatar and no error text anywhere on screen.

Plus constraint 9: no avatar byte reaches disk before accept, including after a "try someone else".

## Open, and deliberately not solved here

**Licensing and attribution.** Constraint 6 says likenesses land carrying "whatever license Wikipedia
holds them under — mostly CC BY-SA, occasionally fair-use-only", and that "attribution and
redistribution are unresolved and must be settled before v1 ships publicly."

**Measured 2026-08-19, that assumption is inverted.** Of the nine characters whose lookup returned a
usable thumbnail, **seven were fair-use-only and two were freely licensed.** The two free ones —
Long John Silver and Sherlock Holmes — are public-domain-era illustrations. Every modern character
in the sample (Hermione Granger, Tyrion Lannister, Leslie Knope, Ellen Ripley, Jean-Luc Picard,
Hercule Poirot, Granny Weatherwax) resolved to a non-free film still, poster or publicity photograph.
So the normal case is fair use, not the exception.

**There is no license field in the summary response.** An earlier draft of this document claimed
there was; there is not. What exists is better, because it costs nothing: the licensing is legible in
the thumbnail's own URL path.

- `upload.wikimedia.org/wikipedia/commons/…` — hosted on Wikimedia Commons, freely licensed.
- `upload.wikimedia.org/wikipedia/en/…` — uploaded locally under English Wikipedia's **non-free
  content criteria**, which permit use *on Wikipedia* and say nothing about redistribution.

So provenance is a single substring test on a URL we already hold, and this design records it:
`avatarSource` (the article URL) and `avatarLicense` (`commons` or `non-free`) are written alongside
the image, in the profile, so a future attribution surface or a licensing policy has the data.

**What this design does not decide** is whether a non-free image may be written at all. Three
positions are available and the choice belongs to the product owner:

1. **Record and ship** — accept both, store the provenance, settle the policy before public v1. Keeps
   the feature's hit rate at roughly seven in ten, which is what makes it worth building.
2. **Commons only** — accept `/wikipedia/commons/` and nothing else. Unimpeachable, and on this
   sample it reduces the feature to two characters in nine; almost every modern fandom gets initials.
3. **Record and ship, with a switch** — position 1, plus a setting that restricts to Commons, so the
   conservative behaviour exists without being the default.

**Decided 2026-08-19 by the product owner: position 1.** Accept both, record the provenance, settle
the redistribution policy before Circe ships publicly. The reasoning that makes it defensible is
worth writing down, since whoever revisits this will need it: Circe's repo ships zero images, each
file is fetched per-user on that user's own machine at their own request, and nothing is
redistributed by the project. What is unresolved is not the fetching but the shipping — whether a
public v1 can present fair-use likenesses as agent identities without an attribution surface or a
policy. Position 2 or 3 stays a small change, because the provenance is captured either way.

**This is a release blocker, not a build blocker.** It must be settled before the repo is public. It
does not gate the work below.

## What this does not touch

Fleet management (§6.6), the tab strip, Step 4b, and Adjust. Each is its own Phase 2 line item.
