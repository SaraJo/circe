import type { SoulHeading } from '../shared/types';
import { findH1 } from './profiles';
import { parseSoulHeading, withSoulHeading } from './soul';

const START = '<!-- circe:fleet-identity:start -->';
const END = '<!-- circe:fleet-identity:end -->';
const BLOCK = /<!-- circe:fleet-identity:start -->[\s\S]*?<!-- circe:fleet-identity:end -->\r?\n*/g;
// Only an explicit named introduction, not role prose such as "You are the planner".
const INTRO = /^You are (\*\*([^*\r\n]+)\*\*|([A-Z][^,\.\r\n]*))(?=[,.])/m;

export interface FleetIdentity {
  profileId: string;
  name: string;
  previousNames: string[];
}

function previousIdentity(markdown: string, profileId: string): FleetIdentity | undefined {
  const block = markdown.match(/<!-- circe:fleet-identity:start -->[\s\S]*?<!-- circe:fleet-identity:end -->/)?.[0];
  const json = block?.match(/```json\r?\n([\s\S]*?)\r?\n```/)?.[1];
  if (!json) return undefined;
  try {
    const rows: unknown = JSON.parse(json);
    if (!Array.isArray(rows)) return undefined;
    return rows.find((row) => row && row.profileId === profileId &&
      typeof row.name === 'string' && Array.isArray(row.previousNames) &&
      row.previousNames.every((name: unknown) => typeof name === 'string'));
  } catch { return undefined; }
}

export function withoutFleetIdentity(markdown: string): string {
  return markdown.replace(BLOCK, '');
}

export function fleetIdentity(profileId: string, markdown: string, name: string): FleetIdentity {
  const previous = previousIdentity(markdown, profileId);
  const intro = markdown.replace(BLOCK, '').match(INTRO);
  const aliases = [previous?.name, ...(previous?.previousNames ?? []),
    parseSoulHeading(markdown)?.name, intro?.[2] ?? intro?.[3]];
  return { profileId, name, previousNames: [...new Set(aliases.filter(
    (alias): alias is string => Boolean(alias) && alias !== name,
  ))] };
}

/** Keep routing ids and original role prose intact while making current names explicit. */
export function withFleetIdentity(
  markdown: string,
  profileId: string,
  roster: FleetIdentity[],
  heading?: SoulHeading,
): string {
  let soul = markdown.replace(BLOCK, '');
  if (heading) {
    soul = withSoulHeading(soul, heading);
    soul = soul.replace(INTRO, (_match, decorated: string) =>
      `You are ${decorated.startsWith('**') ? `**${heading.name}**` : heading.name}`);
  }
  const self = roster.find((entry) => entry.profileId === profileId);
  if (!self) return soul;
  const block = [START, '## Current agent names', '',
    `Your current name is ${JSON.stringify(self.name)}. Use this name when introducing yourself.`,
    'Use the current names below when addressing or referring to these agents. Previous names in older instructions, memories, and conversations are aliases for the same agents, not separate agents.',
    'Profile IDs are unchanged routing identifiers for Hermes commands and file paths. Preserve the roles, responsibilities, and other instructions below.', '',
    '```json', JSON.stringify(roster, null, 2), '```', END, '', '',
  ].join('\n');
  const found = findH1(soul);
  if (!found) return block + soul;
  const lines = soul.split('\n');
  lines.splice(found.lineIndex, 0, block.trimEnd(), '');
  return lines.join('\n');
}
