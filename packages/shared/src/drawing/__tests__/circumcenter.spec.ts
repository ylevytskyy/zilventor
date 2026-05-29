// packages/shared/src/drawing/__tests__/circumcenter.spec.ts
import { describe, it, expect } from 'vitest';
import { circumcenterFromPolyline } from '../circumcenter';

// ---------------------------------------------------------------------------
// Helper: generate N equally-spaced points on circle (cx, cy, r)
// ---------------------------------------------------------------------------
function circlePoints(
  cx: number,
  cy: number,
  r: number,
  n: number,
): ReadonlyArray<readonly [number, number]> {
  return Array.from({ length: n }, (_, i) => {
    const θ = (2 * Math.PI * i) / n;
    return [cx + r * Math.cos(θ), cy + r * Math.sin(θ)] as const;
  });
}

describe('circumcenterFromPolyline — unit circle 3 points', () => {
  it('recovers center (0,0) and radius 1 from [1,0],[0,1],[-1,0]', () => {
    const pts: ReadonlyArray<readonly [number, number]> = [[1, 0], [0, 1], [-1, 0]];
    const { cx, cy, r } = circumcenterFromPolyline(pts);
    expect(cx).toBeCloseTo(0, 9);
    expect(cy).toBeCloseTo(0, 9);
    expect(r).toBeCloseTo(1, 9);
  });
});

describe('circumcenterFromPolyline — 8-point circle r=5 centered (3,-2)', () => {
  it('recovers center and radius within 0.01 tolerance', () => {
    const pts = circlePoints(3, -2, 5, 8);
    const { cx, cy, r } = circumcenterFromPolyline(pts);
    expect(cx).toBeCloseTo(3, 2);
    expect(cy).toBeCloseTo(-2, 2);
    expect(r).toBeCloseTo(5, 2);
  });
});

describe('circumcenterFromPolyline — collinear points fallback to centroid', () => {
  it('returns centroid when 3 selected points are collinear (D ≈ 0)', () => {
    // All points on y=0; 6 points so mid index = Math.floor(6/2) = 3
    const pts: ReadonlyArray<readonly [number, number]> = [
      [0, 0], [2, 0], [4, 0], [6, 0], [8, 0], [10, 0],
    ];
    // The inline impl picks points[0], points[3], points[5] then computes centroid
    // pStart=[0,0], pMid=[6,0] (index 3), pEnd=[10,0]
    // centroid x = (0+6+10)/3, y = (0+0+0)/3
    const { cx, cy } = circumcenterFromPolyline(pts);
    const expectedCx = (0 + 6 + 10) / 3;
    const expectedCy = 0;
    expect(cx).toBeCloseTo(expectedCx, 9);
    expect(cy).toBeCloseTo(expectedCy, 9);
  });
});
