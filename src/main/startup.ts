import type { Character } from '../shared/types';
import { soulPath, type HermesRuntime } from './hermes/runtime';
import { isRealSoul } from './profiles';
import { parseSoulHeading } from './soul';
import { DEFAULT_PALETTE } from './palette';

export { DEFAULT_PALETTE };

/**
 * What Circe remembers about the last agent it launched. Only ever a cache of
 * *presentation*: the colours and the derivation's `why`/`fandom` live nowhere
 * else on disk, while the agent's identity lives in SOUL.md and is read from
 * there. A missing, corrupt, or future-versioned record therefore costs the
 * user their tile's colours, never their way back to their agent.
 */
export interface LastLaunch {
  version: 1;
  profileId: string;
  character: Character;
}

const RECORD_VERSION = 1;

/** Where the record lives, relative to the Hermes home. */
export const LAST_LAUNCH_PATH = 'circe/last-launch.json';

export type Startup =
  | { kind: 'wizard' }
  | { kind: 'tile'; character: Character; profileId: string };

export function serializeLastLaunch(character: Character, profileId: string): string {
  const record: LastLaunch = { version: RECORD_VERSION, profileId, character };
  return JSON.stringify(record, null, 2);
}

function parseLastLaunch(json: string | null): LastLaunch | null {
  if (json === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const r = parsed as Partial<LastLaunch>;
  // Version-gated so a record written by a later Circe, whose `character` may
  // hold fields this build doesn't understand, is ignored rather than
  // half-read. Falling back to the default palette is a cosmetic loss.
  if (r.version !== RECORD_VERSION) return null;
  if (typeof r.profileId !== 'string' || typeof r.character !== 'object' || r.character === null) {
    return null;
  }
  const c = r.character as Partial<Character>;
  if (typeof c.name !== 'string' || typeof c.palette !== 'object' || c.palette === null) {
    return null;
  }
  return r as LastLaunch;
}

/**
 * Decides what Circe opens on launch, from the persona on disk and whatever it
 * remembers about the last one it wrote.
 *
 * SOUL.md is the authority. If it holds a real persona then an orchestrator
 * exists and the tile opens onto it, whoever wrote it — a user who hand-edits
 * their own identity file must not be sent back through onboarding, because
 * onboarding's next move is to overwrite the very file they just edited.
 * `isRealSoul` is what separates a persona from the stock scaffold Hermes
 * writes into every fresh home, and since it *is* "has an H1", a real persona
 * always has a heading to read the name from.
 *
 * Kept pure so every branch is testable without an Electron app around it.
 */
/**
 * Reads what `resolveStartup` needs out of the Hermes home. Any read failure
 * resolves to the wizard: `readHomeFile` rejects (rather than returning null)
 * for a file that exists but can't be read, and the wizard is the safe landing
 * for that — its own write path refuses to overwrite a persona it couldn't
 * read first, so an unreadable SOUL.md still can't be destroyed.
 */
export async function readStartup(hermes: HermesRuntime): Promise<Startup> {
  const soulRel = soulPath('', 'default').replace(/^\//, '');
  let soulText: string | null;
  let recordJson: string | null;
  try {
    soulText = await hermes.readHomeFile(soulRel);
    recordJson = await hermes.readHomeFile(LAST_LAUNCH_PATH);
  } catch (err) {
    console.warn('Could not read the Hermes home on startup; starting onboarding.', err);
    return { kind: 'wizard' };
  }
  return resolveStartup(recordJson, soulText);
}

export function resolveStartup(recordJson: string | null, soulText: string | null): Startup {
  if (!isRealSoul(soulText)) return { kind: 'wizard' };

  const heading = parseSoulHeading(soulText!);
  if (heading === null) return { kind: 'wizard' }; // unreachable: isRealSoul is findH1 !== null
  const record = parseLastLaunch(recordJson);
  const profileId = record?.profileId ?? 'default';

  return {
    kind: 'tile',
    profileId,
    character: {
      // Identity from the file the agent actually loads...
      name: heading.name,
      tagline: heading.tagline ?? '',
      // ...presentation from the record, which is all it is good for.
      profileId: record?.character.profileId ?? profileId,
      palette: record?.character.palette ?? DEFAULT_PALETTE,
      why: record?.character.why ?? '',
      fandom: record?.character.fandom ?? '',
    },
  };
}
