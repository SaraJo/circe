export const TILE_W = 430;
export const TILE_H = 480;


/** The rectangle part of an Electron `Display.workArea`, with no Electron types. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const TILE_MARGIN = 40;
const CASCADE_STEP = 32;

/**
 * Where the nth tile of a fleet goes, inside one display's work area.
 *
 * Anchored to the top right of *that display* — the co-ordinates are desktop
 * co-ordinates, so `workArea.x` is not zero on anything but the primary
 * monitor, and treating it as zero is exactly how a tile ended up at x=3370
 * on the wrong screen.
 *
 * Cascades down-and-left so each tile's header stays visible, and wraps back
 * to the top when the next step would push a tile off the bottom — a laptop
 * screen with a seven-agent fleet runs out of vertical room fast. The wrap
 * shifts the column left so a wrapped tile never lands exactly on top of an
 * earlier one.
 */
export function tilePosition(workArea: Rect, index: number): { x: number; y: number } {
  const perColumn = Math.max(
    1,
    Math.floor((workArea.height - TILE_MARGIN * 2 - TILE_H) / CASCADE_STEP) + 1,
  );
  const column = Math.floor(index / perColumn);
  const row = index % perColumn;
  const rawX = workArea.x + workArea.width - TILE_W - TILE_MARGIN - row * CASCADE_STEP - column * (TILE_W + CASCADE_STEP);
  const rawY = workArea.y + TILE_MARGIN + row * CASCADE_STEP;
  return {
    // Clamped so a fleet larger than the screen piles up in the corner rather
    // than walking off it. Piled-up tiles are still reachable; off-screen ones
    // are not.
    x: Math.max(workArea.x, Math.min(rawX, workArea.x + workArea.width - TILE_W)),
    y: Math.max(workArea.y, Math.min(rawY, workArea.y + workArea.height - TILE_H)),
  };
}
