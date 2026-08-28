import { describe, expect, it } from 'vitest';
import { PIXEL_AVATAR_SIZE, pixelateAvatar, type RasterImage } from '../src/main/pixelAvatar';

function image(width: number, height: number, output = new Uint8Array([1, 2, 3])) {
  const calls: Array<{ kind: string; value: unknown }> = [];
  const raster: RasterImage = {
    isEmpty: () => false,
    getSize: () => ({ width, height }),
    crop: (value) => {
      calls.push({ kind: 'crop', value });
      return raster;
    },
    resize: (value) => {
      calls.push({ kind: 'resize', value });
      return raster;
    },
    toPNG: () => output,
  };
  return { raster, calls };
}

describe('pixelateAvatar', () => {
  it('centre-crops a landscape image and reduces it to a 32px square', () => {
    const { raster, calls } = image(300, 200);
    expect(pixelateAvatar(raster)).toEqual(new Uint8Array([1, 2, 3]));
    expect(calls).toEqual([
      { kind: 'crop', value: { x: 50, y: 0, width: 200, height: 200 } },
      {
        kind: 'resize',
        value: { width: PIXEL_AVATAR_SIZE, height: PIXEL_AVATAR_SIZE, quality: 'good' },
      },
    ]);
  });

  it('centre-crops a portrait image', () => {
    const { raster, calls } = image(180, 300);
    pixelateAvatar(raster);
    expect(calls[0]).toEqual({
      kind: 'crop',
      value: { x: 0, y: 60, width: 180, height: 180 },
    });
  });

  it('uses a padded face crop when Vision finds a face', () => {
    const { raster, calls } = image(330, 220);
    pixelateAvatar(raster, {
      x: 0.427346,
      y: 0.546559,
      width: 0.157401,
      height: 0.201327,
    });
    expect(calls[0]).toEqual({
      kind: 'crop',
      value: { x: 106, y: 32, width: 122, height: 122 },
    });
  });

  it('fails silently for an empty or invalid image', () => {
    const empty = image(100, 100).raster;
    empty.isEmpty = () => true;
    expect(pixelateAvatar(empty)).toBeNull();
    expect(pixelateAvatar(image(0, 100).raster)).toBeNull();
    expect(pixelateAvatar(image(100, 100, new Uint8Array()).raster)).toBeNull();
  });
});
