import type { SketchPrimitive } from '@zilventor/shared';
import { intersect } from './intersect';

export function offsetPrimitive(p: SketchPrimitive, d: number): SketchPrimitive | null {
  const id = `p-off-${Math.random().toString(36).slice(2, 8)}`;
  if (p.kind === 'line') {
    const dx = p.x2 - p.x1, dy = p.y2 - p.y1;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return null;
    const nx = -dy / len, ny = dx / len;
    return { id, kind: 'line', x1: p.x1 + nx * d, y1: p.y1 + ny * d, x2: p.x2 + nx * d, y2: p.y2 + ny * d };
  }
  if (p.kind === 'circle') {
    const r = p.r + d;
    if (r <= 1e-6) return null;
    return { id, kind: 'circle', cx: p.cx, cy: p.cy, r };
  }
  if (p.kind === 'arc') {
    const r = p.r + d;
    if (r <= 1e-6) return null;
    return { id, kind: 'arc', cx: p.cx, cy: p.cy, r, startAngle: p.startAngle, endAngle: p.endAngle };
  }
  if (p.kind === 'rectangle') {
    const nx = p.x - d, ny = p.y - d, nw = p.w + 2 * d, nh = p.h + 2 * d;
    if (nw <= 1e-6 || nh <= 1e-6) return null;
    return { id, kind: 'rectangle', x: nx, y: ny, w: nw, h: nh };
  }
  return null; // spline offset out of scope for slice 1
}

const CHAIN_TOL = 1e-3; // endpoint coincidence tolerance for chain detection

/** Point endpoint of a line (start or end). */
type Endpoint = { x: number; y: number };

function lineEndpoints(l: Extract<SketchPrimitive, { kind: 'line' }>): [Endpoint, Endpoint] {
  return [{ x: l.x1, y: l.y1 }, { x: l.x2, y: l.y2 }];
}

function epDist(a: Endpoint, b: Endpoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Walk all line primitives in `all` that form a connected chain starting
 * from `seed`. Returns the chain in connection order (includes seed).
 * Only lines are supported (arc/circle chain deferred to slice 3).
 */
export function findChain(seed: SketchPrimitive, all: SketchPrimitive[]): SketchPrimitive[] {
  if (seed.kind !== 'line') return [seed];
  const visited = new Set<string>([seed.id]);
  const chain: SketchPrimitive[] = [seed];

  // Grow forward from the last element in chain, then backward from the first.
  const grow = (fromPrim: Extract<SketchPrimitive, { kind: 'line' }>, appendFront: boolean): void => {
    const [ep0, ep1] = lineEndpoints(fromPrim);
    const searchEp = appendFront ? ep0 : ep1;
    for (const other of all) {
      if (visited.has(other.id) || other.kind !== 'line') continue;
      const [oa, ob] = lineEndpoints(other);
      if (epDist(searchEp, oa) < CHAIN_TOL || epDist(searchEp, ob) < CHAIN_TOL) {
        visited.add(other.id);
        if (appendFront) chain.unshift(other);
        else chain.push(other);
        grow(other, appendFront);
        break; // take first neighbor (chain, not tree)
      }
    }
  };

  if (seed.kind === 'line') {
    grow(seed, false); // forward
    grow(seed, true);  // backward
  }
  return chain;
}

/**
 * Offset an ordered chain of connected line segments by distance `d`, then
 * miter-join adjacent offset segments at their mutual intersection.
 * Returns the array of offset SketchPrimitives (same count as chain).
 *
 * If adjacent offset segments have no intersection (concave / degenerate corner),
 * the gap is left as-is (documented limitation — no self-intersection cleanup).
 */
export function offsetChain(chain: SketchPrimitive[], d: number): SketchPrimitive[] {
  if (chain.length === 0) return [];
  if (chain.length === 1) {
    const off = offsetPrimitive(chain[0]!, d);
    return off ? [off] : [];
  }

  // Offset each segment independently.
  const offsets = chain.map((p) => offsetPrimitive(p, d)).filter(Boolean) as SketchPrimitive[];
  if (offsets.length !== chain.length) return offsets; // degenerate

  // Miter-join adjacent pairs.
  for (let i = 0; i < offsets.length - 1; i++) {
    const a = offsets[i]!;
    const b = offsets[i + 1]!;
    if (a.kind !== 'line' || b.kind !== 'line') continue;

    // Extend both segments infinitely to find the miter point.
    const hits = intersect(a, b, false); // unbounded
    if (hits.length === 0) continue; // no miter (gap left)

    const miter = hits[0]!;
    // Update a's far endpoint (x2,y2) to miter point.
    offsets[i] = { ...a, x2: miter.x, y2: miter.y };
    // Update b's near endpoint (x1,y1) to miter point.
    offsets[i + 1] = { ...b, x1: miter.x, y1: miter.y };
  }

  return offsets;
}
