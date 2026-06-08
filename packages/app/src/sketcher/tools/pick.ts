import type { SketchPrimitive } from '@zilventor/shared';
import type { Point2 } from '../snap';

/** Body-distance threshold (world units) for a hit. */
const BODY_HIT_THRESHOLD = 5;

/**
 * Picks the closest primitive whose body is within BODY_HIT_THRESHOLD of `point`.
 * Only body-distance is checked (no endpoint picking). Returns null if nothing is close enough.
 */
export function pickPrimitiveAt(
  primitives: SketchPrimitive[],
  point: Point2,
): { primitiveId: string } | null {
  let best: { id: string; d: number } | null = null;

  for (const prim of primitives) {
    let bodyDist = Infinity;

    if (prim.kind === 'line') {
      bodyDist = distToSegment(point, { x: prim.x1, y: prim.y1 }, { x: prim.x2, y: prim.y2 });
    } else if (prim.kind === 'rectangle') {
      bodyDist = Math.min(
        distToSegment(point, { x: prim.x,          y: prim.y },          { x: prim.x + prim.w, y: prim.y }),
        distToSegment(point, { x: prim.x + prim.w, y: prim.y },          { x: prim.x + prim.w, y: prim.y + prim.h }),
        distToSegment(point, { x: prim.x + prim.w, y: prim.y + prim.h }, { x: prim.x,          y: prim.y + prim.h }),
        distToSegment(point, { x: prim.x,          y: prim.y + prim.h }, { x: prim.x,          y: prim.y }),
      );
    } else if (prim.kind === 'circle') {
      bodyDist = Math.abs(Math.hypot(point.x - prim.cx, point.y - prim.cy) - prim.r);
    } else if (prim.kind === 'arc') {
      bodyDist = Math.abs(Math.hypot(point.x - prim.cx, point.y - prim.cy) - prim.r);
    }
    // spline: bodyDist stays Infinity (no body-pick for splines)

    if (bodyDist < BODY_HIT_THRESHOLD && (!best || bodyDist < best.d)) {
      best = { id: prim.id, d: bodyDist };
    }
  }

  return best ? { primitiveId: best.id } : null;
}

export function distToSegment(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const vx = b.x - a.x, vy = b.y - a.y;
  const wx = p.x - a.x, wy = p.y - a.y;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const c2 = vx * vx + vy * vy;
  if (c1 >= c2) return Math.hypot(p.x - b.x, p.y - b.y);
  const t = c1 / c2;
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}
