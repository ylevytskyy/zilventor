// packages/shared/src/drawing/dimensionMath.ts

export type Point2 = { readonly x: number; readonly y: number };
export type Vec2D  = { readonly x: number; readonly y: number };

const EPSILON = 1e-10;

/**
 * Computes the intersection of two infinite lines defined by two points each.
 * Returns null when the lines are parallel or collinear (determinant ≈ 0).
 */
export function intersectLines(
  line1: { readonly p0: Point2; readonly p1: Point2 },
  line2: { readonly p0: Point2; readonly p1: Point2 },
): Point2 | null {
  const dx1 = line1.p1.x - line1.p0.x;
  const dy1 = line1.p1.y - line1.p0.y;
  const dx2 = line2.p1.x - line2.p0.x;
  const dy2 = line2.p1.y - line2.p0.y;

  const det = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(det) < EPSILON) return null;   // parallel or collinear

  const diffX = line2.p0.x - line1.p0.x;
  const diffY = line2.p0.y - line1.p0.y;
  const t = (diffX * dy2 - diffY * dx2) / det;

  return {
    x: line1.p0.x + t * dx1,
    y: line1.p0.y + t * dy1,
  };
}
