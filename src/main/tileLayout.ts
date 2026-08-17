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
 * Cascades down-and-left so each tile's header stays visible, and wraps to a
 * new column when the next step would push a tile off the bottom — a laptop
 * screen with a seven-agent fleet runs out of vertical room fast.
 *
 * The index cycles through the whole `perColumn * columns` grid
 * (`index % (perColumn * columns)`) rather than being clamped once a column
 * runs off the right edge: clamping collapsed every index sharing a `row`
 * onto the same clamped x once its column ran out of room, so two tiles could
 * land in the exact, indistinguishable same spot with one fully hidden behind
 * the other. Cycling keeps every slot in a full grid distinct instead — but
 * only if columns can't overlap in the first place. `perColumn` is capped at
 * 8: on a tall display it would otherwise reach deep enough (e.g. 51 rows on
 * a 2160px monitor) that the row cascade's own leftward drift — `row *
 * CASCADE_STEP`, up to 1600px at 51 rows — exceeds a column's width, so two
 * different columns land at the same clamped edge for the same row and
 * collide again despite the cycling fix. `colStep` accounts for the full
 * drift a capped column produces, so `columns` is sized to never overlap.
 * Once a fleet exceeds the whole grid, positions repeat by design —
 * unavoidable with finite screen space, and still distinct from two tiles
 * occupying one point.
 */
export function tilePosition(workArea: Rect, index: number): { x: number; y: number } {
  const perColumn = Math.min(
    8,
    Math.max(1, Math.floor((workArea.height - TILE_MARGIN * 2 - TILE_H) / CASCADE_STEP) + 1),
  );
  const colStep = TILE_W + CASCADE_STEP + (perColumn - 1) * CASCADE_STEP;
  const columns = Math.max(
    1,
    Math.floor((workArea.width - TILE_MARGIN * 2 - TILE_W) / colStep) + 1,
  );
  const slot = index % (perColumn * columns);
  const column = Math.floor(slot / perColumn);
  const row = slot % perColumn;
  const rawX = workArea.x + workArea.width - TILE_W - TILE_MARGIN - row * CASCADE_STEP - column * colStep;
  const rawY = workArea.y + TILE_MARGIN + row * CASCADE_STEP;
  return {
    // Reachable only for a work area smaller than a single tile, where no
    // grid position is in range at all — every in-grid slot on a real
    // display is sized by `colStep`/`columns` to land in bounds on its own.
    x: Math.max(workArea.x, Math.min(rawX, workArea.x + workArea.width - TILE_W)),
    y: Math.max(workArea.y, Math.min(rawY, workArea.y + workArea.height - TILE_H)),
  };
}
