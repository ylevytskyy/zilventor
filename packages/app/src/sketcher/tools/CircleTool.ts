import { SketchTool, type ToolEvent, type ToolOutput, genPrimitiveId } from './SketchTool';
import type { Point2 } from '../snap';

type State = { step: 'idle' } | { step: 'waitingRadius'; center: Point2 };

export class CircleTool extends SketchTool {
  readonly kind = 'circle';
  private state: State = { step: 'idle' };

  handle(event: ToolEvent): ToolOutput {
    if (event.type === 'escapePressed') {
      const wasActive = this.state.step !== 'idle';
      this.state = { step: 'idle' };
      return wasActive ? { kind: 'aborted' } : { kind: 'idle' };
    }

    if (this.state.step === 'idle') {
      if (event.type === 'pointerClick') {
        this.state = { step: 'waitingRadius', center: event.snap.point };
      }
      return { kind: 'idle' };
    }

    if (event.type === 'pointerMove') {
      const { center } = this.state;
      const r = Math.hypot(event.snap.point.x - center.x, event.snap.point.y - center.y);
      return { kind: 'preview', polyline: this.sampleCircle(center, r) };
    }

    if (event.type === 'pointerClick') {
      const { center } = this.state;
      const r = Math.hypot(event.snap.point.x - center.x, event.snap.point.y - center.y);
      if (r < 1e-6) return { kind: 'idle' };
      const primitive = { id: genPrimitiveId(), kind: 'circle' as const, cx: center.x, cy: center.y, r };
      this.state = { step: 'idle' };
      return { kind: 'committed', primitive };
    }

    if (event.type === 'numericCommit' && event.values.length === 1) {
      const r = event.values[0]!;
      if (r <= 0 || !Number.isFinite(r)) return { kind: 'idle' };
      const { center } = this.state;
      const primitive = { id: genPrimitiveId(), kind: 'circle' as const, cx: center.x, cy: center.y, r };
      this.state = { step: 'idle' };
      return { kind: 'committed', primitive };
    }

    return { kind: 'idle' };
  }

  private sampleCircle(center: Point2, r: number): Point2[] {
    const segs = 64;
    const out: Point2[] = [];
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * 2 * Math.PI;
      out.push({ x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a) });
    }
    return out;
  }

  getAnchor(): Point2 | null {
    return this.state.step === 'waitingRadius' ? this.state.center : null;
  }

  reset(): void {
    this.state = { step: 'idle' };
  }

  numericFieldCount(): number {
    return this.state.step === 'waitingRadius' ? 1 : 0;
  }
}
