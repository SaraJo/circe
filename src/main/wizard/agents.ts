import { createProfile } from '../hermes/create';
import { findCast } from '../../shared/casts';
import { DEFAULT_PALETTE, type HermesProfile, type Palette, type TileState } from '../../shared/types';
import type { StateStore } from '../state/store';

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

    const tabId = `t${Date.now().toString(36)}`;
    const tile: TileState = {
      profileId: id,
      // Screen 7 lays tiles out; this is the fallback size from §6.3.1.
      bounds: { x: 0, y: 0, width: 500, height: 600 },
      // New profiles open unlocked, except coding profiles (§6.4).
      gateMode: opts.isCodingProfile ? 'locked' : 'unlocked',
      palette,
      tabs: [{ id: tabId, title: 'New tab', sessionId: null, messages: [] }],
      activeTabId: tabId,
      tiled: true,
      isCodingProfile: opts.isCodingProfile ?? false,
    };

    const state = this.deps.store.get();
    state.tiles[id] = tile;
    if (opts.makeMainOperator && !state.mainOperatorId) {
      state.mainOperatorId = id;
    }
    await this.deps.store.save(state);

    return profile;
  }
}
