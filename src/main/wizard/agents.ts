import { readFile } from 'node:fs/promises';
import { createProfile } from '../hermes/create';
import { enumerateProfiles, inferCodingProfile } from '../hermes/profiles';
import { findCast } from '../../shared/casts';
import { DEFAULT_PALETTE, type HermesProfile, type Palette, type TileState } from '../../shared/types';
import type { StateStore } from '../state/store';

/** A fresh tile: one empty tab, fallback bounds, coding profiles gated (§6.4). */
function newTileState(profileId: string, palette: Palette, isCodingProfile: boolean): TileState {
  const tabId = `t${Date.now().toString(36)}`;
  return {
    profileId,
    // Screen 7 lays tiles out; this is the fallback size from §6.3.1.
    bounds: { x: 0, y: 0, width: 500, height: 600 },
    gateMode: isCodingProfile ? 'locked' : 'unlocked',
    palette,
    tabs: [{ id: tabId, title: 'New tab', sessionId: null, messages: [] }],
    activeTabId: tabId,
    tiled: true,
    isCodingProfile,
  };
}

// Defined in shared/casts so the wizard renderer can import it without pulling
// this module's node:child_process dependency into a browser bundle.
export { suggestCharacter } from '../../shared/casts';

export interface AgentBuilderDeps {
  store: StateStore;
  hermesBin: string;
  hermesHome: string;
  env?: NodeJS.ProcessEnv;
}

export interface CreateFromCharacterOptions {
  castId: string;
  characterName: string;
  /** Overrides the character's suggested id. Required for the custom cast. */
  profileId?: string;
  palette?: Palette;
  persona?: string;
  /** §5.5 — the explicit role pick. Flips the default gate to locked. */
  isCodingProfile?: boolean;
  makeMainOperator?: boolean;
}

export class AgentBuilder {
  constructor(private readonly deps: AgentBuilderDeps) {}

  async createFromCharacter(opts: CreateFromCharacterOptions): Promise<HermesProfile> {
    const cast = findCast(opts.castId);
    const character = cast?.characters.find((c) => c.name === opts.characterName) ?? null;

    if (!character && !opts.profileId) {
      throw new Error(`No character named "${opts.characterName}" in that cast.`);
    }

    const id = opts.profileId ?? character!.suggestedId;
    const tagline = character?.tagline ?? null;
    const palette = opts.palette ?? character?.palette ?? DEFAULT_PALETTE;

    const profile = await createProfile({
      hermesBin: this.deps.hermesBin,
      hermesHome: this.deps.hermesHome,
      id,
      heading: { name: opts.characterName, tagline },
      persona: opts.persona,
      env: this.deps.env,
    });

    const tile = newTileState(id, palette, opts.isCodingProfile ?? false);

    const state = this.deps.store.get();
    state.tiles[id] = tile;
    if (opts.makeMainOperator && !state.mainOperatorId) {
      state.mainOperatorId = id;
    }
    await this.deps.store.save(state);

    return profile;
  }

  /**
   * Screen 4b. Gives every real profile already on disk a tile so the fleet can
   * launch it — without this the wizard discovers profiles, continues, and
   * Fleet.plan() finds nothing to open.
   *
   * §10.6: this writes only Circe's own state file. It never touches a profile
   * directory, and it never overwrites tile state that already exists, so a
   * second pass is a no-op rather than a reset.
   */
  async adoptProfiles(): Promise<string[]> {
    const profiles = (await enumerateProfiles(this.deps.hermesHome)).filter((p) => p.real);
    const state = this.deps.store.get();
    const adopted: string[] = [];

    for (const profile of profiles) {
      if (state.tiles[profile.id]) continue;
      // §5.5 — imported profiles get their role inferred from SOUL.md, since
      // nobody walked them through the Screen 5 role picker.
      const soul = await readFile(profile.soulPath, 'utf8').catch(() => '');
      state.tiles[profile.id] = newTileState(profile.id, DEFAULT_PALETTE, inferCodingProfile(soul));
      adopted.push(profile.id);
    }

    if (!state.mainOperatorId && adopted[0]) state.mainOperatorId = adopted[0];
    await this.deps.store.save(state);
    return adopted;
  }
}
