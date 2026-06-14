// packages/shared/src/__tests__/faceFrameMath.spec.ts
import { describe, it, expect } from 'vitest';
import { layoutFaceFrame, type FaceFrameParams } from '../faceFrameMath';
import { DOOR_POSE } from '../prisadkaFaceConventions';

const BASE: FaceFrameParams = {
  width: 600, height: 720, toekickHeight: 100, depth: 560,
  rows: 1, cols: 1, stileWidth: 38, railWidth: 38, thickness: 19,
};

describe('layoutFaceFrame', () => {
  it('1×1: 2 stiles + 2 rails with hand-derived dims/positions', () => {
    const m = layoutFaceFrame(BASE);
    const stiles = m.filter((x) => x.role === 'faceFrameStile');
    const rails = m.filter((x) => x.role === 'faceFrameRail');
    expect(stiles).toHaveLength(2);
    expect(rails).toHaveLength(2);

    // stile dims + centers (hand oracle)
    stiles.forEach((s) => {
      expect(s.dims).toEqual({ length: 620, width: 38, thickness: 19 });
      expect(s.pose.translation.y).toBeCloseTo(569.5, 6);
      expect(s.pose.translation.z).toBeCloseTo(410, 6);
      expect(s.pose.quaternion).toEqual(DOOR_POSE.quaternion);
    });
    const sx = stiles.map((s) => s.pose.translation.x).sort((a, b) => a - b);
    expect(sx[0]).toBeCloseTo(19, 6);
    expect(sx[1]).toBeCloseTo(581, 6);

    // rail dims + centers (hand oracle)
    rails.forEach((r) => {
      expect(r.dims).toEqual({ length: 38, width: 524, thickness: 19 });
      expect(r.pose.translation.x).toBeCloseTo(300, 6);
      expect(r.pose.translation.y).toBeCloseTo(569.5, 6);
    });
    const rz = rails.map((r) => r.pose.translation.z).sort((a, b) => a - b);
    expect(rz[0]).toBeCloseTo(119, 6);
    expect(rz[1]).toBeCloseTo(701, 6);
  });

  it('member counts generalize: 2×1→5, 1×2→7, 2×2→9', () => {
    expect(layoutFaceFrame({ ...BASE, rows: 2, cols: 1 })).toHaveLength(5);
    expect(layoutFaceFrame({ ...BASE, rows: 1, cols: 2 })).toHaveLength(7);
    expect(layoutFaceFrame({ ...BASE, rows: 2, cols: 2 })).toHaveLength(9);
  });

  it('all members lie within the front rectangle [0,W]×[tkH,H]', () => {
    const m = layoutFaceFrame({ ...BASE, rows: 2, cols: 2 });
    for (const x of m) {
      // half-extents in X (across) = world from width or stileWidth; in Z (up) = length or railWidth
      const hx = (x.role === 'faceFrameStile' ? x.dims.width : x.dims.width) / 2; // X half = part width
      const hz = (x.role === 'faceFrameStile' ? x.dims.length : x.dims.length) / 2; // Z half = part length
      expect(x.pose.translation.x - hx).toBeGreaterThanOrEqual(-1e-6);
      expect(x.pose.translation.x + hx).toBeLessThanOrEqual(600 + 1e-6);
      expect(x.pose.translation.z - hz).toBeGreaterThanOrEqual(100 - 1e-6);
      expect(x.pose.translation.z + hz).toBeLessThanOrEqual(720 + 1e-6);
    }
  });

  it('throws when the opening collapses (too many columns for width)', () => {
    expect(() => layoutFaceFrame({ ...BASE, cols: 20 })).toThrow(/opening collapses/);
  });
  it('throws when the opening collapses (too many rows for height)', () => {
    expect(() => layoutFaceFrame({ ...BASE, rows: 20 })).toThrow(/opening collapses/);
  });
  it('throws on rows/cols < 1', () => {
    expect(() => layoutFaceFrame({ ...BASE, cols: 0 })).toThrow(/≥ 1/);
  });
});
