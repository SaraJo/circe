import { describe, expect, it } from 'vitest';
import { tilePosition, TILE_H, TILE_W } from '../src/main/tileLayout';

/** A 1920×1080 display whose work area starts below a menu bar. */
const WORK_AREA = { x: 0, y: 25, width: 1920, height: 1055 };
/** An external display to the right of the primary one — negative and offset origins are real. */
const RIGHT_OF = { x: 1920, y: 0, width: 3840, height: 2160 };

describe('tilePosition', () => {
  it('anchors the first tile to the top right of the work area', () => {
    expect(tilePosition(WORK_AREA, 0)).toEqual({ x: 1920 - TILE_W - 40, y: 25 + 40 });
  });

  // The anchor is relative to the display, not to the desktop origin, or a
  // tile lands on the wrong monitor — the x=3370 defect.
  it('anchors to the display it was given, not to the desktop origin', () => {
    expect(tilePosition(RIGHT_OF, 0)).toEqual({ x: 1920 + 3840 - TILE_W - 40, y: 40 });
  });

  it('cascades each further tile down and to the left by the cascade step', () => {
    const first = tilePosition(WORK_AREA, 0);
    const second = tilePosition(WORK_AREA, 1);
    // The cascade step (32px) is internal to tileLayout.ts and not exported;
    // asserting the exact delta, not just its sign, is what catches a
    // wrong-step-size regression that a direction-only check would miss.
    expect(second.x).toBe(first.x - 32);
    expect(second.y).toBe(first.y + 32);
  });

  it('keeps every tile of a large fleet fully inside the work area', () => {
    // 20 exceeds WORK_AREA's per-column capacity (capped at 8 rows before a
    // wrap is forced — see tileLayout.ts's round-2 cap), so this exercises
    // the column wrap rather than staying in a single column the whole way
    // through.
    for (let i = 0; i < 20; i++) {
      const { x, y } = tilePosition(WORK_AREA, i);
      expect(x).toBeGreaterThanOrEqual(WORK_AREA.x);
      expect(y).toBeGreaterThanOrEqual(WORK_AREA.y);
      expect(x + TILE_W).toBeLessThanOrEqual(WORK_AREA.x + WORK_AREA.width);
      expect(y + TILE_H).toBeLessThanOrEqual(WORK_AREA.y + WORK_AREA.height);
    }
  });

  // A laptop screen with a big fleet is the case that wraps.
  it('wraps rather than marching off a short display', () => {
    const short = { x: 0, y: 25, width: 1440, height: 700 };
    const positions = Array.from({ length: 8 }, (_, i) => tilePosition(short, i));
    for (const { x, y } of positions) {
      expect(x).toBeGreaterThanOrEqual(short.x);
      expect(y).toBeGreaterThanOrEqual(short.y);
      expect(x + TILE_W).toBeLessThanOrEqual(short.x + short.width);
      expect(y + TILE_H).toBeLessThanOrEqual(short.y + short.height);
    }
    // Wrapping must not stack two tiles in exactly the same place: every
    // position in a fleet smaller than the whole grid must be distinct, not
    // merely "more than one distinct value seen".
    expect(new Set(positions.map((p) => `${p.x},${p.y}`)).size).toBe(positions.length);
  });

  // This is the scale that exposed the round-1 wrap-collision bug. The grid's
  // capacity is *derived*, not written down: it moves whenever `perColumn` or
  // `colStep` does — round 2's wider `colStep` took it from 15 to 10, and
  // giving the window a shadow gutter moved it again. A hardcoded count makes
  // this test fail for a dimension change while saying nothing about the
  // collision it exists to catch, so find the cycle by asking the function.
  function gridCapacity(area: Parameters<typeof tilePosition>[0]): number {
    const first = tilePosition(area, 0);
    for (let i = 1; i < 512; i++) {
      const p = tilePosition(area, i);
      if (p.x === first.x && p.y === first.y) return i;
    }
    throw new Error('tilePosition never cycled — the grid is not finite.');
  }

  it('does not collide across columns at the scale that exposed the bug', () => {
    const short = { x: 0, y: 25, width: 1440, height: 700 };
    const positions = Array.from({ length: gridCapacity(short) }, (_, i) => tilePosition(short, i));
    for (const { x, y } of positions) {
      expect(x).toBeGreaterThanOrEqual(short.x);
      expect(y).toBeGreaterThanOrEqual(short.y);
      expect(x + TILE_W).toBeLessThanOrEqual(short.x + short.width);
      expect(y + TILE_H).toBeLessThanOrEqual(short.y + short.height);
    }
    // A full grid's worth of tiles must all occupy distinct positions.
    expect(new Set(positions.map((p) => `${p.x},${p.y}`)).size).toBe(positions.length);

    // The exact pair the round-1 reviewer found colliding under the old clamp.
    expect(tilePosition(short, 15)).not.toEqual(tilePosition(short, 20));
  });

  // Round 2: on a tall external display, perColumn reaches deep enough that
  // the row-driven x drift (32px per row) exceeds a column's own width, so
  // two different columns can clamp to the same edge for the same row —
  // identical x, and y depends only on row, so identical y too. The fix caps
  // row depth per column and sizes the column step to the drift it actually
  // produces, closing that gap. The exact colliding pair the re-reviewer
  // found under the un-capped grid: index 325 and index 376.
  it('does not collide on a tall external display where row drift used to outrun the column step', () => {
    expect(tilePosition(RIGHT_OF, 325)).not.toEqual(tilePosition(RIGHT_OF, 376));
  });

  it('keeps a full grid cycle distinct and contained on a large external display', () => {
    // perColumn 8, columns 5 → grid of 40 after the row-depth cap.
    const positions = Array.from({ length: 40 }, (_, i) => tilePosition(RIGHT_OF, i));
    for (const { x, y } of positions) {
      expect(x).toBeGreaterThanOrEqual(RIGHT_OF.x);
      expect(y).toBeGreaterThanOrEqual(RIGHT_OF.y);
      expect(x + TILE_W).toBeLessThanOrEqual(RIGHT_OF.x + RIGHT_OF.width);
      expect(y + TILE_H).toBeLessThanOrEqual(RIGHT_OF.y + RIGHT_OF.height);
    }
    expect(new Set(positions.map((p) => `${p.x},${p.y}`)).size).toBe(positions.length);
  });

  it('produces a sane, non-negative position on a work area smaller than one tile', () => {
    const tiny = { x: 0, y: 0, width: 200, height: 200 };
    for (let i = 0; i < 3; i++) {
      const { x, y } = tilePosition(tiny, i);
      expect(Number.isNaN(x)).toBe(false);
      expect(Number.isNaN(y)).toBe(false);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
    }
  });
});
