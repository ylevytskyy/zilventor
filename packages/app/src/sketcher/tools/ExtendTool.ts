import type { SketchPrimitive } from '@zilventor/shared';
import type { Point2 } from '../snap';
import { pickPrimitiveAt } from './pick';
import { intersect } from '../geometry/intersect';

export type ExtendToolOpts = {
  updatePrimitive(id: string, patch: Partial<SketchPrimitive>): void;
};

export class ExtendTool {
  private primitives: SketchPrimitive[] = [];

  constructor(private readonly opts: ExtendToolOpts) {}

  setPrimitives(primitives: SketchPrimitive[]): void {
    this.primitives = primitives;
  }

  onPointerClick(pt: Point2): void {
    const hit = pickPrimitiveAt(this.primitives, pt);
    if (!hit) return;
    const target = this.primitives.find((p) => p.id === hit.primitiveId);
    if (!target) return;
    if (target.kind !== 'line' && target.kind !== 'arc') return;

    if (target.kind === 'line') {
      this._extendLine(target, pt);
    }
    // Arc extend: continue CCW/CW from the near endpoint — implementer should
    // follow the same pattern as _extendLine using angular parameters.
  }

  onEscapePressed(): void { /* stateless */ }

  private _extendLine(
    line: Extract<SketchPrimitive, { kind: 'line' }>,
    pt: Point2,
  ): void {
    const dx = line.x2 - line.x1, dy = line.y2 - line.y1;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return;

    // Determine the near endpoint (start or end) by distance to pick point.
    const dStart = Math.hypot(pt.x - line.x1, pt.y - line.y1);
    const dEnd   = Math.hypot(pt.x - line.x2, pt.y - line.y2);
    const nearEnd: 'start' | 'end' = dStart < dEnd ? 'start' : 'end';

    // Build a ray: origin = near endpoint, direction = toward or away from the far end.
    // For 'end': direction = (dx/len, dy/len) — forward extension from end.
    // For 'start': direction = (-dx/len, -dy/len) — backward extension from start.
    const rayOx = nearEnd === 'end' ? line.x2 : line.x1;
    const rayOy = nearEnd === 'end' ? line.y2 : line.y1;
    const rayDx = nearEnd === 'end' ? dx / len : -dx / len;
    const rayDy = nearEnd === 'end' ? dy / len : -dy / len;

    // Build a ray-as-line for intersect: a segment far in the direction (length 1e6).
    const rayLine: Extract<SketchPrimitive, { kind: 'line' }> = {
      id: '__ray__', kind: 'line',
      x1: rayOx, y1: rayOy,
      x2: rayOx + rayDx * 1e6, y2: rayOy + rayDy * 1e6,
    };

    // Intersect the ray with all other primitives (unclamped on ray side).
    const others = this.primitives.filter((p) => p.id !== line.id);
    let nearestT = Infinity;
    let nearestX = 0, nearestY = 0;

    for (const other of others) {
      // Use clamped=false so the ray extends past the segment endpoint.
      const hits = intersect(rayLine, other, false);
      for (const h of hits) {
        // h.tA is fractional along the ray (1e6 units). Only forward hits (tA ≥ 0).
        if (h.tA < -1e-6) continue;
        // h.tB must be in [0,1] (the 'other' segment must be crossed within its body).
        if (other.kind === 'line' && (h.tB < -1e-6 || h.tB > 1 + 1e-6)) continue;
        const dist = h.tA;
        if (dist < nearestT) {
          nearestT = dist;
          nearestX = h.x;
          nearestY = h.y;
        }
      }
    }

    if (nearestT === Infinity) return; // no forward target

    if (nearEnd === 'end') {
      this.opts.updatePrimitive(line.id, { x2: nearestX, y2: nearestY });
    } else {
      this.opts.updatePrimitive(line.id, { x1: nearestX, y1: nearestY });
    }
  }
}
