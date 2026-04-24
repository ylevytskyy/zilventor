import type { SketchPrimitive } from '@zilventor/shared';
import type { Point2 } from '../sketcher/snap';

export class AxisPickController {
  private candidates: Array<Extract<SketchPrimitive, { kind: 'line' }>> = [];
  private tolerance = 2;   // world units

  setCandidates(prims: SketchPrimitive[]): void {
    this.candidates = prims.filter(
      (p): p is Extract<SketchPrimitive, { kind: 'line' }> => p.kind === 'line'
    );
  }

  setTolerance(t: number): void {
    this.tolerance = t;
  }

  pick(p: Point2): string | null {
    let best: { id: string; d: number } | null = null;
    for (const line of this.candidates) {
      const d = distToSegment(
        p,
        { x: line.x1, y: line.y1 },
        { x: line.x2, y: line.y2 }
      );
      if (d < this.tolerance && (!best || d < best.d)) best = { id: line.id, d };
    }
    return best?.id ?? null;
  }
}

function distToSegment(p: Point2, a: Point2, b: Point2): number {
  const vx = b.x - a.x,
    vy = b.y - a.y;
  const wx = p.x - a.x,
    wy = p.y - a.y;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return Math.hypot(wx, wy);
  const c2 = vx * vx + vy * vy;
  if (c1 >= c2) return Math.hypot(p.x - b.x, p.y - b.y);
  const t = c1 / c2;
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}
