// packages/shared/src/drawing/isArcEdge.ts
//
// Heuristic: detect whether a 2-D polyline represents a circular arc / full
// circle. Used by autoPlaceCenterMarks to identify holes and arcs in projected
// drawing views.

import { circumcenterFromPolyline } from './circumcenter';

export interface IsArcEdgeOptions {
  /** Minimum number of polyline points required to consider the edge as an arc. Default: 5 */
  minPoints: number;
  /** Maximum allowed residual fraction: |dist(p, center) - r| / r for each point. Default: 0.05 */
  maxResidualFraction: number;
  /** Minimum circumradius in mm; smaller arcs are ignored (noise / micro-chamfers). Default: 0.5 */
  minRadiusMm: number;
}

const DEFAULT_OPTIONS: IsArcEdgeOptions = {
  minPoints: 5,
  maxResidualFraction: 0.05,
  minRadiusMm: 0.5,
};

/**
 * Returns true when `points` looks like a circular arc or full circle:
 *   1. `points.length >= options.minPoints`
 *   2. The circumcircle radius >= `options.minRadiusMm`
 *   3. Every point lies within `options.maxResidualFraction * r` of the center
 */
export function isArcEdge(
  points: ReadonlyArray<readonly [number, number]>,
  options: Partial<IsArcEdgeOptions> = {},
): boolean {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (points.length < opts.minPoints) return false;

  const { cx, cy, r } = circumcenterFromPolyline(points);

  if (r < opts.minRadiusMm) return false;

  const maxResidual = opts.maxResidualFraction * r;
  for (const [px, py] of points) {
    const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
    if (Math.abs(dist - r) > maxResidual) return false;
  }

  return true;
}
