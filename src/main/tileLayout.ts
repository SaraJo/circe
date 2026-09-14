/**
 * The tile, which is both the window and the card: they are the same rectangle.
 *
 * An earlier revision made the window larger than the card so a CSS drop
 * shadow had somewhere to fall. That is incompatible with macOS vibrancy —
 * the frosted material fills the *window*, so a gutter puts a square halo of
 * frost around a rounded card. The card now fills the window, the corners are
 * rounded by the window itself (`roundedCorners`), and macOS draws the shadow,
 * which is what makes it follow those corners instead of squaring them off.
 */
export const TILE_W = 430;
export const TILE_H = 480;

/** The rectangle part of an Electron `Display.workArea`, with no Electron types. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const TILE_MARGIN = 32;
const TILE_GAP = 16;

/**
 * Where the nth tile of a fleet goes, inside one display's work area.
 *
 * Anchored to the top right of *that display* — the co-ordinates are desktop
 * co-ordinates, so `workArea.x` is not zero on anything but the primary
 * monitor, and treating it as zero is exactly how a tile ended up at x=3370
 * on the wrong screen.
 *
 * Tiles fill a real grid from right to left, then top to bottom. Keeping a
 * full tile-width between columns makes every conversation visible instead
 * of leaving only a 32px title-strip peeking out of a cascade.
 *
 * Once a fleet exceeds the number of full-size tiles that physically fit,
 * positions repeat by design. The window size is fixed, so there is no
 * non-overlapping position left on that display.
 */
export function tilePosition(workArea: Rect, index: number): { x: number; y: number } {
  const usableWidth = Math.max(0, workArea.width - TILE_MARGIN * 2);
  const usableHeight = Math.max(0, workArea.height - TILE_MARGIN * 2);
  const columns = Math.max(1, Math.floor((usableWidth + TILE_GAP) / (TILE_W + TILE_GAP)));
  const rows = Math.max(1, Math.floor((usableHeight + TILE_GAP) / (TILE_H + TILE_GAP)));
  const slot = Math.max(0, index) % (rows * columns);
  const column = slot % columns;
  const row = Math.floor(slot / columns);
  const rawX = workArea.x + workArea.width - TILE_MARGIN - TILE_W - column * (TILE_W + TILE_GAP);
  const rawY = workArea.y + TILE_MARGIN + row * (TILE_H + TILE_GAP);
  return {
    // Reachable only for a work area smaller than a single tile.
    x: Math.max(workArea.x, Math.min(rawX, workArea.x + workArea.width - TILE_W)),
    y: Math.max(workArea.y, Math.min(rawY, workArea.y + workArea.height - TILE_H)),
  };
}
