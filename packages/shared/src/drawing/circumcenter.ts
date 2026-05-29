// packages/shared/src/drawing/circumcenter.ts
//
// Shared circumcenter utility used by radial/diametric dimensions and the
// angular:arc dimension renderer. Ported from the inline circumcenterX/Y helpers
// in renderDrawingSvg.ts and DimensionElement.tsx (identical math preserved).

/**
 * Estimate the circumcircle (center + radius) of a polyline by sampling three
 * representative points: the first, the midpoint, and the last.
 *
 * Collinear fallback: when |D| < 1e-12, returns the centroid of the three
 * sampled points with r = distance from centroid to first sampled point (may
 * be near-zero for nearly-collinear inputs).
 */
export function circumcenterFromPolyline(
  points: ReadonlyArray<readonly [number, number]>,
): { cx: number; cy: number; r: number } {
  if (points.length === 0) return { cx: 0, cy: 0, r: 0 };

  const pStart = points[0]!;
  const pEnd   = points[points.length - 1]!;
  const pMid   = points[Math.floor(points.length / 2)]!;

  const ax = pStart[0], ay = pStart[1];
  const bx = pMid[0],   by = pMid[1];
  const cx = pEnd[0],   cy = pEnd[1];

  const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));

  let ccx: number;
  let ccy: number;

  if (Math.abs(D) < 1e-12) {
    // Collinear fallback: centroid of the three sampled points
    ccx = (ax + bx + cx) / 3;
    ccy = (ay + by + cy) / 3;
  } else {
    const a2 = ax * ax + ay * ay;
    const b2 = bx * bx + by * by;
    const c2 = cx * cx + cy * cy;
    ccx = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / D;
    ccy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / D;
  }

  const r = Math.sqrt((pStart[0] - ccx) ** 2 + (pStart[1] - ccy) ** 2);
  return { cx: ccx, cy: ccy, r };
}
