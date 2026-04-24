import type { SketchPrimitive, DimensionConstraint, PointRef } from '@zilventor/shared';
import type { Point2 } from '../snap';

type Pick =
  | { kind: 'line'; id: string }
  | { kind: 'circle'; id: string }
  | { kind: 'point'; ref: PointRef };

type Opts = {
  onDimensionReady(d: DimensionConstraint): void;
};

let seq = 0;
const nextDimId = (): string => { seq += 1; return `c-dim-${Date.now().toString(36)}-${seq.toString(36)}`; };
let paramSeq = 0;
const nextParamName = (): string => { paramSeq += 1; return `d${paramSeq - 1}`; };

export class GeneralDimensionTool {
  private primitives: SketchPrimitive[] = [];
  private picks: Pick[] = [];
  private lastCircleId: string | null = null;

  constructor(private opts: Opts) {}

  setPrimitives(p: SketchPrimitive[]): void { this.primitives = p; }

  onEscapePressed(): void { this.picks = []; this.lastCircleId = null; }

  async onPointerClick(p: Point2): Promise<void> {
    const hit = this.hitTest(p);
    if (!hit) return;

    if (hit.kind === 'circle' && hit.id === this.lastCircleId) {
      const diameter: DimensionConstraint = {
        id: nextDimId(), kind: 'dim-diameter', paramName: nextParamName(),
        circle: hit.id, value: { kind: 'literal', value: currentDiameter(this.primitives, hit.id) },
        source: 'user'
      };
      this.opts.onDimensionReady(diameter);
      this.picks = [];
      this.lastCircleId = null;
      return;
    }

    this.picks.push(hit);
    const maybe = this.infer();
    if (maybe) {
      this.opts.onDimensionReady(maybe);
      this.lastCircleId = maybe.kind === 'dim-radius' ? (hit.kind === 'circle' ? hit.id : null) : null;
      // After a single-line dim-length, carry the pick forward so the next
      // line click can accumulate two picks and produce dim-angle.
      if (maybe.kind === 'dim-length') {
        this.picks = [hit];
      } else {
        this.picks = [];
      }
    }
  }

  private hitTest(p: Point2): Pick | null {
    let bestPoint: { ref: PointRef; d2: number } | null = null;
    let bestLine: { id: string; d2: number } | null = null;
    let bestCircle: { id: string; d2: number } | null = null;
    for (const prim of this.primitives) {
      if (prim.kind === 'line') {
        const eps: Array<{ ref: PointRef; x: number; y: number }> = [
          { ref: { primitiveId: prim.id, anchor: 'start' }, x: prim.x1, y: prim.y1 },
          { ref: { primitiveId: prim.id, anchor: 'end'   }, x: prim.x2, y: prim.y2 }
        ];
        for (const e of eps) {
          const d2 = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
          if (d2 < 1 && (!bestPoint || d2 < bestPoint.d2)) bestPoint = { ref: e.ref, d2 };
        }
        const bodyDist = distToSegment(p, { x: prim.x1, y: prim.y1 }, { x: prim.x2, y: prim.y2 });
        if (bodyDist < 5 && (!bestLine || bodyDist < bestLine.d2)) bestLine = { id: prim.id, d2: bodyDist };
      }
      if (prim.kind === 'circle') {
        const rim = Math.abs(Math.hypot(p.x - prim.cx, p.y - prim.cy) - prim.r);
        if (rim < 5 && (!bestCircle || rim < bestCircle.d2)) bestCircle = { id: prim.id, d2: rim };
      }
    }
    if (bestPoint) return { kind: 'point', ref: bestPoint.ref };
    if (bestLine)  return { kind: 'line',  id: bestLine.id };
    if (bestCircle) return { kind: 'circle', id: bestCircle.id };
    return null;
  }

  private infer(): DimensionConstraint | null {
    const p = this.picks;
    if (p.length === 1 && p[0]!.kind === 'line') {
      const id = p[0]!.id; const lp = this.primitives.find((x) => x.id === id);
      if (!lp || lp.kind !== 'line') return null;
      const v = Math.hypot(lp.x2 - lp.x1, lp.y2 - lp.y1);
      return { id: nextDimId(), kind: 'dim-length', paramName: nextParamName(), line: id, value: { kind: 'literal', value: v }, source: 'user' };
    }
    if (p.length === 1 && p[0]!.kind === 'circle') {
      return { id: nextDimId(), kind: 'dim-radius', paramName: nextParamName(), circle: p[0]!.id, value: { kind: 'literal', value: currentRadius(this.primitives, p[0]!.id) }, source: 'user' };
    }
    if (p.length === 2 && p[0]!.kind === 'point' && p[1]!.kind === 'point') {
      const a = p[0]!.ref, b = p[1]!.ref;
      const v = currentDistance(this.primitives, a, b);
      return { id: nextDimId(), kind: 'dim-distance', paramName: nextParamName(), a, b, value: { kind: 'literal', value: v }, source: 'user' };
    }
    if (p.length === 2 && p[0]!.kind === 'line' && p[1]!.kind === 'line') {
      return { id: nextDimId(), kind: 'dim-angle', paramName: nextParamName(), line1: p[0]!.id, line2: p[1]!.id, value: { kind: 'literal', value: 90 }, source: 'user' };
    }
    if (p.length === 2 && p[0]!.kind === 'point' && p[1]!.kind === 'line') {
      return { id: nextDimId(), kind: 'dim-point-line-distance', paramName: nextParamName(), point: p[0]!.ref, line: p[1]!.id, value: { kind: 'literal', value: 0 }, source: 'user' };
    }
    if (p.length === 2 && p[0]!.kind === 'line' && p[1]!.kind === 'point') {
      return { id: nextDimId(), kind: 'dim-point-line-distance', paramName: nextParamName(), point: p[1]!.ref, line: p[0]!.id, value: { kind: 'literal', value: 0 }, source: 'user' };
    }
    return null;
  }
}

function distToSegment(p: Point2, a: Point2, b: Point2): number {
  const vx = b.x - a.x, vy = b.y - a.y;
  const wx = p.x - a.x, wy = p.y - a.y;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return Math.hypot(wx, wy);
  const c2 = vx * vx + vy * vy;
  if (c1 >= c2) return Math.hypot(p.x - b.x, p.y - b.y);
  const t = c1 / c2;
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

function currentRadius(primitives: SketchPrimitive[], id: string): number {
  const p = primitives.find((x) => x.id === id);
  return p && (p.kind === 'circle' || p.kind === 'arc') ? p.r : 0;
}

function currentDiameter(primitives: SketchPrimitive[], id: string): number {
  return 2 * currentRadius(primitives, id);
}

function currentDistance(primitives: SketchPrimitive[], a: PointRef, b: PointRef): number {
  const pt = (ref: PointRef): Point2 | null => {
    const p = primitives.find((x) => x.id === ref.primitiveId);
    if (!p) return null;
    if (p.kind === 'line') return ref.anchor === 'start' ? { x: p.x1, y: p.y1 } : { x: p.x2, y: p.y2 };
    return null;
  };
  const pa = pt(a); const pb = pt(b);
  if (!pa || !pb) return 0;
  return Math.hypot(pa.x - pb.x, pa.y - pb.y);
}
