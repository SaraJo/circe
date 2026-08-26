import type { Character, HermesProfile } from '../shared/types';
import { profileFilePath, soulPath, type HermesRuntime } from './hermes/runtime';
import { DEFAULT_PALETTE } from './palette';
import { parseProfileTheme, readProfilePalette, THEME_FILE, writeProfileTheme } from './profileTheme';
import { parseSoulHeading } from './soul';

export { DEFAULT_PALETTE };

/**
 * What Circe remembers between launches about the fleet as a whole: which
 * profile is the main operator, i.e. whose tile foregrounds (spec §6.6).
 *
 * The `character` block a v1 record carried is gone. An agent's name, tagline
 * and colours are the profile's own (§3.1), so caching them here was constraint
 * 10's inversion — it meant a profile Circe had not created could not be shown.
 * Losing this record now costs nothing but which window ends up on top.
 */
export interface LastLaunch {
  version: 2;
  mainProfileId: string;
}

const RECORD_VERSION = 2;

/** Where the record lives, relative to the Hermes home. */
export const LAST_LAUNCH_PATH = 'circe/last-launch.json';

export type Startup =
  | { kind: 'wizard'; profiles?: HermesProfile[] }
  | { kind: 'fleet'; mainProfileId: string };

export function serializeLastLaunch(mainProfileId: string): string {
  const record: LastLaunch = { version: RECORD_VERSION, mainProfileId };
  return JSON.stringify(record, null, 2);
}

export function parseLastLaunch(json: string | null): LastLaunch | null {
  if (json === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const r = parsed as Partial<LastLaunch>;
  if (r.version !== RECORD_VERSION) return null;
  if (typeof r.mainProfileId !== 'string') return null;
  return { version: RECORD_VERSION, mainProfileId: r.mainProfileId };
}

/**
 * Moves a pre-Phase-2 record's palette into the profile that owns it.
 *
 * Version-gating alone would silently grey out an agent the user has been
 * living with, because a v1 record holds the *only* copy of its colours and
 * such an install has no `circe.json` at all. Runs once at boot, never
 * overwrites colours the profile already has, and swallows every failure: this
 * is a cosmetic rescue, and a boot that dies over it would be a far worse bug
 * than the grey tile it prevents.
 */
export async function migrateV1Palette(
  hermes: HermesRuntime,
  recordJson: string | null,
): Promise<void> {
  if (recordJson === null) return;
  try {
    const parsed: unknown = JSON.parse(recordJson);
    if (typeof parsed !== 'object' || parsed === null) return;
    const r = parsed as { version?: unknown; profileId?: unknown; character?: unknown };
    if (r.version !== 1) return;
    const profileId = typeof r.profileId === 'string' ? r.profileId : 'default';
    const palette = (r.character as { palette?: unknown } | undefined)?.palette;
    // Reuse the theme parser rather than trusting the record: a v1 palette has
    // never been hex-validated, and an unvalidated channel reaches the
    // stylesheet as `rgba(NaN, …)`.
    const valid = parseProfileTheme(JSON.stringify({ version: 1, palette }));
    if (valid === null) return;
    const existing = await hermes.readHomeFile(profileFilePath(profileId, THEME_FILE));
    if (existing !== null) return;
    await writeProfileTheme(hermes, profileId, valid);
    console.info(`Moved profile "${profileId}" colours from Circe's record into the profile.`);
  } catch (err) {
    console.warn('Could not migrate the recorded palette into the profile.', err);
  }
}

/**
 * Everything a tile needs to present a profile, read from the profile itself.
 *
 * Identity comes from the file the agent actually loads, so a hand-edited
 * `SOUL.md` wins over anything Circe remembers. Colours come from the
 * profile's own `circe.json`. `why` and `fandom` were only ever derivation
 * artefacts shown on the wizard's meet screen; a tile does not use them, and
 * for a profile Circe did not create they do not exist, so they are empty.
 *
 * Never throws. A profile whose files cannot be read still has an agent behind
 * it and still gets a tile — the display name Hermes already computed is the
 * fallback for the heading.
 */
export async function characterFor(
  hermes: HermesRuntime,
  profile: HermesProfile,
): Promise<Character> {
  let soulText: string | null = null;
  try {
    soulText = await hermes.readHomeFile(soulPath('', profile.id).replace(/^\//, ''));
  } catch (err) {
    console.warn(`Could not read the persona for profile "${profile.id}".`, err);
  }
  const heading = soulText === null ? null : parseSoulHeading(soulText);
  return {
    name: heading?.name ?? profile.displayName,
    // Rebuilt from disk, and nothing on disk records a full name: it exists
    // only to give the avatar lookup something Wikipedia can resolve, and the
    // lookup runs once, during onboarding. A restored character never looks
    // one up, so the display name is the whole truth here.
    fullName: heading?.name ?? profile.displayName,
    // Same reasoning as `fullName`: the lookup runs once, during onboarding,
    // and nothing on disk records where the face came from.
    wiki: '',
    wikiPage: heading?.name ?? profile.displayName,
    tagline: heading?.tagline ?? '',
    profileId: profile.id,
    palette: await readProfilePalette(hermes, profile.id),
    why: '',
    fandom: '',
    // Rebuilt from disk, where only the persona and the palette live. The
    // voice is *in* that SOUL.md and belongs to the agent; Circe does not
    // parse it back out, because nothing here needs it — the intro, the
    // greeting and the check are all wizard-time text, said once about a
    // character being chosen, and this profile was chosen long ago.
    voice: '',
    intro: '',
    greeting: '',
    voiceCheck: '',
  };
}

/**
 * Reads what `resolveStartup` needs out of the Hermes home. Any read failure
 * resolves to the wizard: `readHomeFile` rejects (rather than returning null)
 * for a file that exists but can't be read, and the wizard is the safe landing
 * for that — its own write path refuses to overwrite a persona it couldn't
 * read first, so an unreadable SOUL.md still can't be destroyed.
 */
export async function readStartup(hermes: HermesRuntime): Promise<Startup> {
  const soulRel = soulPath('', 'default').replace(/^\//, '');
  let recordJson: string | null;
  try {
    await hermes.readHomeFile(soulRel);
    recordJson = await hermes.readHomeFile(LAST_LAUNCH_PATH);
  } catch (err) {
    console.warn('Could not read the Hermes home on startup; starting onboarding.', err);
    return { kind: 'wizard' };
  }
  await migrateV1Palette(hermes, recordJson);
  const startup = resolveStartup(recordJson);
  if (startup.kind === 'fleet') return startup;
  try {
    return {
      kind: 'wizard',
      profiles: (await hermes.listProfiles()).filter((profile) => profile.isReal),
    };
  } catch (err) {
    console.warn('Could not enumerate the existing fleet for onboarding.', err);
    return { kind: 'wizard' };
  }
}

/**
 * Decides whether Circe onboards or opens the fleet, and which tile foregrounds.
 *
 * Circe's record proves this installation has made an explicit onboarding or
 * adoption choice. Without it the wizard inventories real Hermes profiles and
 * chooses adoption or ordinary onboarding; it never treats a persona as
 * permission to overwrite that persona.
 *
 * Kept pure so every branch is testable without an Electron app around it.
 */
export function resolveStartup(recordJson: string | null): Startup {
  const record = parseLastLaunch(recordJson);
  if (record !== null) return { kind: 'fleet', mainProfileId: record.mainProfileId };
  // With no Circe record, `readStartup` inventories any real profiles and the
  // wizard chooses between adoption and ordinary onboarding.
  return { kind: 'wizard' };
}
