import { SketchTool, type ToolEvent, type ToolOutput, genPrimitiveId } from './SketchTool';
import type { Point2 } from '../snap';

type State =
  | { step: 'idle' }
  | { step: 'waitingEnd'; start: Point2 }
  | { step: 'waitingMid'; start: Point2; end: Point2 };

/** Circumscribed circle of 3 points; returns null if collinear. */
function circleFromThreePoints(a: Point2, b: Point2, c: Point2): { cx: number; cy: number; r: number } | null {
  const ax = a.x, ay = a.y, bx = b.x, by = b.y, cx = c.x, cy = c.y;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-6) return null;
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  const r = Math.hypot(ax - ux, ay - uy);
  return { cx: ux, cy: uy, r };
}

function angleOf(center: { cx: number; cy: number }, p: Point2): number {
  return Math.atan2(p.y - center.cy, p.x - center.cx);
}

export class ArcTool extends SketchTool {
  readonly kind = 'arc';
  private state: State = { step: 'idle' };

  handle(event: ToolEvent): ToolOutput {
    if (event.type === 'escapePressed') {
      const wasActive = this.state.step !== 'idle';
      this.state = { step: 'idle' };
      return wasActive ? { kind: 'aborted' } : { kind: 'idle' };
    }

    if (this.state.step === 'idle') {
      if (event.type === 'pointerClick') {
        this.state = { step: 'waitingEnd', start: event.snap.point };
      }
      return { kind: 'idle' };
    }

    if (this.state.step === 'waitingEnd') {
      if (event.type === 'pointerMove') {
        return { kind: 'preview', polyline: [this.state.start, event.snap.point] };
      }
      if (event.type === 'pointerClick') {
        this.state = { step: 'waitingMid', start: this.state.start, end: event.snap.point };
      }
      return { kind: 'idle' };
    }

    // waitingMid
    if (event.type === 'pointerMove') {
      const arc = this.computeArc(this.state.start, this.state.end, event.snap.point);
      if (!arc) return { kind: 'idle' };
      return { kind: 'preview', polyline: this.sampleArc(arc) };
    }

    if (event.type === 'pointerClick') {
      const arc = this.computeArc(this.state.start, this.state.end, event.snap.point);
      if (!arc) return { kind: 'idle' };
      this.state = { step: 'idle' };
      return { kind: 'committed', primitive: { id: genPrimitiveId(), kind: 'arc', ...arc } };
    }

    return { kind: 'idle' };
  }

  private computeArc(
    start: Point2, end: Point2, mid: Point2
  ): { cx: number; cy: number; r: number; startAngle: number; endAngle: number } | null {
    const c = circleFromThreePoints(start, end, mid);
    if (!c) return null;
    const sa = angleOf(c, start);
    const ea = angleOf(c, end);
    const midAngle = angleOf(c, mid);
    // Does an angle lie on the CCW arc from a to b?
    const inCCW = (angle: number, a: number, b: number): boolean => {
      const norm = (x: number) => ((x - a) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
      return norm(angle) <= norm(b);
    };
    let startAngle = sa, endAngle = ea;
    if (!inCCW(midAngle, sa, ea)) {
      startAngle = ea;
      endAngle = sa;
    }
    return { ...c, startAngle, endAngle };
  }

  private sampleArc(arc: { cx: number; cy: number; r: number; startAngle: number; endAngle: number }): Point2[] {
    const segs = 32;
    const out: Point2[] = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const a = arc.startAngle + (arc.endAngle - arc.startAngle) * t;
      out.push({ x: arc.cx + arc.r * Math.cos(a), y: arc.cy + arc.r * Math.sin(a) });
    }
    return out;
  }

  getAnchor(): Point2 | null {
    if (this.state.step === 'waitingEnd') return this.state.start;
    if (this.state.step === 'waitingMid') return this.state.end;
    return null;
  }

  reset(): void {
    this.state = { step: 'idle' };
  }

  numericFieldCount(): number {
    return 0;
  }
}
