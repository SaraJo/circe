import type { HermesProfile } from '../shared/types';

/**
 * Hermes's scaffold persona is bare prose. A user who has configured a profile
 * has given it a `# Name` heading — either by hand or because Circe wrote one.
 * That single signal is the whole realness rule (spec §5.4), and it is the one
 * that survived validation against actual scaffold output.
 */
const H1_LINE = /^#[ \t]+\S/;

function firstNonEmptyLine(text: string): string | null {
  return text.split(/\r?\n/).find((l) => l.trim() !== '')?.trim() ?? null;
}

export function isRealSoul(soul: string | null): boolean {
  if (soul === null) return false;
  const first = firstNonEmptyLine(soul);
  if (first === null) return false;
  if (/^#{2,}/.test(first)) return false;
  return H1_LINE.test(first);
}

/** The heading's name when there is one, otherwise the on-disk id. */
export function displayNameFor(id: string, soul: string | null): string {
  if (!isRealSoul(soul)) return id;
  const heading = firstNonEmptyLine(soul!)!.replace(/^#[ \t]+/, '').trim();
  const split = /\s+—\s+|\s+–\s+|\s+-\s+|,\s+/.exec(heading);
  if (!split || split.index === 0) return heading;
  return heading.slice(0, split.index).trim();
}

/**
 * True when claiming the default profile would destroy a persona the user
 * wrote. Task 8's wizard routes to a confirm screen when this is true.
 */
export function hasConfiguredDefault(profiles: HermesProfile[]): boolean {
  return profiles.find((p) => p.id === 'default')?.isReal ?? false;
}
