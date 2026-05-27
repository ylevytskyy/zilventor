import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../occtLoader';
import { makeBox, computeBoundingBox, disposeShape } from '../SolidOps';
import { transformShapeByPose } from '../TransformOps';

let oc: OcctInstance;
beforeAll(async () => { oc = await loadOcct(); }, 60_000);

describe('transformShapeByPose', () => {
  it('translates a box by the pose translation (identity rotation)', () => {
    const box = makeBox(oc, 10, 10, 10);
    const posed = transformShapeByPose(oc, box, {
      translation: { x: 100, y: 0, z: 0 },
      quaternion: [0, 0, 0, 1],
    });
    expect(computeBoundingBox(oc, posed)[0]).toBeCloseTo(100, 3); // xmin moved to 100
    expect(computeBoundingBox(oc, box)[0]).toBeCloseTo(0, 3);     // source unchanged (copy=true)
    disposeShape(posed);
    disposeShape(box);
  });

  it('rotates a box 90° about Z so it occupies x∈[-10,0], y∈[0,10]', () => {
    const box = makeBox(oc, 10, 10, 10);
    const s = Math.SQRT1_2; // 90° about Z → quaternion [0,0,sin45,cos45]
    const posed = transformShapeByPose(oc, box, {
      translation: { x: 0, y: 0, z: 0 },
      quaternion: [0, 0, s, s],
    });
    const [xmin, ymin] = computeBoundingBox(oc, posed);
    expect(xmin).toBeCloseTo(-10, 2);
    expect(ymin).toBeCloseTo(0, 2);
    disposeShape(posed);
    disposeShape(box);
  });
});
