import type { SketchPrimitive } from '@zilventor/shared';

/**
 * A point of intersection between two primitives.
 * tA = parameter along primitive A:
 *   - line: fractional [0,1] along the segment.
 *   - arc (as A): normalized fractional [0,1] within [startAngle, endAngle] (0=start, 1=end).
 *   - circle (as A): raw atan2 angle (not normalized; callers rarely need circle-as-A).
 * tB = parameter along primitive B (same convention, from B's perspective).
 * The swap() helper exchanges tA↔tB so callers always get tA relative to their target primitive.
 */
export type Hit = { x: number; y: number; tA: number; tB: number };

const EPS = 1e-9;

/**
 * Compute all intersections between two SketchPrimitives.
 * Covered: line-line, line-circle, line-arc (and symmetric cases).
 * arc-arc and circle-circle are deferred (slice 3).
 *
 * For lines: tA/tB ∈ [0,1] means within the segment; callers can pass
 * `clampToSegment = false` to get unbounded t (used by ExtendTool ray queries).
 */
export function intersect(
  a: SketchPrimitive,
  b: SketchPrimitive,
  clampToSegment = true,
): Hit[] {
  if (a.kind === 'line' && b.kind === 'line') return lineLineHits(a, b, clampToSegment);
  if (a.kind === 'line' && b.kind === 'circle') return lineCircleHits(a, b, clampToSegment);
  if (a.kind === 'circle' && b.kind === 'line') return lineCircleHits(b, a, clampToSegment).map(swap);
  if (a.kind === 'line' && b.kind === 'arc') return lineArcHits(a, b, clampToSegment);
  if (a.kind === 'arc' && b.kind === 'line') return lineArcHits(b, a, clampToSegment).map(swap);
  // circle-arc, arc-arc, circle-circle: deferred
  return [];
}

function swap(h: Hit): Hit {
  return { x: h.x, y: h.y, tA: h.tB, tB: h.tA };
}

function lineLineHits(
  a: Extract<SketchPrimitive, { kind: 'line' }>,
  b: Extract<SketchPrimitive, { kind: 'line' }>,
  clampToSegment: boolean,
): Hit[] {
  const dx1 = a.x2 - a.x1, dy1 = a.y2 - a.y1;
  const dx2 = b.x2 - b.x1, dy2 = b.y2 - b.y1;
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < EPS) return []; // parallel

  const dx = b.x1 - a.x1, dy = b.y1 - a.y1;
  const tA = (dx * dy2 - dy * dx2) / denom;
  const tB = (dx * dy1 - dy * dx1) / denom;

  if (clampToSegment && (tA < -EPS || tA > 1 + EPS || tB < -EPS || tB > 1 + EPS)) return [];

  const x = a.x1 + tA * dx1;
  const y = a.y1 + tA * dy1;
  return [{ x, y, tA, tB }];
}

function lineCircleHits(
  line: Extract<SketchPrimitive, { kind: 'line' }>,
  circle: Extract<SketchPrimitive, { kind: 'circle' }>,
  clampToSegment: boolean,
): Hit[] {
  const dx = line.x2 - line.x1, dy = line.y2 - line.y1;
  const fx = line.x1 - circle.cx, fy = line.y1 - circle.cy;

  const A = dx * dx + dy * dy;
  if (A < EPS) return [];
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - circle.r * circle.r;

  const disc = B * B - 4 * A * C;
  if (disc < -EPS * EPS) return [];

  const hits: Hit[] = [];
  // Tangent case: discriminant ≈ 0 → one unique root; avoid emitting the same
  // point twice by treating disc=0 as a single-root case.
  const sqrtDisc = Math.sqrt(Math.max(0, disc));
  const signs: readonly (1 | -1)[] = disc < EPS * EPS ? [1] : [-1, 1];
  for (const sign of signs) {
    const tA = (-B + sign * sqrtDisc) / (2 * A);
    if (clampToSegment && (tA < -EPS || tA > 1 + EPS)) continue;
    const x = line.x1 + tA * dx;
    const y = line.y1 + tA * dy;
    const tB = Math.atan2(y - circle.cy, x - circle.cx); // angle on circle
    hits.push({ x, y, tA, tB });
  }
  return hits;
}

function lineArcHits(
  line: Extract<SketchPrimitive, { kind: 'line' }>,
  arc: Extract<SketchPrimitive, { kind: 'arc' }>,
  clampToSegment: boolean,
): Hit[] {
  // Re-use line-circle math, then filter by arc angular range.
  const circleHits = lineCircleHits(
    line,
    { id: arc.id, kind: 'circle', cx: arc.cx, cy: arc.cy, r: arc.r },
    clampToSegment,
  );

  const result: Hit[] = [];
  for (const h of circleHits) {
    const rawAngle = h.tB; // atan2 result ∈ (-π, π]
    // shiftedAngle is rawAngle adjusted by ±2π multiples so it falls in
    // [startAngle, endAngle].  Use the SAME shifted value for both the
    // range-check and the tB normalization to avoid the ±π discontinuity bug.
    const shiftedAngle = shiftAngleIntoRange(rawAngle, arc.startAngle, arc.endAngle);
    if (shiftedAngle < arc.startAngle - EPS || shiftedAngle > arc.endAngle + EPS) continue;
    result.push({
      ...h,
      // Normalize tB: fractional position within [startAngle, endAngle].
      tB: (shiftedAngle - arc.startAngle) / (arc.endAngle - arc.startAngle),
    });
  }
  return result;
}

/**
 * Shift `angle` (atan2 output ∈ (-π, π]) by ±2π multiples until it is as
 * close to [start, end] as possible.  Returns the shifted value; callers can
 * then range-check it against [start, end] AND use it for normalization so
 * both operations use the same (consistent) shifted angle.
 */
function shiftAngleIntoRange(angle: number, start: number, end: number): number {
  let a = angle;
  while (a < start - EPS) a += 2 * Math.PI;
  while (a > end + EPS) a -= 2 * Math.PI;
  return a;
}
