// packages/shared/src/drawing/clipEdgesToCircle.ts

import type { Edge2D } from './projectedGeometry';

export type Segment = {
  readonly p0: [number, number];
  readonly p1: [number, number];
};

/**
 * Clip a line segment [p0, p1] against a circle centered at `center`
 * with radius `radius`. Returns [] (clipped away) or [Segment] (surviving inside portion).
 * See spec §5.2 for the 8 cases.
 */
export function clipLineToCircle(
  p0: readonly [number, number],
  p1: readonly [number, number],
  center: { x: number; y: number },
  radius: number,
): Segment[] {
  // Translate to circle-centered space
  const ax = p0[0] - center.x;
  const ay = p0[1] - center.y;
  const bx = p1[0] - center.x;
  const by = p1[1] - center.y;

  // Direction vector (in original, non-translated space — used for final reconstruction)
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];

  // Quadratic coefficients: |P(t)|^2 = r^2
  const A = dx * dx + dy * dy;

  // Case 6: zero-length segment
  if (A < 1e-10) {
    return [];
  }

  const B = 2 * (ax * dx + ay * dy);
  const C = ax * ax + ay * ay - radius * radius;

  const disc = B * B - 4 * A * C;

  const r2 = radius * radius + 1e-9;
  const p0Inside = ax * ax + ay * ay <= r2;
  const p1Inside = bx * bx + by * by <= r2;

  if (disc < 0) {
    // No real intersection: fully inside or fully outside
    if (p0Inside && p1Inside) {
      return [{ p0: [p0[0], p0[1]], p1: [p1[0], p1[1]] }];
    }
    return [];
  }

  // Tangent or secant
  const sqrtDisc = Math.sqrt(Math.max(disc, 0));
  const t1 = (-B - sqrtDisc) / (2 * A);
  const t2 = (-B + sqrtDisc) / (2 * A);

  // Clamp intersection interval to segment [0, 1]
  const tEnter = Math.max(Math.min(t1, t2), 0.0);
  const tExit  = Math.min(Math.max(t1, t2), 1.0);

  // Degenerate: tangent (disc == 0) or zero-length interval after clamping
  if (tExit - tEnter < 1e-9) {
    return [];
  }

  // Intersection interval falls entirely outside [0,1]
  if (tExit < 0 || tEnter > 1) {
    return [];
  }

  const cp0: [number, number] = [p0[0] + tEnter * dx, p0[1] + tEnter * dy];
  const cp1: [number, number] = [p0[0] + tExit  * dx, p0[1] + tExit  * dy];
  return [{ p0: cp0, p1: cp1 }];
}

/**
 * Clip a polyline (array of [x,y] points) against a circle centered at `center`
 * with radius `radius`. Returns an array of Segments — zero or more surviving
 * sub-segments. Consecutive point pairs are each clipped independently via clipLineToCircle.
 */
export function clipPolylineToCircle(
  points: ReadonlyArray<readonly [number, number]>,
  center: { x: number; y: number },
  radius: number,
): Segment[] {
  if (points.length < 2) return [];
  const result: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const segs = clipLineToCircle(points[i]!, points[i + 1]!, center, radius);
    result.push(...segs);
  }
  return result;
}

/**
 * Clip an array of Edge2D against a circle in parent-local mm space.
 * Returns a new array of Edge2D with clipped points.
 * Each surviving clip segment becomes its own Edge2D, with id suffixed `_clip<i>`.
 * kind and sourceFaceIds are preserved from the source edge.
 */
export function clipEdgesToCircle(
  edges: readonly Edge2D[],
  center: { x: number; y: number },
  radius: number,
): Edge2D[] {
  const result: Edge2D[] = [];
  for (const edge of edges) {
    const segments = clipPolylineToCircle(edge.points, center, radius);
    for (let i = 0; i < segments.length; i++) {
      const clipped: Edge2D = {
        id: `${edge.id}_clip${i}`,
        kind: edge.kind,
        points: [segments[i]!.p0, segments[i]!.p1],
        ...(edge.sourceFaceIds !== undefined && { sourceFaceIds: edge.sourceFaceIds }),
      };
      result.push(clipped);
    }
  }
  return result;
}
