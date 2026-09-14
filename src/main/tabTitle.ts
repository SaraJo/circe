const filler = new Set('a an the to of for in on with my me i we you can could would please'.split(' '));

/** Compact local labels, without waiting for another model request. */
export function shortTabTitle(text: string): string {
  const continuation = text.match(/^(.*) · (\d+)$/u);
  const words = (continuation?.[1] ?? text).trim().split(/\s+/u);
  const meaningful = words.filter((word) => !filler.has(word.toLowerCase()));
  const label = (meaningful.length ? meaningful : words).slice(0, 2).join(' ');
  const points = Array.from(label);
  const base = points.length > 24 ? points.slice(0, 23).join('').trimEnd() + '…' : label;
  return base + (continuation ? ` · ${continuation[2]}` : '');
}
