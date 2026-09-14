import { describe, expect, it } from 'vitest';
import { tilePosition, TILE_H, TILE_W } from '../src/main/tileLayout';

/** A 1920×1080 display whose work area starts below a menu bar. */
const WORK_AREA = { x: 0, y: 25, width: 1920, height: 1055 };
/** An external display to the right of the primary one — negative and offset origins are real. */
const RIGHT_OF = { x: 1920, y: 0, width: 3840, height: 2160 };

describe('tilePosition', () => {
  it('anchors the first tile to the top right of the work area', () => {
    expect(tilePosition(WORK_AREA, 0)).toEqual({ x: 1920 - TILE_W - 32, y: 25 + 32 });
  });

  // The anchor is relative to the display, not to the desktop origin, or a
  // tile lands on the wrong monitor — the x=3370 defect.
  it('anchors to the display it was given, not to the desktop origin', () => {
    expect(tilePosition(RIGHT_OF, 0)).toEqual({ x: 1920 + 3840 - TILE_W - 32, y: 32 });
  });

  it('places adjacent tiles in non-overlapping columns', () => {
    const first = tilePosition(WORK_AREA, 0);
    const second = tilePosition(WORK_AREA, 1);
    expect(second.x).toBe(first.x - TILE_W - 16);
    expect(second.y).toBe(first.y);
  });

  it('wraps onto a second grid row after filling the first', () => {
    const first = tilePosition(WORK_AREA, 0);
    const fifth = tilePosition(WORK_AREA, 4);
    expect(fifth.x).toBe(first.x);
    expect(fifth.y).toBe(first.y + TILE_H + 16);
  });

  it('keeps every tile of a large fleet fully inside the work area', () => {
    // 20 exceeds this display's eight-slot grid, exercising the cycle too.
    for (let i = 0; i < 20; i++) {
      const { x, y } = tilePosition(WORK_AREA, i);
      expect(x).toBeGreaterThanOrEqual(WORK_AREA.x);
      expect(y).toBeGreaterThanOrEqual(WORK_AREA.y);
      expect(x + TILE_W).toBeLessThanOrEqual(WORK_AREA.x + WORK_AREA.width);
      expect(y + TILE_H).toBeLessThanOrEqual(WORK_AREA.y + WORK_AREA.height);
    }
  });

  it('uses every non-overlapping slot available on a short display', () => {
    const short = { x: 0, y: 25, width: 1440, height: 700 };
    const positions = Array.from({ length: 3 }, (_, i) => tilePosition(short, i));
    for (const { x, y } of positions) {
      expect(x).toBeGreaterThanOrEqual(short.x);
      expect(y).toBeGreaterThanOrEqual(short.y);
      expect(x + TILE_W).toBeLessThanOrEqual(short.x + short.width);
      expect(y + TILE_H).toBeLessThanOrEqual(short.y + short.height);
    }
    expect(new Set(positions.map((p) => `${p.x},${p.y}`)).size).toBe(positions.length);
  });

  function gridCapacity(area: Parameters<typeof tilePosition>[0]): number {
    const first = tilePosition(area, 0);
    for (let i = 1; i < 512; i++) {
      const p = tilePosition(area, i);
      if (p.x === first.x && p.y === first.y) return i;
    }
    throw new Error('tilePosition never cycled — the grid is not finite.');
  }

  it('keeps every position distinct for one full grid', () => {
    const positions = Array.from({ length: gridCapacity(RIGHT_OF) }, (_, i) => tilePosition(RIGHT_OF, i));
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
