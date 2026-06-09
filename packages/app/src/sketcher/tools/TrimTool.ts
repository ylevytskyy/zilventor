import type { SketchPrimitive } from '@zilventor/shared';
import type { Point2 } from '../snap';
import { pickPrimitiveAt } from './pick';
import { intersect } from '../geometry/intersect';

export type TrimToolOpts = {
  addPrimitive(p: SketchPrimitive): void;
  deletePrimitive(id: string): void;
  updatePrimitive(id: string, patch: Partial<SketchPrimitive>): void;
};

export class TrimTool {
  private primitives: SketchPrimitive[] = [];

  constructor(private readonly opts: TrimToolOpts) {}

  setPrimitives(primitives: SketchPrimitive[]): void {
    this.primitives = primitives;
  }

  onPointerClick(pt: Point2): void {
    const hit = pickPrimitiveAt(this.primitives, pt);
    if (!hit) return;
    const target = this.primitives.find((p) => p.id === hit.primitiveId);
    if (!target) return;

    // full-circle trim deferred to slice 3 (needs circle→arc conversion)
    if (target.kind === 'circle') return;

    if (target.kind !== 'line' && target.kind !== 'arc') return;

    // Collect all intersections of target with every other primitive.
    const others = this.primitives.filter((p) => p.id !== target.id);
    type HitWithT = { tA: number; x: number; y: number };
    const crossings: HitWithT[] = [];
    for (const other of others) {
      const hits = intersect(target, other);
      for (const h of hits) crossings.push({ tA: h.tA, x: h.x, y: h.y });
    }

    if (target.kind === 'line') {
      this._trimLine(target, crossings, pt);
    } else if (target.kind === 'arc') {
      this._trimArc(target, crossings, pt);
    }
  }

  onEscapePressed(): void { /* TrimTool is stateless between clicks */ }

  private _trimLine(
    line: Extract<SketchPrimitive, { kind: 'line' }>,
    crossings: { tA: number; x: number; y: number }[],
    pt: Point2,
  ): void {
    // Parameter of the pick point along the line.
    const dx = line.x2 - line.x1, dy = line.y2 - line.y1;
    const len2 = dx * dx + dy * dy;
    const tPick = len2 < 1e-9 ? 0 : ((pt.x - line.x1) * dx + (pt.y - line.y1) * dy) / len2;

    // Build sorted breakpoints: 0 (start), sorted crossings, 1 (end).
    const breakTs = [0, ...crossings.map((c) => c.tA), 1].sort((a, b) => a - b);

    // Find the interval [u0, u1] that contains tPick.
    let u0 = 0, u1 = 1;
    for (let i = 0; i < breakTs.length - 1; i++) {
      if (tPick >= breakTs[i]! - 1e-6 && tPick <= breakTs[i + 1]! + 1e-6) {
        u0 = breakTs[i]!;
        u1 = breakTs[i + 1]!;
        break;
      }
    }

    const isStartBound = Math.abs(u0 - 0) < 1e-6;
    const isEndBound   = Math.abs(u1 - 1) < 1e-6;

    if (crossings.length === 0) {
      // No crossings — delete whole primitive.
      this.opts.deletePrimitive(line.id);
      return;
    }

    if (!isStartBound && !isEndBound) {
      // Interior interval — split into two remnants.
      const pt0 = { x: line.x1 + u0 * dx, y: line.y1 + u0 * dy };
      const pt1 = { x: line.x1 + u1 * dx, y: line.y1 + u1 * dy };
      this.opts.deletePrimitive(line.id);
      this.opts.addPrimitive({
        id: `p-tr-${crypto.randomUUID().slice(0, 8)}`,
        kind: 'line', x1: line.x1, y1: line.y1, x2: pt0.x, y2: pt0.y,
      });
      this.opts.addPrimitive({
        id: `p-tr-${crypto.randomUUID().slice(0, 8)}`,
        kind: 'line', x1: pt1.x, y1: pt1.y, x2: line.x2, y2: line.y2,
      });
    } else if (isStartBound) {
      // Trim the start endpoint — move x1,y1 to u1.
      const newPt = { x: line.x1 + u1 * dx, y: line.y1 + u1 * dy };
      this.opts.updatePrimitive(line.id, { x1: newPt.x, y1: newPt.y });
    } else {
      // Trim the end endpoint — move x2,y2 to u0.
      const newPt = { x: line.x1 + u0 * dx, y: line.y1 + u0 * dy };
      this.opts.updatePrimitive(line.id, { x2: newPt.x, y2: newPt.y });
    }
  }

  private _trimArc(
    arc: Extract<SketchPrimitive, { kind: 'arc' }>,
    crossings: { tA: number; x: number; y: number }[],
    pt: Point2,
  ): void {
    // IMPORTANT: tA from intersect() for arc targets is NORMALIZED to [0,1]
    // where 0=startAngle and 1=endAngle (see lineArcHits + swap in intersect.ts).
    // All interval logic here uses normalized t; convert back to real angles for patches.

    const span = arc.endAngle - arc.startAngle; // always > 0 by slice-1 invariant

    // Normalized pick parameter: project pick point angle onto [0,1].
    const pickAngle = Math.atan2(pt.y - arc.cy, pt.x - arc.cx);
    // Normalize pickAngle into [startAngle, endAngle] range, then to [0,1].
    let normAngle = pickAngle;
    while (normAngle < arc.startAngle - 1e-9) normAngle += 2 * Math.PI;
    while (normAngle > arc.endAngle + 1e-9) normAngle -= 2 * Math.PI;
    const tPick = span < 1e-9 ? 0 : (normAngle - arc.startAngle) / span;

    // Build sorted breakpoints in normalized [0,1] space.
    const breakTs = [0, ...crossings.map((c) => c.tA), 1].sort((a, b) => a - b);

    // Find the interval [u0, u1] containing tPick.
    let u0 = 0, u1 = 1;
    for (let i = 0; i < breakTs.length - 1; i++) {
      if (tPick >= breakTs[i]! - 1e-6 && tPick <= breakTs[i + 1]! + 1e-6) {
        u0 = breakTs[i]!;
        u1 = breakTs[i + 1]!;
        break;
      }
    }

    const isStartBound = Math.abs(u0 - 0) < 1e-6;
    const isEndBound   = Math.abs(u1 - 1) < 1e-6;

    if (crossings.length === 0) {
      this.opts.deletePrimitive(arc.id);
      return;
    }

    // Convert normalized breakpoints back to real angles.
    const toAngle = (t: number) => arc.startAngle + t * span;

    if (!isStartBound && !isEndBound) {
      // Interior interval — split arc into two remnant arcs (outer pieces).
      this.opts.deletePrimitive(arc.id);
      this.opts.addPrimitive({
        id: `p-tr-${crypto.randomUUID().slice(0, 8)}`,
        kind: 'arc', cx: arc.cx, cy: arc.cy, r: arc.r,
        startAngle: arc.startAngle, endAngle: toAngle(u0),
      });
      this.opts.addPrimitive({
        id: `p-tr-${crypto.randomUUID().slice(0, 8)}`,
        kind: 'arc', cx: arc.cx, cy: arc.cy, r: arc.r,
        startAngle: toAngle(u1), endAngle: arc.endAngle,
      });
    } else if (isStartBound) {
      // Trim the start — advance startAngle to u1.
      this.opts.updatePrimitive(arc.id, { startAngle: toAngle(u1) });
    } else {
      // Trim the end — retract endAngle to u0.
      this.opts.updatePrimitive(arc.id, { endAngle: toAngle(u0) });
    }
  }
}
