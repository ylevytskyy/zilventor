import type { SketchPrimitive, SketchConstraint, DimensionConstraint, PointRef } from '@zilventor/shared';
import type { Point2 } from '../snap';
import { pickPrimitiveAt, distToSegment } from './pick';

// ConstraintTool only handles geometric constraints. Dimensional constraints
// have their own GeneralDimensionTool (Sub-project 2c Task 15).
type Kind = Exclude<SketchConstraint['kind'], DimensionConstraint['kind']>;
type CommitFn = (c: SketchConstraint) => void;

const arity: Record<Kind, 1 | 2 | 3> = {
  horizontal: 1, vertical: 1,
  parallel: 2, perpendicular: 2, tangent: 2, equal: 2,
  coincident: 2, symmetric: 3,
};

export class ConstraintTool {
  private picks: Array<{ primitiveId: string; point?: PointRef }> = [];
  private primitives: SketchPrimitive[] = [];

  constructor(private opts: { kind: Kind; onCommit: CommitFn }) {}

  setPrimitives(p: SketchPrimitive[]): void { this.primitives = p; }

  onEscapePressed(): void { this.picks = []; }

  async onPointerClick(p: Point2): Promise<void> {
    const hit = this.pickAt(p);
    if (!hit) return;
    this.picks.push(hit);
    if (this.picks.length >= arity[this.opts.kind]) {
      const c = this.build();
      this.picks = [];
      if (c) this.opts.onCommit(c);
    }
  }

  private pickAt(p: Point2): { primitiveId: string; point?: PointRef } | null {
    let bestEndpoint: { ref: PointRef; d2: number } | null = null;
    let bestPrimBody: { id: string; d2: number } | null = null;

    for (const prim of this.primitives) {
      const endpoints: Array<{ ref: PointRef; x: number; y: number }> = [];
      let bodyDist = Infinity;

      if (prim.kind === 'line') {
        endpoints.push({ ref: { primitiveId: prim.id, anchor: 'start' }, x: prim.x1, y: prim.y1 });
        endpoints.push({ ref: { primitiveId: prim.id, anchor: 'end' },   x: prim.x2, y: prim.y2 });
        bodyDist = distToSegment(p, { x: prim.x1, y: prim.y1 }, { x: prim.x2, y: prim.y2 });
      } else if (prim.kind === 'rectangle') {
        endpoints.push({ ref: { primitiveId: prim.id, anchor: 'bl' }, x: prim.x,          y: prim.y });
        endpoints.push({ ref: { primitiveId: prim.id, anchor: 'br' }, x: prim.x + prim.w, y: prim.y });
        endpoints.push({ ref: { primitiveId: prim.id, anchor: 'tr' }, x: prim.x + prim.w, y: prim.y + prim.h });
        endpoints.push({ ref: { primitiveId: prim.id, anchor: 'tl' }, x: prim.x,          y: prim.y + prim.h });
        bodyDist = Math.min(
          distToSegment(p, { x: prim.x,          y: prim.y },          { x: prim.x + prim.w, y: prim.y }),
          distToSegment(p, { x: prim.x + prim.w, y: prim.y },          { x: prim.x + prim.w, y: prim.y + prim.h }),
          distToSegment(p, { x: prim.x + prim.w, y: prim.y + prim.h }, { x: prim.x,          y: prim.y + prim.h }),
          distToSegment(p, { x: prim.x,          y: prim.y + prim.h }, { x: prim.x,          y: prim.y }),
        );
      } else if (prim.kind === 'circle') {
        endpoints.push({ ref: { primitiveId: prim.id, anchor: 'center' }, x: prim.cx, y: prim.cy });
        bodyDist = Math.abs(Math.hypot(p.x - prim.cx, p.y - prim.cy) - prim.r);
      } else if (prim.kind === 'arc') {
        endpoints.push({ ref: { primitiveId: prim.id, anchor: 'center' }, x: prim.cx, y: prim.cy });
        bodyDist = Math.abs(Math.hypot(p.x - prim.cx, p.y - prim.cy) - prim.r);
      } else if (prim.kind === 'spline') {
        for (let i = 0; i < prim.controlPoints.length; i++) {
          const cp = prim.controlPoints[i]!;
          endpoints.push({ ref: { primitiveId: prim.id, anchor: `cp${i}` as const }, x: cp.x, y: cp.y });
        }
        // No body-distance for splines in 2b — only control-point picking.
        // bodyDist stays Infinity (declared above), so no body-pick is emitted.
      }

      for (const e of endpoints) {
        const dx = e.x - p.x, dy = e.y - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 1 && (!bestEndpoint || d2 < bestEndpoint.d2)) {
          bestEndpoint = { ref: e.ref, d2 };
        }
      }
      if (bodyDist < 5 && (!bestPrimBody || bodyDist < bestPrimBody.d2)) {
        bestPrimBody = { id: prim.id, d2: bodyDist };
      }
    }

    if (bestEndpoint) return { primitiveId: bestEndpoint.ref.primitiveId, point: bestEndpoint.ref };
    if (bestPrimBody) return { primitiveId: bestPrimBody.id };
    return null;
  }

  private build(): SketchConstraint | null {
    const k = this.opts.kind;

    if ((k === 'horizontal' || k === 'vertical') && this.picks.length >= 1) {
      const id = `c-user-${k}-${this.picks[0]!.primitiveId}`;
      return { id, kind: k, line: this.picks[0]!.primitiveId, source: 'user' };
    }

    if ((k === 'parallel' || k === 'perpendicular') && this.picks.length >= 2) {
      const ids = [this.picks[0]!.primitiveId, this.picks[1]!.primitiveId].sort();
      const id = `c-user-${k}-${ids[0]}-${ids[1]}`;
      return { id, kind: k, line1: this.picks[0]!.primitiveId, line2: this.picks[1]!.primitiveId, source: 'user' };
    }

    if (k === 'tangent' && this.picks.length >= 2) {
      const id = `c-user-${k}-${this.picks[0]!.primitiveId}-${this.picks[1]!.primitiveId}`;
      return { id, kind: k, line: this.picks[0]!.primitiveId, arc: this.picks[1]!.primitiveId, source: 'user' };
    }

    if (k === 'equal' && this.picks.length >= 2) {
      const ids = [this.picks[0]!.primitiveId, this.picks[1]!.primitiveId].sort();
      const id = `c-user-${k}-${ids[0]}-${ids[1]}`;
      return { id, kind: k, a: this.picks[0]!.primitiveId, b: this.picks[1]!.primitiveId, source: 'user' };
    }

    if (k === 'coincident' && this.picks.length >= 2) {
      const a = this.picks[0]!.point ?? { primitiveId: this.picks[0]!.primitiveId, anchor: 'end' as const };
      const b = this.picks[1]!.point ?? { primitiveId: this.picks[1]!.primitiveId, anchor: 'start' as const };
      const sides = [`${a.primitiveId}-${a.anchor}`, `${b.primitiveId}-${b.anchor}`].sort();
      const id = `c-user-${k}-${sides[0]}-${sides[1]}`;
      return { id, kind: k, a, b, source: 'user' };
    }

    if (k === 'symmetric' && this.picks.length >= 3) {
      const a = this.picks[0]!.point ?? { primitiveId: this.picks[0]!.primitiveId, anchor: 'end' as const };
      const b = this.picks[1]!.point ?? { primitiveId: this.picks[1]!.primitiveId, anchor: 'start' as const };
      const id = `c-user-${k}-${a.primitiveId}-${a.anchor}-${b.primitiveId}-${b.anchor}-${this.picks[2]!.primitiveId}`;
      return { id, kind: k, a, b, axis: this.picks[2]!.primitiveId, source: 'user' };
    }

    return null;
  }
}

// distToSegment is imported from ./pick
