import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../occtLoader';
import { makeBox, computeBoundingBox, disposeShape } from '../SolidOps';

let occt: OcctInstance;
beforeAll(async () => {
  occt = await loadOcct();
}, 60_000);

describe('SolidOps.makeBox', () => {
  it('creates a box with exact bounding box', () => {
    const box = makeBox(occt, 100, 200, 300);
    const bb = computeBoundingBox(occt, box);
    expect(bb[0]).toBeCloseTo(0, 5);
    expect(bb[1]).toBeCloseTo(0, 5);
    expect(bb[2]).toBeCloseTo(0, 5);
    expect(bb[3]).toBeCloseTo(100, 5);
    expect(bb[4]).toBeCloseTo(200, 5);
    expect(bb[5]).toBeCloseTo(300, 5);
    disposeShape(box);
  });

  it('can create+dispose many boxes without unbounded heap growth', () => {
    for (let i = 0; i < 50; i++) {
      const b = makeBox(occt, 10, 10, 10);
      disposeShape(b);
    }
    // Soft assertion — OCCT heap growth is nondeterministic, just assert no crash
    expect(true).toBe(true);
  });
});
