import type { Character, WizardStep } from '../shared/types';
import type { HermesRuntime } from './hermes/runtime';
import { deriveCharacter } from './derive';
import { hasConfiguredDefault } from './profiles';
import { writeSoul } from './soul';
import { loadTemplate, renderOrchestratorSoul } from './orchestrator/soulTemplate';
import { installOrchestratorSkill } from './orchestrator/skill';
import { LAST_LAUNCH_PATH, serializeLastLaunch } from './startup';
import { writeProfileTheme } from './profileTheme';
import { findAvatar, type AvatarDeps, type AvatarFind, type FindOptions } from './avatar';
import { findFandomAvatar } from './fandom';
import { dataUrl, saveAvatar, type ToPng } from './avatarStore';

/**
 * Injected so the whole feature is absent unless wired. `find` is overridable
 * only so tests can supply an outcome without a fake HTTP layer; production
 * passes `findAvatar` itself.
 */
export interface AvatarOptions {
  deps: AvatarDeps;
  toPng: ToPng;
  find?: (
    name: string,
    fandom: string,
    deps: AvatarDeps,
    opts?: FindOptions,
  ) => Promise<AvatarFind | null>;
  findFandom?: (wiki: string, page: string, deps: AvatarDeps) => Promise<AvatarFind | null>;
}

/**
 * States from which submitting a fandom makes sense: the fresh question, a
 * failed attempt, and — deliberately — a derivation already in flight. A
 * user who gets impatient and resubmits supersedes the one already running;
 * `runDerivation`'s generation token reconciles whichever settles last,
 * rather than a busy-flag locking the input while one is pending.
 */
const FANDOM_ENTRY_STATES = new Set<WizardStep['kind']>(['fandom', 'derive-failed', 'deriving']);

/**
 * States from which "try another character" is meaningful: a failed or
 * in-flight derivation, or either of the two character-holding review
 * screens. Deliberately not the same set as `FANDOM_ENTRY_STATES` —
 * `retryDerivation` legitimately runs from `meet`/`claim-default`, which
 * `submitFandom` must not, and must NOT run from `saving`/`write-failed`/
 * `launching`, where a lingering `this.character` would otherwise let it fire
 * a real derivation over a write already in progress or awaiting a retry.
 */
const RETRY_ENTRY_STATES = new Set<WizardStep['kind']>([
  'derive-failed',
  'deriving',
  'meet',
  'claim-default',
]);

/**
 * The whole onboarding flow, with no Electron in it. The renderer observes
 * `state` and calls the transitions; nothing here knows a window exists.
 */
export class Wizard {
  state: WizardStep = { kind: 'welcome' };
  private listeners: Array<(s: WizardStep) => void> = [];
  private character: Character | null = null;
  /**
   * Bumped on every derivation attempt. A resolving call compares its own
   * captured value against the current one before touching state — if
   * something newer has started, its result is stale and is dropped.
   */
  private generation = 0;

  /**
   * The face for the character on screen, held in memory rather than written.
   * Constraint 9: the user has not accepted this character yet, and "Try
   * someone else" must leave nothing on disk.
   */
  private pendingAvatar: AvatarFind | null = null;
  /**
   * Set once the persona is on disk, which is the moment constraint 9 stops
   * applying: the user has committed to this profile and it exists. A face
   * that arrives after that can be written straight out instead of waiting
   * for an `accept()` that has already been and gone.
   */
  private committed = false;

  constructor(
    private hermes: HermesRuntime,
    private avatar?: AvatarOptions,
  ) {}

  onChange(cb: (s: WizardStep) => void): void {
    this.listeners.push(cb);
  }

  /** The pending face for the meet screen, or null when there is none. */
  avatarDataUrl(): string | null {
    return this.pendingAvatar
      ? dataUrl(this.pendingAvatar.bytes, this.pendingAvatar.contentType)
      : null;
  }

  private set(next: WizardStep): void {
    this.state = next;
    for (const cb of this.listeners) cb(next);
  }

  /** Runtime and provider checks, then the fandom question. */
  async start(): Promise<void> {
    this.set({ kind: 'runtime-checking' });
    if ((await this.hermes.version()) === null) {
      this.set({ kind: 'runtime-missing' });
      return;
    }
    // Derivation is a model call, so a provider has to exist before the
    // fandom question — otherwise the user answers it and then hits a wall.
    if (!(await this.hermes.hasProvider())) {
      this.set({ kind: 'provider-missing' });
      return;
    }
    this.set({ kind: 'fandom' });
  }

  /**
   * The public fandom-submission entry point. Only proceeds from a state
   * where typing (or retyping) a fandom is sensible — not from screens like
   * `provider-missing` or `launching`, where a submission would otherwise
   * fire a real model call for no reason.
   */
  async submitFandom(fandom: string): Promise<void> {
    if (!FANDOM_ENTRY_STATES.has(this.state.kind)) return;
    await this.runDerivation(fandom);
  }

  /**
   * Re-runs derivation against the same answer — "not that one". Reads the
   * fandom from state when one is in flight or just failed, otherwise falls
   * back to the already-derived character (`meet`/`claim-default`). Calls
   * `runDerivation` directly rather than `submitFandom`, because retrying is
   * legitimate from `meet`/`claim-default` too, and those aren't in
   * `submitFandom`'s entry set. Guarded by its own `RETRY_ENTRY_STATES` —
   * routing around `submitFandom`'s guard means this needed one of its own,
   * otherwise a lingering `this.character` would make it fire from anywhere,
   * `launching` included.
   */
  async retryDerivation(): Promise<void> {
    if (!RETRY_ENTRY_STATES.has(this.state.kind)) return;
    const s = this.state;
    const fandom =
      s.kind === 'derive-failed' || s.kind === 'deriving'
        ? s.fandom
        : (this.character?.fandom ?? '');
    if (fandom) {
      // A new attempt at "who is this" discards whatever face belonged to the
      // character being replaced, so it cannot linger on screen while the new
      // derivation is in flight.
      this.pendingAvatar = null;
      await this.runDerivation(fandom);
    }
  }

  /**
   * The actual derivation run, generation-tokened so a stale resolution can
   * never clobber a newer one — whichever call was issued *last* wins,
   * regardless of which one *resolves* last.
   */
  private async runDerivation(fandom: string): Promise<void> {
    const trimmed = fandom.trim();
    if (!trimmed) return;
    const gen = ++this.generation;
    this.set({ kind: 'deriving', fandom: trimmed });
    let character: Character;
    try {
      character = await deriveCharacter(this.hermes, trimmed);
    } catch (err) {
      // A newer submission has already started (or finished) — this
      // failure is stale and must not stomp on a live state.
      if (gen !== this.generation) return;
      this.set({
        kind: 'derive-failed',
        fandom: trimmed,
        message: err instanceof Error ? err.message : 'Something went wrong.',
      });
      return;
    }
    if (gen !== this.generation) return;

    const profiles = await this.hermes.listProfiles();
    // Re-checked *after* the await, not just before it: `listProfiles` shells
    // out to `hermes profile list`, and a newer derivation issued during that
    // round trip has already claimed the generation. Without this second
    // check a superseded run would still push its own `meet`/`claim-default`
    // — and in the worst interleaving overwrite `launching`, re-opening
    // `accept()`'s guard for a second write.
    if (gen !== this.generation) return;
    this.character = character;

    // Cleared and started once, before the branch below decides which
    // screen to show. A returning user (`claim-default`) is shown the
    // character just as much as a fresh one (`meet`) is, so both need the
    // lookup — only the write, in `commitAccept`, is allowed to differ by
    // path, and it isn't: it's the same call for either.
    this.pendingAvatar = null;
    this.lookUpFace(character, gen);

    if (hasConfiguredDefault(profiles)) {
      const existing = profiles.find((p) => p.id === 'default')!;
      this.set({ kind: 'claim-default', character, existingName: existing.displayName });
      return;
    }
    this.set({ kind: 'meet', character });
  }

  /**
   * Fetches the character's face in the background. Never awaited by anything
   * on the path to either character-review screen: derivation already costs
   * 20 to 60 seconds and a second network call must not add to it. The
   * screen renders initials and swaps the face in if it arrives, the pattern
   * D1 established for palettes arriving late.
   */
  private lookUpFace(character: Character, generation: number): void {
    const avatar = this.avatar;
    if (!avatar) return;
    const find = avatar.find ?? findAvatar;
    const findFandom = avatar.findFandom ?? findFandomAvatar;
    // Wikipedia first: it is the only source that says anything about an
    // image's licence, so it keeps first refusal. Fandom carries the tail it
    // does not have, and is asked only when the first source came back empty.
    const lookUp = async (): Promise<AvatarFind | null> => {
      const first = await find(character.name, character.fandom, avatar.deps, {
        fullName: character.fullName,
      });
      if (first || !character.wiki) return first;
      return findFandom(character.wiki, character.wikiPage, avatar.deps);
    };
    void lookUp()
      .then((found) => {
        // The same staleness rule the derivation itself uses. Without it a face
        // for a character the user has already replaced attaches to the one on
        // screen.
        if (generation !== this.generation) return;
        this.pendingAvatar = found;
        // `accept()` reads `pendingAvatar` once, as it runs. A lookup that
        // settles after that used to leave the face found, held, and never
        // written, and the user kept initials for good. The lookup can now
        // cost as many as eleven requests where it used to cost one, so the
        // window this loses faces in is no longer narrow. The tile picks the
        // file up on the fleet's next sweep.
        if (found && this.committed) {
          void this.writeAvatar(found);
          return;
        }
        // Re-emitting is only meaningful on the two screens that display a
        // face. `generation` alone does not rule out `saving`/`launching`/
        // `write-failed`: accepting never bumps it, so a lookup that resolves
        // after the user has already moved on would otherwise re-emit
        // whatever state the wizard is now in. `src/main/index.ts` treats
        // every emission of `launching` as "the persona is on disk, launch
        // the tile now" — a stale re-emit of it launches the tile a second
        // time, seconds into the user's first conversation.
        const kind = this.state.kind;
        if (found && (kind === 'meet' || kind === 'claim-default')) {
          this.set({ ...this.state });
        }
      })
      .catch(() => {
        // Silent, per §10.7. There is nothing a user could do with this.
      });
  }

  /**
   * The one place a face is written. Two copies of this would be two chances
   * for the late path and the accept path to disagree about where a face goes.
   * Swallowed because a profile with no face is a working profile (§10.7).
   */
  private async writeAvatar(find: AvatarFind): Promise<void> {
    if (!this.avatar) return;
    try {
      await saveAvatar(this.hermes, 'default', find.bytes, find.contentType, this.avatar.toPng);
    } catch (err) {
      console.warn('Could not write the avatar for the new profile.', err);
    }
  }

  /** The user accepted overwriting a persona they wrote. */
  async confirmClaimDefault(): Promise<void> {
    if (this.state.kind !== 'claim-default') return;
    await this.commitAccept();
  }

  /** The user refused. Nothing has been written, and nothing will be. */
  declineClaimDefault(): void {
    if (this.state.kind !== 'claim-default') return;
    this.character = null;
    // Matches `retryDerivation`: a face belonging to the character just
    // refused cannot linger for whatever gets derived next.
    this.pendingAvatar = null;
    this.set({ kind: 'fandom' });
  }

  /**
   * Writes the persona and the skill. Refuses to start once a write is
   * underway or done (`saving`, `launching`) and refuses to run directly
   * from `claim-default` — that screen's explicit confirm
   * (`confirmClaimDefault`) is the only sanctioned route out of it, so a
   * future renderer can't wire a button straight to `accept()` and skip the
   * confirm step.
   *
   * `write-failed` is deliberately *not* in the refusal set: that is the
   * retry path, and it is only ever reached after a `meet` accept or a
   * `claim-default` confirm has already happened, so retrying from it can't
   * launder a confirm the user never gave.
   */
  async accept(): Promise<void> {
    const k = this.state.kind;
    if (k === 'saving' || k === 'launching' || k === 'claim-default') return;
    await this.commitAccept();
  }

  /**
   * `writeSoul` handles backing up anything the user wrote, so the
   * claim-default screen is a courtesy, not the guard.
   *
   * Ordering is load-bearing. `set()` notifies its listeners *synchronously*,
   * and `src/main/index.ts` reacts to `launching` by spawning
   * `hermes -p default acp` — which reads `SOUL.md` at startup. Announcing
   * `launching` before the writes therefore raced the agent's own read
   * against them, and the user could meet the scaffold Hermes instead of
   * their character. So both writes complete first, and `launching` is the
   * last thing that happens. `saving` exists purely to give the UI something
   * to show in the meantime without reusing the state that means "spawn now".
   *
   * `saving` is entered synchronously, before the first `await`, so it is
   * still the re-entrancy guard: a second call issued before this one settles
   * sees it and bails in `accept()`. `this.character` is cleared only once
   * the writes have actually succeeded — the failure path keeps it so the
   * user can retry.
   */
  private async commitAccept(): Promise<void> {
    const character = this.character;
    if (!character) return;
    this.set({ kind: 'saving', character });
    // Tracked so the failure path can tell the two halves apart: a failure in
    // `installOrchestratorSkill` happens *after* the persona has already been
    // replaced, and the screen must not then claim nothing was changed
    // (Ruling F-1). Stays null if `writeSoul` is what threw.
    let personaReplaced: { path: string; backedUpTo: string | null } | null = null;
    try {
      const soul = renderOrchestratorSoul(character, await loadTemplate());
      const written = await writeSoul({
        hermes: this.hermes,
        profileId: 'default',
        contents: soul,
      });
      personaReplaced = { path: written.path, backedUpTo: written.backedUpTo };
      this.committed = true;
      // After the persona, because a face without a persona is the worse of the
      // two half-written states, and swallowed because a profile with no face
      // is a working profile. §10.7: failure is silent.
      if (this.pendingAvatar) await this.writeAvatar(this.pendingAvatar);
      await installOrchestratorSkill(this.hermes, 'default');
    } catch (err) {
      // Nothing is launched: a tile in front of an agent with no persona is
      // worse than an honest error, and an unhandled rejection here used to
      // leave the wizard stuck on "Starting…" forever.
      this.set({
        kind: 'write-failed',
        character,
        message: err instanceof Error ? err.message : String(err),
        personaReplaced,
      });
      return;
    }
    // Deliberately outside the block above, and deliberately swallowed. The
    // persona is already on disk; failing the launch now would trade a working
    // agent for its colours, and would leave the user with a `write-failed`
    // screen for a file the agent never reads. A profile with no `circe.json`
    // falls back to the neutral palette and is otherwise complete.
    try {
      await writeProfileTheme(this.hermes, 'default', character.palette);
    } catch (err) {
      console.warn("Could not write the profile's colours (circe.json):", err);
    }
    // Deliberately outside the block above, and deliberately swallowed. This
    // record now holds only which profile is the main operator, so its tile
    // foregrounds on the next cold start (`LastLaunch`, startup.ts) — the way
    // back to the agent itself is `SOUL.md`, which is already written by now.
    // Failing the launch over this record would trade a working agent for
    // nothing.
    try {
      await this.hermes.writeHomeFile(LAST_LAUNCH_PATH, serializeLastLaunch('default'));
    } catch (err) {
      console.warn(`Could not record the launch (${LAST_LAUNCH_PATH}):`, err);
    }

    this.character = null;
    this.set({ kind: 'launching', character, profileId: 'default' });
  }
}
