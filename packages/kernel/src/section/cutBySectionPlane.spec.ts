import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../occt/occtLoader';
import { computeBoundingBox, makeBox, type OcctShape } from '../occt/SolidOps';
import { buildHalfSpace, type Plane } from './cutBySectionPlane';

let oc: OcctInstance;
beforeAll(async () => { oc = await loadOcct(); }, 60_000);

describe('buildHalfSpace', () => {
  it('plane through origin +Z arrowDirection=1 → solid extends ≥1km on -Z side', () => {
    const plane: Plane = { origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } };
    const solid = buildHalfSpace(oc, plane, 1);
    const bb = computeBoundingBox(oc, solid);
    // half-space keeps the side OPPOSITE to arrowDirection (the -Z side)
    expect(bb[2]).toBeLessThanOrEqual(-1_000_000);  // zmin ≤ -1 000 000 mm
    expect(bb[5]).toBeCloseTo(0, 2);                // zmax ≈ 0 (coincident face)
    expect(bb[3] - bb[0]).toBeGreaterThanOrEqual(1_000_000); // width ≥ 1 km
    expect(bb[4] - bb[1]).toBeGreaterThanOrEqual(1_000_000); // depth ≥ 1 km
    (solid.handle as { delete(): void }).delete();
  });

  it('plane through origin +X arrowDirection=-1 → solid extends on +X side', () => {
    const plane: Plane = { origin: { x: 0, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } };
    const solid = buildHalfSpace(oc, plane, -1);
    const bb = computeBoundingBox(oc, solid);
    // arrowDirection=-1 → keep +X side (same direction as normal)
    expect(bb[0]).toBeCloseTo(0, 2);               // xmin ≈ 0
    expect(bb[3]).toBeGreaterThanOrEqual(1_000_000); // xmax ≥ 1 km
    (solid.handle as { delete(): void }).delete();
  });

  it('bounding box extends ≥ 1 km in all three axis extents', () => {
    const plane: Plane = { origin: { x: 50, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } };
    const solid = buildHalfSpace(oc, plane, 1);
    const bb = computeBoundingBox(oc, solid);
    expect(bb[3] - bb[0]).toBeGreaterThanOrEqual(1_000_000);
    expect(bb[4] - bb[1]).toBeGreaterThanOrEqual(1_000_000);
    expect(bb[5] - bb[2]).toBeGreaterThanOrEqual(1_000_000);
    (solid.handle as { delete(): void }).delete();
  });
});
