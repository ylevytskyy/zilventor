import type { SketchPrimitive, PointRef } from '@zilventor/shared';
import type { DofStatus, PrimitiveCoordsDiff } from '@zilventor/sketcher-worker';
import type { SketcherClient } from '../SketcherClient';
import type { Point2 } from '../snap';

export type SelectToolDeps = {
  client: SketcherClient;
  onCoords(diff: PrimitiveCoordsDiff[]): void;
  onDof(dof: DofStatus): void;
};

export class SelectTool {
  private primitives: SketchPrimitive[] = [];
  private deps: SelectToolDeps | null = null;
  private dragging: { ref: PointRef } | null = null;

  setPrimitives(p: SketchPrimitive[]): void { this.primitives = p; }
  bind(d: SelectToolDeps): void { this.deps = d; }

  hitTest(p: Point2, tolerance: number): PointRef | null {
    const sq = tolerance * tolerance;
    let best: { ref: PointRef; d2: number } | null = null;
    for (const prim of this.primitives) {
      const candidates: Array<{ ref: PointRef; x: number; y: number }> = [];
      if (prim.kind === 'line') {
        candidates.push({ ref: { primitiveId: prim.id, anchor: 'start' }, x: prim.x1, y: prim.y1 });
        candidates.push({ ref: { primitiveId: prim.id, anchor: 'end' },   x: prim.x2, y: prim.y2 });
      } else if (prim.kind === 'rectangle') {
        candidates.push({ ref: { primitiveId: prim.id, anchor: 'bl' }, x: prim.x,         y: prim.y });
        candidates.push({ ref: { primitiveId: prim.id, anchor: 'br' }, x: prim.x + prim.w, y: prim.y });
        candidates.push({ ref: { primitiveId: prim.id, anchor: 'tr' }, x: prim.x + prim.w, y: prim.y + prim.h });
        candidates.push({ ref: { primitiveId: prim.id, anchor: 'tl' }, x: prim.x,         y: prim.y + prim.h });
      } else if (prim.kind === 'circle' || prim.kind === 'arc') {
        candidates.push({ ref: { primitiveId: prim.id, anchor: 'center' }, x: prim.cx, y: prim.cy });
      } else if (prim.kind === 'spline') {
        for (let i = 0; i < prim.controlPoints.length; i++) {
          const cp = prim.controlPoints[i]!;
          candidates.push({ ref: { primitiveId: prim.id, anchor: `cp${i}` as const }, x: cp.x, y: cp.y });
        }
      } else if (prim.kind === 'ellipse') {
        candidates.push({ ref: { primitiveId: prim.id, anchor: 'center' }, x: prim.cx, y: prim.cy });
      }
      // point: no constraint-snap endpoint in 4b (a point is not a dimensionable edge)
      for (const c of candidates) {
        const dx = c.x - p.x, dy = c.y - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= sq && (!best || d2 < best.d2)) best = { ref: c.ref, d2 };
      }
    }
    return best ? best.ref : null;
  }

  async onPointerDown(p: Point2, tolerance: number = 1): Promise<void> {
    if (!this.deps) return;
    const ref = this.hitTest(p, tolerance);
    if (!ref) return;
    this.dragging = { ref };
    await this.deps.client.beginDrag(ref);
  }

  async onPointerMove(p: Point2): Promise<void> {
    if (!this.deps || !this.dragging) return;
    const r = await this.deps.client.dragTo(p.x, p.y);
    this.deps.onCoords(r.coords);
    this.deps.onDof(r.dof);
  }

  async onPointerUp(): Promise<void> {
    if (!this.deps || !this.dragging) return;
    const r = await this.deps.client.endDrag();
    this.deps.onCoords(r.finalCoords);
    this.deps.onDof(r.dof);
    this.dragging = null;
  }
}
