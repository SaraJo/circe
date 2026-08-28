import { describe, expect, it } from 'vitest';
import { primaryFaceFromVisionJson } from '../src/main/faceFocus';

describe('primaryFaceFromVisionJson', () => {
  it('chooses the largest central face from a group shot', () => {
    const face = primaryFaceFromVisionJson(JSON.stringify([
      { x: 0.43, y: 0.55, width: 0.16, height: 0.20, confidence: 0.87 },
      { x: 0.26, y: 0.59, width: 0.15, height: 0.19, confidence: 0.81 },
    ]));
    expect(face).toMatchObject({ x: 0.43, y: 0.55 });
  });

  it('fails closed on malformed or out-of-bounds detector output', () => {
    expect(primaryFaceFromVisionJson('not json')).toBeNull();
    expect(primaryFaceFromVisionJson(JSON.stringify([
      { x: 0.9, y: 0, width: 0.2, height: 0.2, confidence: 1 },
    ]))).toBeNull();
  });
});
