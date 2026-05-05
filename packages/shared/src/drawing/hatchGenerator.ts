import type { Vec2 } from './types';
import type { HatchSegment } from './types';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const CLIP_EPS = 1e-9; // mm — tolerance for parallel-edge classification

function sub2(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

function lerp2(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}

// ---------------------------------------------------------------------------
// Task 10 — Sutherland-Hodgman line vs convex polygon clip (Liang-Barsky style)
//
// For each directed edge (A→B) of the polygon we treat the inside as the
// left half-plane.  We track tMin (entry t) and tMax (exit t) along the
// ray from p0 to p1.  If tMin > tMax the line misses the polygon.
// ---------------------------------------------------------------------------

export function clipLineToConvexPolygon(
  line: { p0: Vec2; p1: Vec2 },
  polygon: Vec2[],
): { p0: Vec2; p1: Vec2 } | null {
  const d = sub2(line.p1, line.p0); // direction vector
  let tMin = 0;
  let tMax = 1;

  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const edgeA = polygon[i]!;
    const edgeB = polygon[(i + 1) % n]!;

    // Inward normal for CCW polygon: rotate edge direction 90° left
    const ex = edgeB.x - edgeA.x;
    const ey = edgeB.y - edgeA.y;
    const nx = -ey;
    const ny = ex;

    // signed distance from p0 to edge plane, and projection of d
    const num = nx * (line.p0.x - edgeA.x) + ny * (line.p0.y - edgeA.y);
    const den = nx * d.x + ny * d.y;

    if (Math.abs(den) < CLIP_EPS) {
      // Line is parallel to this edge
      if (num < -CLIP_EPS) return null; // outside half-plane entirely
      // otherwise inside — skip
    } else {
      const t = -num / den;
      if (den > 0) {
        // ray moving into inside half-plane → entry
        if (t > tMin) tMin = t;
      } else {
        // ray moving out of inside half-plane → exit
        if (t < tMax) tMax = t;
      }
    }

    if (tMin > tMax + CLIP_EPS) return null;
  }

  // Degenerate: segment length below tolerance
  if (tMax - tMin < CLIP_EPS) return null;

  return {
    p0: lerp2(line.p0, line.p1, tMin),
    p1: lerp2(line.p0, line.p1, tMax),
  };
}

// ---------------------------------------------------------------------------
// Task 11 — Ear-clipping triangulation
// ---------------------------------------------------------------------------

export type Triangle = [Vec2, Vec2, Vec2];

/** Check if point P is inside triangle ABC (CCW). */
function pointInTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const d1 = (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
  const d2 = (p.x - c.x) * (b.y - c.y) - (b.x - c.x) * (p.y - c.y);
  const d3 = (p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/** Detect self-intersection (O(n²) check; adequate for ≤200-vertex faces). */
function isSelfIntersecting(poly: Vec2[]): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!, b = poly[(i + 1) % n]!;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // shared endpoint
      const c = poly[j]!, d = poly[(j + 1) % n]!;
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

function cross2(o: Vec2, a: Vec2, b: Vec2): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = cross2(c, d, a);
  const d2 = cross2(c, d, b);
  const d3 = cross2(a, b, c);
  const d4 = cross2(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return false;
}

/** Ensure polygon winding is CCW; reverse in-place if CW. */
function ensureCCW(poly: Vec2[]): Vec2[] {
  const area = poly.reduce((acc, v, i) => {
    const next = poly[(i + 1) % poly.length]!;
    return acc + (v.x * next.y - next.x * v.y);
  }, 0);
  return area < 0 ? [...poly].reverse() : poly;
}

export function triangulatePolygon(polygon: Vec2[]): Triangle[] {
  if (isSelfIntersecting(polygon)) throw new Error('non-simple polygon');

  const verts = ensureCCW([...polygon]);
  const n = verts.length;

  // Fast-path: convex polygon → fan triangulation
  const isConvex = verts.every((_, i) =>
    cross2(verts[i]!, verts[(i + 1) % n]!, verts[(i + 2) % n]!) >= 0,
  );
  if (isConvex) {
    const result: Triangle[] = [];
    for (let i = 1; i < n - 1; i++) {
      result.push([verts[0]!, verts[i]!, verts[i + 1]!]);
    }
    return result;
  }

  // Ear-clipping
  const indices = Array.from({ length: n }, (_, i) => i);
  const result: Triangle[] = [];

  let iterations = 0;
  const maxIter = n * n;

  while (indices.length > 3 && iterations++ < maxIter) {
    let earFound = false;
    for (let i = 0; i < indices.length; i++) {
      const prev = indices[(i - 1 + indices.length) % indices.length]!;
      const curr = indices[i]!;
      const next = indices[(i + 1) % indices.length]!;
      const a = verts[prev]!, b = verts[curr]!, c = verts[next]!;

      // Must be convex vertex
      if (cross2(a, b, c) < CLIP_EPS) continue;

      // No other vertex inside this ear triangle
      // (also skip vertices coincident with a/b/c — happens after bridge insertion)
      const empty = indices.every(idx => {
        if (idx === prev || idx === curr || idx === next) return true;
        const v = verts[idx]!;
        if ((v.x === a.x && v.y === a.y) ||
            (v.x === b.x && v.y === b.y) ||
            (v.x === c.x && v.y === c.y)) return true;
        return !pointInTriangle(v, a, b, c);
      });

      if (empty) {
        result.push([a, b, c]);
        indices.splice(i, 1);
        earFound = true;
        break;
      }
    }
    if (!earFound) break; // degenerate; stop gracefully
  }

  if (indices.length === 3) {
    const i0 = indices[0]!;
    const i1 = indices[1]!;
    const i2 = indices[2]!;
    result.push([verts[i0]!, verts[i1]!, verts[i2]!]);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Polygon-with-holes: bridge connecting outer ring to each hole
//
// Simple bridge algorithm: for each hole, find the rightmost hole vertex and
// connect it to the nearest mutually-visible outer vertex, then flatten into
// one polygon.
// ---------------------------------------------------------------------------

export function triangulatePolygonWithHoles(
  outer: Vec2[],
  holes: Vec2[][],
): Triangle[] {
  // Ensure outer is CCW, holes are CW (reverse them)
  let merged = ensureCCW([...outer]);

  for (const rawHole of holes) {
    // Holes must be CW; ensureCCW returns CCW — so reverse for hole
    const hole = ensureCCW([...rawHole]).reverse();

    // Find rightmost vertex of hole
    const rightIdx = hole.reduce(
      (best, v, i) => (v.x > hole[best]!.x ? i : best),
      0,
    );
    const holeV = hole[rightIdx]!;

    // Find nearest visible outer vertex (simple: pick closest by x, then distance)
    let bestOuter = 0;
    let bestDist = Infinity;
    for (let i = 0; i < merged.length; i++) {
      const mv = merged[i]!;
      if (mv.x >= holeV.x) {
        const dx = mv.x - holeV.x;
        const dy = mv.y - holeV.y;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) { bestDist = dist; bestOuter = i; }
      }
    }

    // Bridge: insert hole into outer polygon
    const holeReordered: Vec2[] = [
      ...hole.slice(rightIdx),
      ...hole.slice(0, rightIdx + 1),
    ];
    const bridgeVertex = merged[bestOuter]!;
    merged = [
      ...merged.slice(0, bestOuter + 1),
      ...holeReordered,
      bridgeVertex,
      ...merged.slice(bestOuter + 1),
    ];
  }

  return triangulatePolygon(merged);
}

// ---------------------------------------------------------------------------
// Task 12 — Per-material hatch generation
// ---------------------------------------------------------------------------

// Rotate a Vec2 around origin by angleDeg
function rotate2(v: Vec2, angleDeg: number): Vec2 {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}

function rotatePoly(poly: Vec2[], angleDeg: number): Vec2[] {
  return poly.map(v => rotate2(v, angleDeg));
}

function bboxOf(poly: Vec2[]): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const v of poly) {
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  }
  return { minX, maxX, minY, maxY };
}

const MERGE_EPS = 1e-6; // mm

/** Merge overlapping/adjacent 1-D segments on a single scan line. */
function mergeIntervals(intervals: [number, number][]): [number, number][] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [[sorted[0]![0], sorted[0]![1]]];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const last = merged[merged.length - 1]!;
    if (cur[0] <= last[1] + MERGE_EPS) {
      last[1] = Math.max(last[1], cur[1]);
    } else {
      merged.push([cur[0], cur[1]]);
    }
  }
  return merged;
}

export function generateHatchSegments(
  polygon: Vec2[],
  materialId: string,
  hatchSpec: { angleDeg: number; spacingMm: number },
): HatchSegment[] {
  if (polygon.length < 3) return [];

  const { angleDeg, spacingMm } = hatchSpec;

  // Rotate polygon so hatch lines become horizontal (scan in Y)
  const rotPoly = rotatePoly(polygon, -angleDeg);
  const bbox = bboxOf(rotPoly);

  // Triangulate rotated polygon
  let tris: Triangle[];
  try {
    tris = triangulatePolygon(rotPoly);
  } catch {
    return []; // non-simple polygon; skip gracefully
  }

  const result: HatchSegment[] = [];

  // Generate scan lines
  const yStart = Math.ceil(bbox.minY / spacingMm) * spacingMm;
  for (let y = yStart; y <= bbox.maxY + MERGE_EPS; y += spacingMm) {
    const intervals: [number, number][] = [];

    for (const [a, b, c] of tris) {
      // Intersect horizontal line y = y with triangle edges
      const edges: [Vec2, Vec2][] = [[a, b], [b, c], [c, a]];
      const xs: number[] = [];
      for (const [p, q] of edges) {
        const dy = q.y - p.y;
        if (Math.abs(dy) < CLIP_EPS) continue;
        const t = (y - p.y) / dy;
        if (t < -CLIP_EPS || t > 1 + CLIP_EPS) continue;
        xs.push(p.x + t * (q.x - p.x));
      }
      if (xs.length === 2) {
        const xa = xs[0] as number;
        const xb = xs[1] as number;
        const x0 = xa < xb ? xa : xb;
        const x1 = xa < xb ? xb : xa;
        if (x1 - x0 > MERGE_EPS) intervals.push([x0, x1]);
      }
    }

    const merged = mergeIntervals(intervals);
    for (const [x0, x1] of merged) {
      // Rotate segment back by +angleDeg
      const rawP0 = rotate2({ x: x0, y }, angleDeg);
      const rawP1 = rotate2({ x: x1, y }, angleDeg);
      result.push({ p0: rawP0, p1: rawP1, materialId });
    }
  }

  return result;
}
