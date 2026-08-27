import type { HermesProfile, SoulHeading } from '../shared/types';

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
/** Real personas on disk use an em dash, en dash, hyphen, or comma. */
const HEADING_SEPARATOR = /\s+—\s+|\s+–\s+|\s+-\s+|,\s+/;

function stripBom(text: string): string {
  return text.replace(/^﻿/, '');
}

/**
 * Index of the line where the document body starts: right after a leading
 * `---`-delimited YAML front-matter block, or `0` when there is none. If
 * there is no closing `---`, the file is treated as having no front matter
 * at all — heading detection then runs over the untouched original text —
 * rather than swallowing the whole document as "front matter" with nothing
 * after it.
 */
function frontMatterBodyStart(lines: string[]): number {
  if (lines.length === 0 || !FRONT_MATTER_DELIM.test(lines[0]!)) return 0;
  for (let i = 1; i < lines.length; i++) {
    if (FRONT_MATTER_DELIM.test(lines[i]!)) return i + 1;
  }
  return 0;
}

export type HeadingStyle = 'atx' | 'setext';

/**
 * A heading found in a document: its text, which line it occupies, and
 * whether it was written ATX (`# Heading`) or setext (`Heading\n===`) style.
 * `lineIndex` is an index into `markdown.split(/\r?\n/)` on the *original*
 * text passed to `findH1` — stripping a leading BOM never changes line
 * positions, so callers can splice the original line array directly.
 */
export interface FoundHeading {
  text: string;
  lineIndex: number;
  style: HeadingStyle;
}

/**
 * The document's first H1 — ATX or setext — after stripping a BOM and any
 * leading front matter, or null when there isn't one. `isRealSoul`,
 * `displayNameFor`, and `soul.ts`'s `parseSoulHeading`/`withSoulHeading` all
 * read from this single scan so they always agree on which heading (if any)
 * makes the profile real, and on exactly which line it lives on.
 */
export function findH1(soul: string): FoundHeading | null {
  const lines = stripBom(soul).split(/\r?\n/);
  const start = frontMatterBodyStart(lines);
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!;
    const atx = ATX_H1.exec(line);
    if (atx) return { text: atx[1]!.trim(), lineIndex: i, style: 'atx' };
    if (line.trim() !== '' && !line.startsWith('#')) {
      const next = lines[i + 1];
      if (next !== undefined && SETEXT_UNDERLINE.test(next)) {
        return { text: line.trim(), lineIndex: i, style: 'setext' };
      }
    }
  }
  return null;
}

/** Splits a heading's text into a name and an optional tagline. */
export function splitHeading(text: string): SoulHeading {
  const split = HEADING_SEPARATOR.exec(text);
  if (!split || split.index === 0) return { name: text, tagline: null };
  return {
    name: text.slice(0, split.index).trim(),
    tagline: text.slice(split.index + split[0].length).trim() || null,
  };
}

export function isRealSoul(soul: string | null): boolean {
  if (soul === null) return false;
  return findH1(soul) !== null;
}

/** The heading's name when there is one, otherwise the on-disk id. */
export function displayNameFor(id: string, soul: string | null): string {
  const found = soul === null ? null : findH1(soul);
  if (found === null) return id;
  return splitHeading(found.text).name;
}

/**
 * True when claiming the default profile would destroy a persona the user
 * wrote. Task 8's wizard routes to a confirm screen when this is true.
 */
export function hasConfiguredDefault(profiles: HermesProfile[]): boolean {
  return profiles.find((p) => p.id === 'default')?.isReal ?? false;
}

/**
 * Profiles shown when Circe adopts an existing Hermes installation.
 *
 * A named configured profile proves this is an existing fleet. Once that is
 * true, include Hermes's default profile too even when its SOUL.md has no H1:
 * default is a usable agent and older/user-written personas do not all follow
 * Circe's heading convention. On a genuinely fresh install the lone scaffold
 * default still yields an empty list and takes the ordinary onboarding path.
 */
export function adoptableProfiles(profiles: HermesProfile[]): HermesProfile[] {
  if (!profiles.some((profile) => profile.isReal)) return [];
  return profiles.filter((profile) => profile.isReal || profile.id === 'default');
}
