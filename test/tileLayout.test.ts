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

  it('cascades each further tile down and to the left', () => {
    const first = tilePosition(WORK_AREA, 0);
    const second = tilePosition(WORK_AREA, 1);
    expect(second.x).toBeLessThan(first.x);
    expect(second.y).toBeGreaterThan(first.y);
  });

  it('keeps every tile of a large fleet fully inside the work area', () => {
    for (let i = 0; i < 12; i++) {
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
    for (const { y } of positions) expect(y + TILE_H).toBeLessThanOrEqual(725);
    // Wrapping must not stack two tiles in exactly the same place.
    expect(new Set(positions.map((p) => `${p.x},${p.y}`)).size).toBeGreaterThan(1);
  });
});
