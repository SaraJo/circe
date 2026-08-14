import type { HermesProfile } from '../shared/types';

/**
 * Hermes's scaffold persona is bare prose. A user who has configured a profile
 * has given it an H1 heading — either by hand or because Circe wrote one.
 * That single signal is the whole realness rule (spec §5.4), and it is the one
 * that survived validation against actual scaffold output.
 *
 * `isRealSoul` guards a destructive write (`soul.ts`'s `writeSoul` skips its
 * backup, and the wizard skips its confirm screen, whenever this says
 * "not real"), so the two error directions are not symmetric: a false
 * positive costs an extra confirm click, a false negative destroys a
 * hand-written persona silently. The rule below therefore looks at the whole
 * document — skipping a leading YAML front-matter block, and recognising
 * both ATX (`# Heading`) and setext (`Heading\n===`) H1s anywhere in it —
 * rather than only the first line, so it fails toward "real".
 */
const ATX_H1 = /^#[ \t]+(\S.*)$/;
const SETEXT_UNDERLINE = /^=+[ \t]*$/;
const FRONT_MATTER_DELIM = /^---[ \t]*$/;

function stripBom(text: string): string {
  return text.replace(/^﻿/, '');
}

/**
 * Drops a leading `---`-delimited YAML front-matter block. If there is no
 * closing `---`, the file is treated as having no front matter at all —
 * heading detection then runs over the untouched original text — rather than
 * swallowing the whole document as "front matter" with nothing after it.
 */
function stripLeadingFrontMatter(text: string): string {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0 || !FRONT_MATTER_DELIM.test(lines[0]!)) return text;
  for (let i = 1; i < lines.length; i++) {
    if (FRONT_MATTER_DELIM.test(lines[i]!)) return lines.slice(i + 1).join('\n');
  }
  return text;
}

/**
 * The document's first H1 — ATX or setext — after stripping a BOM and any
 * leading front matter, or null when there isn't one. Both `isRealSoul` and
 * `displayNameFor` read from this single scan so they always agree on which
 * heading (if any) makes the profile real.
 */
function findH1(soul: string): string | null {
  const lines = stripLeadingFrontMatter(stripBom(soul)).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const atx = ATX_H1.exec(line);
    if (atx) return atx[1]!.trim();
    if (line.trim() !== '' && !line.startsWith('#')) {
      const next = lines[i + 1];
      if (next !== undefined && SETEXT_UNDERLINE.test(next)) return line.trim();
    }
  }
  return null;
}

export function isRealSoul(soul: string | null): boolean {
  if (soul === null) return false;
  return findH1(soul) !== null;
}

/** The heading's name when there is one, otherwise the on-disk id. */
export function displayNameFor(id: string, soul: string | null): string {
  const heading = soul === null ? null : findH1(soul);
  if (heading === null) return id;
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
