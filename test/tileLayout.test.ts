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
    // 20 exceeds WORK_AREA's per-column capacity (16 rows fit before a wrap
    // is forced), so this exercises the column wrap rather than staying in a
    // single column the whole way through.
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

  // This is the scale that exposed the wrap-collision bug: on the short
  // fixture, perColumn is 5 and columns is 3, so the whole grid holds 15
  // slots. Index 15 (grid slot 0) and index 20 (grid slot 5) used to both
  // clamp to the same x with row 0, landing exactly on top of one another
  // with the earlier tile fully hidden behind the later one.
  it('does not collide across columns at the scale that exposed the bug', () => {
    const short = { x: 0, y: 25, width: 1440, height: 700 };
    const positions = Array.from({ length: 15 }, (_, i) => tilePosition(short, i));
    for (const { x, y } of positions) {
      expect(x).toBeGreaterThanOrEqual(short.x);
      expect(y).toBeGreaterThanOrEqual(short.y);
      expect(x + TILE_W).toBeLessThanOrEqual(short.x + short.width);
      expect(y + TILE_H).toBeLessThanOrEqual(short.y + short.height);
    }
    // A full grid's worth of tiles must occupy 15 distinct positions, not fewer.
    expect(new Set(positions.map((p) => `${p.x},${p.y}`)).size).toBe(positions.length);

    // The exact pair the reviewer found colliding under the old clamp.
    expect(tilePosition(short, 15)).not.toEqual(tilePosition(short, 20));
  });
});
