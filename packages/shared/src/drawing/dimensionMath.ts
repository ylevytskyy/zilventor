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

/**
 * Returns inside and outside subtended angles between two unit (or non-unit) direction vectors.
 * `insideRad` = acos(dot(d1, d2)) — always in [0, π].
 * `outsideRad` = 2π − insideRad.
 */
export function subtendedAngle(
  d1: Vec2D,
  d2: Vec2D,
): { readonly insideRad: number; readonly outsideRad: number } {
  const dot = d1.x * d2.x + d1.y * d2.y;
  const len1 = Math.sqrt(d1.x * d1.x + d1.y * d1.y);
  const len2 = Math.sqrt(d2.x * d2.x + d2.y * d2.y);
  const cosA = len1 * len2 > EPSILON ? dot / (len1 * len2) : 1;
  const insideRad = Math.acos(Math.max(-1, Math.min(1, cosA)));  // clamp against floating-point overshoot
  return { insideRad, outsideRad: 2 * Math.PI - insideRad };
}

/**
 * Converts radians to a human-readable degree string, e.g. "45°", "30.5°".
 * Trailing zeros after the decimal are trimmed. Maximum `decimals` digits (default 3).
 */
export function formatAngleDeg(rad: number, decimals = 3): string {
  const deg = rad * (180 / Math.PI);
  const formatted = deg.toFixed(decimals);
  // Remove trailing zeros and optional trailing dot
  const trimmed = formatted.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return `${trimmed}°`;
}
