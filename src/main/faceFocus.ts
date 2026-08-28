import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { NormalizedFace } from './pixelAvatar';

/**
 * Uses macOS's on-device Vision framework. No image bytes leave the machine,
 * and failure simply falls back to the ordinary centre crop.
 */
const VISION_SCRIPT = String.raw`
ObjC.import('Vision');
ObjC.import('CoreImage');
function run(argv) {
  const url = $.NSURL.fileURLWithPath(argv[0]);
  const image = $.CIImage.imageWithContentsOfURL(url);
  if (!image) return '[]';
  const request = $.VNDetectFaceRectanglesRequest.alloc.init;
  const handler = $.VNImageRequestHandler.alloc.initWithCIImageOptions(image, $({}));
  const error = Ref();
  if (!handler.performRequestsError($([request]), error)) return '[]';
  return JSON.stringify(request.results.js.map(result => {
    const box = result.boundingBox;
    return {
      x: Number(box.origin.x),
      y: Number(box.origin.y),
      width: Number(box.size.width),
      height: Number(box.size.height),
      confidence: Number(result.confidence)
    };
  }));
}`;

interface VisionFace extends NormalizedFace {
  confidence: number;
}

function validUnit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** Parses untrusted subprocess output and chooses the largest, most central face. */
export function primaryFaceFromVisionJson(json: string): NormalizedFace | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(raw)) return null;
  const faces = raw.filter((value): value is VisionFace => {
    if (typeof value !== 'object' || value === null) return false;
    const face = value as Record<string, unknown>;
    return (
      validUnit(face.x) &&
      validUnit(face.y) &&
      validUnit(face.width) &&
      validUnit(face.height) &&
      validUnit(face.confidence) &&
      face.width > 0 &&
      face.height > 0 &&
      face.x + face.width <= 1.001 &&
      face.y + face.height <= 1.001
    );
  });
  if (faces.length === 0) return null;
  return faces.reduce((best, face) => {
    const score = (candidate: VisionFace) => {
      const area = candidate.width * candidate.height;
      const center = candidate.x + candidate.width / 2;
      return area * candidate.confidence - Math.abs(center - 0.5) * 0.015;
    };
    return score(face) > score(best) ? face : best;
  });
}

/** Detects one primary face from encoded image bytes, synchronously and locally. */
export function detectPrimaryFace(bytes: Uint8Array): NormalizedFace | null {
  if (process.platform !== 'darwin' || bytes.length === 0) return null;
  const dir = mkdtempSync(join(tmpdir(), 'circe-face-'));
  const path = join(dir, 'source');
  try {
    writeFileSync(path, bytes);
    const result = spawnSync(
      '/usr/bin/osascript',
      ['-l', 'JavaScript', '-e', VISION_SCRIPT, path],
      { encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024 },
    );
    if (result.status !== 0 || result.error) return null;
    return primaryFaceFromVisionJson(result.stdout.trim());
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
