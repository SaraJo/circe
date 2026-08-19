/**
 * The face on an initials circle, shared by the wizard's meet screen and the
 * tile header because both need exactly this and a second copy would drift.
 * A leaf module with no DOM access at import time, so tests can reach it.
 */

/** Up to two initials, e.g. `Long John Silver` becomes `LJ`. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * Puts a face on an initials circle, or takes it off. One code path for the
 * first render and the arrives-late update, following the rule the tile's
 * re-theme already follows: an update carrying nothing leaves what is showing
 * alone, and the initials stay underneath a face that fails to decode.
 */
export function applyFace(avatar: HTMLElement, url: string | null): void {
  avatar.querySelector('img')?.remove();
  if (!url) return;
  const img = document.createElement('img');
  img.src = url;
  img.alt = '';
  avatar.append(img);
}
