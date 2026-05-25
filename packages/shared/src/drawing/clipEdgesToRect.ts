// packages/shared/src/drawing/clipEdgesToRect.ts
//
// Liang–Barsky clip of line segments against an axis-aligned rectangle.
// Mirrors clipEdgesToCircle.ts in structure.

import type { Edge2D } from './projectedGeometry';
import type { Segment } from './clipEdgesToCircle';

export type { Segment };

type Rect = { center: { x: number; y: number }; widthMm: number; heightMm: number };

/**
 * Clip segment [p0, p1] against axis-aligned box
 * [cx − w/2, cx + w/2] × [cy − h/2, cy + h/2]
 * using the Liang–Barsky algorithm.
 * Returns [] (clipped away) or one surviving sub-segment.
 */
export function clipLineToRect(
  p0: readonly [number, number],
  p1: readonly [number, number],
  rect: Rect,
): Segment[] {
  const { center, widthMm, heightMm } = rect;
  const xMin = center.x - widthMm / 2;
  const xMax = center.x + widthMm / 2;
  const yMin = center.y - heightMm / 2;
  const yMax = center.y + heightMm / 2;

  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];

  // Guard: zero-length segment → always discard (no area contribution).
  // Mirrors clipLineToCircle's A < 1e-10 check.
  if (dx * dx + dy * dy < 1e-10) return [];

  // Liang–Barsky: maintain [tEnter, tExit] = [0, 1] and clip each boundary.
  // For each boundary: p*t + q >= 0 must hold for the segment to be inside.
  // p[k] = direction component (may be zero for axis-aligned segments).
  // q[k] = signed distance from start point to the boundary.
  // Boundaries: left (xMin), right (xMax), bottom (yMin), top (yMax).
  const p: readonly number[] = [-dx, dx, -dy, dy];
  const q: readonly number[] = [
    p0[0] - xMin,   // left:   p0.x - xMin >= 0 means p0 is right of left edge
    xMax - p0[0],   // right:  xMax - p0.x >= 0 means p0 is left of right edge
    p0[1] - yMin,   // bottom: p0.y - yMin >= 0 means p0 is above bottom edge
    yMax - p0[1],   // top:    yMax - p0.y >= 0 means p0 is below top edge
  ];

  let tEnter = 0.0;
  let tExit  = 1.0;

  for (let i = 0; i < 4; i++) {
    const pi = p[i]!;
    const qi = q[i]!;

    if (Math.abs(pi) < 1e-12) {
      // Segment is parallel to this boundary.
      // If q[i] < 0 the segment is entirely outside — reject.
      if (qi < 0) return [];
      // Otherwise parallel and inside this boundary — no clip needed.
    } else {
      const t = qi / pi;
      if (pi < 0) {
        // p[i] < 0: segment travels from inside to outside → t is an entry bound.
        if (t > tEnter) tEnter = t;
      } else {
        // p[i] > 0: segment travels from outside to inside → t is an exit bound.
        if (t < tExit) tExit = t;
      }
    }
  }

  if (tEnter > tExit + 1e-9) return []; // missed the box
  if (tExit - tEnter < 1e-9) return [];  // zero-length interval — tangent/corner-touch, discard

  const cp0: [number, number] = [p0[0] + tEnter * dx, p0[1] + tEnter * dy];
  const cp1: [number, number] = [p0[0] + tExit  * dx, p0[1] + tExit  * dy];
  return [{ p0: cp0, p1: cp1 }];
}

/**
 * Clip a polyline (array of [x,y] points) against an axis-aligned rect.
 * Returns zero or more Segments — one per consecutive pair that survives.
 */
export function clipPolylineToRect(
  points: ReadonlyArray<readonly [number, number]>,
  rect: Rect,
): Segment[] {
  if (points.length < 2) return [];
  const result: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const segs = clipLineToRect(points[i]!, points[i + 1]!, rect);
    result.push(...segs);
  }
  return result;
}

/**
 * Clip an array of Edge2D against an axis-aligned rect in parent-local mm space.
 * Mirrors clipEdgesToCircle: preserves id/kind, conditional-spreads sourceFaceIds
 * (exactOptionalPropertyTypes), suffixes survivors _clip0/_clip1/…
 */
export function clipEdgesToRect(
  edges: readonly Edge2D[],
  rect: Rect,
): Edge2D[] {
  const result: Edge2D[] = [];
  for (const edge of edges) {
    const segments = clipPolylineToRect(edge.points, rect);
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
