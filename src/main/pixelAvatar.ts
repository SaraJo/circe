/** The stored resolution. Renderers enlarge it with nearest-neighbour scaling. */
export const PIXEL_AVATAR_SIZE = 32;

/**
 * The small part of Electron's `NativeImage` used by the avatar treatment.
 * Kept structural so the transformation can be tested without loading
 * Electron into Vitest's Node environment.
 */
export interface RasterImage {
  isEmpty(): boolean;
  getSize(): { width: number; height: number };
  crop(rect: { x: number; y: number; width: number; height: number }): RasterImage;
  resize(options: {
    width: number;
    height: number;
    quality: 'good' | 'better' | 'best';
  }): RasterImage;
  toPNG(): Uint8Array;
}

/** Vision uses normalized coordinates with its origin at the bottom left. */
export interface NormalizedFace {
  x: number;
  y: number;
  width: number;
  height: number;
}

function faceSquare(
  face: NormalizedFace,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  const faceWidth = face.width * width;
  const faceHeight = face.height * height;
  const centerX = (face.x + face.width / 2) * width;
  // Convert Vision's bottom-left origin to image coordinates, then place the
  // face a little above centre so the crop keeps some hair and shoulders.
  const faceTop = (1 - face.y - face.height) * height;
  const centerY = faceTop + faceHeight * 0.85;
  // At 2.35 the detected face occupied only about 14 of the final 32 pixels:
  // recognisable at wizard size, but a low-contrast smudge in the tile. 1.85
  // still keeps hair and a little shoulder while giving the eyes, nose and
  // mouth roughly four more pixels to read with.
  const side = Math.min(Math.min(width, height), Math.max(faceWidth, faceHeight) * 1.85);
  const x = Math.max(0, Math.min(width - side, centerX - side / 2));
  const y = Math.max(0, Math.min(height - side, centerY - side / 2));
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(1, Math.round(side)),
    height: Math.max(1, Math.round(side)),
  };
}

/**
 * Turns a sourced portrait into Circe's square, 32px retro treatment.
 * Cropping before resizing matches the circular `object-fit: cover` framing
 * the UI already used, so the stored image and the preview show the same face.
 */
export function pixelateAvatar(image: RasterImage, face: NormalizedFace | null = null): Uint8Array | null {
  if (image.isEmpty()) return null;
  const { width, height } = image.getSize();
  if (width <= 0 || height <= 0) return null;

  const side = Math.min(width, height);
  const crop = face
    ? faceSquare(face, width, height)
    : {
        x: Math.floor((width - side) / 2),
        y: Math.floor((height - side) / 2),
        width: side,
        height: side,
      };
  const square = image.crop(crop);
  const pixels = square.resize({
    width: PIXEL_AVATAR_SIZE,
    height: PIXEL_AVATAR_SIZE,
    quality: 'good',
  });
  if (pixels.isEmpty()) return null;
  const png = pixels.toPNG();
  return png.length > 0 ? new Uint8Array(png) : null;
}
