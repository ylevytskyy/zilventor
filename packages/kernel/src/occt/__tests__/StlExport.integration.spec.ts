import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../occtLoader';
import { makeBox, type OcctShape } from '../SolidOps';
import { exportStlBinary } from '../StlExport';
import { parseBinaryStl, type FacetTriangle } from './binaryStlParser';

let oc: OcctInstance;
beforeAll(async () => {
  oc = await loadOcct();
}, 60_000);

/** Compute the winding normal of a CCW triangle (v0,v1,v2) via cross product. */
function windingNormal(
  v0: [number, number, number],
  v1: [number, number, number],
  v2: [number, number, number],
): [number, number, number] {
  const ax = v1[0] - v0[0], ay = v1[1] - v0[1], az = v1[2] - v0[2];
  const bx = v2[0] - v0[0], by = v2[1] - v0[1], bz = v2[2] - v0[2];
  return [
    ay * bz - az * by,
    az * bx - ax * bz,
    ax * by - ay * bx,
  ];
}

/** True if the winding normal points in the same general direction as (facet centroid - box centroid). */
function normalPointsOutward(
  tri: FacetTriangle,
  boxCentroid: [number, number, number],
): boolean {
  const [v0, v1, v2] = tri;
  const n = windingNormal(v0, v1, v2);
  // Facet centroid
  const fcx = (v0[0] + v1[0] + v2[0]) / 3;
  const fcy = (v0[1] + v1[1] + v2[1]) / 3;
  const fcz = (v0[2] + v1[2] + v2[2]) / 3;
  // Outward vector from box center to facet center
  const dx = fcx - boxCentroid[0];
  const dy = fcy - boxCentroid[1];
  const dz = fcz - boxCentroid[2];
  // Dot product: positive = outward
  return (n[0] * dx + n[1] * dy + n[2] * dz) > 0;
}

describe('exportStlBinary — Phase 1 (single part, identity pose)', () => {
  it('emits a non-empty binary STL whose bbox matches a 10mm box (mm units, toBeCloseTo)', () => {
    const box: OcctShape = makeBox(oc, 10, 10, 10);
    const bytes = exportStlBinary(oc, [{ shape: box }]);

    // Header(80) + count(4) + N*50 — at minimum the header is present.
    expect(bytes.byteLength).toBeGreaterThan(84);

    const { triCount, bbox } = parseBinaryStl(bytes);
    // OCCT may split faces; assert even count and at least 12 tris (2 per face × 6 faces).
    expect(triCount % 2).toBe(0);
    expect(triCount).toBeGreaterThanOrEqual(12);

    // mm proof: span along each axis is exactly 10mm (NOT '>9' — that is the anti-pattern).
    expect(bbox[3] - bbox[0]).toBeCloseTo(10, 3);
    expect(bbox[4] - bbox[1]).toBeCloseTo(10, 3);
    expect(bbox[5] - bbox[2]).toBeCloseTo(10, 3);
    // Box spans [0,10] on every axis.
    expect(bbox[0]).toBeCloseTo(0, 3);
    expect(bbox[3]).toBeCloseTo(10, 3);
  }, 120_000);

  it('every facet winding-normal on a convex box points away from the box centroid (outward-CCW winding)', () => {
    // This is the REVERSED-flip test. A transposed or inverted flip would invert
    // all or some normals — bbox is winding-agnostic so it cannot catch this.
    // Box [0,10]^3 has centroid at [5,5,5].
    const box: OcctShape = makeBox(oc, 10, 10, 10);
    const bytes = exportStlBinary(oc, [{ shape: box }]);
    const { triCount, facetVertices } = parseBinaryStl(bytes);

    expect(triCount).toBeGreaterThanOrEqual(12);
    const boxCentroid: [number, number, number] = [5, 5, 5];
    let inwardCount = 0;
    for (const tri of facetVertices) {
      if (!normalPointsOutward(tri, boxCentroid)) inwardCount++;
    }
    // ALL facets must be outward. Zero tolerance — a transposed flip would
    // produce 100% inward normals; a partial flip would produce N > 0.
    expect(inwardCount).toBe(0);
  }, 120_000);

  it('larger box scales the STL bbox span 1:1 (no unit drift)', () => {
    const box: OcctShape = makeBox(oc, 100, 200, 50);
    const bytes = exportStlBinary(oc, [{ shape: box }]);
    const { triCount, bbox } = parseBinaryStl(bytes);
    expect(triCount % 2).toBe(0);
    expect(triCount).toBeGreaterThanOrEqual(12);
    expect(bbox[3] - bbox[0]).toBeCloseTo(100, 3);
    expect(bbox[4] - bbox[1]).toBeCloseTo(200, 3);
    expect(bbox[5] - bbox[2]).toBeCloseTo(50, 3);
  }, 120_000);
});
