import type { SoulHeading } from '../../shared/types';

/**
 * Matches a level-1 ATX heading and splits it into a name and an optional
 * tagline. Real profiles on disk use an em dash, a hyphen, or a comma as the
 * separator, so all three are accepted. Hermes's own scaffold template is bare
 * prose with no heading at all, which is what the §5.4 realness rule keys on.
 */
const H1 = /^#[ \t]+(.+?)[ \t]*$/;
const SEPARATOR = /\s+—\s+|\s+–\s+|\s+-\s+|,\s+/;

export function parseSoulHeading(markdown: string): SoulHeading | null {
  const firstNonEmpty = markdown.split(/\r?\n/).find((l) => l.trim() !== '');
  if (firstNonEmpty === undefined) return null;

  // A level-2 heading must not match, so reject `##` before testing.
  if (/^#{2,}/.test(firstNonEmpty.trim())) return null;

  const m = H1.exec(firstNonEmpty.trim());
  if (!m) return null;

  const heading = m[1]!.trim();
  const split = SEPARATOR.exec(heading);
  if (!split || split.index === 0) {
    return { name: heading, tagline: null };
  }
  return {
    name: heading.slice(0, split.index).trim(),
    tagline: heading.slice(split.index + split[0].length).trim() || null,
  };
}

/** Circe always writes the canonical em-dash form, whatever it read. */
export function renderSoulHeading(h: SoulHeading): string {
  return h.tagline ? `# ${h.name} — ${h.tagline}` : `# ${h.name}`;
}

/**
 * Returns `markdown` with its heading replaced by `h`, or with `h` prepended if
 * it had none. The body is preserved byte-for-byte either way — Circe must not
 * rewrite persona text the user wrote (§4.9).
 */
export function withSoulHeading(markdown: string, h: SoulHeading): string {
  const line = renderSoulHeading(h);
  if (parseSoulHeading(markdown) === null) {
    return markdown.trim() === '' ? `${line}\n` : `${line}\n\n${markdown}`;
  }
  const lines = markdown.split(/\r?\n/);
  const idx = lines.findIndex((l) => l.trim() !== '');
  lines[idx] = line;
  return lines.join('\n');
}
