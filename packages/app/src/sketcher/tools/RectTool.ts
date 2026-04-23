import { SketchTool, type ToolEvent, type ToolOutput, genPrimitiveId } from './SketchTool';
import type { Point2 } from '../snap';

type State = { step: 'idle' } | { step: 'waitingSecond'; first: Point2 };

export class RectTool extends SketchTool {
  readonly kind = 'rect';
  private state: State = { step: 'idle' };

  handle(event: ToolEvent): ToolOutput {
    if (event.type === 'escapePressed') {
      const wasActive = this.state.step !== 'idle';
      this.state = { step: 'idle' };
      return wasActive ? { kind: 'aborted' } : { kind: 'idle' };
    }

    if (this.state.step === 'idle') {
      if (event.type === 'pointerClick') {
        this.state = { step: 'waitingSecond', first: event.snap.point };
      }
      return { kind: 'idle' };
    }

    if (event.type === 'pointerMove') {
      const { first } = this.state;
      const p = event.snap.point;
      return { kind: 'preview', polyline: this.polyline(first, p) };
    }

    if (event.type === 'pointerClick') {
      const { first } = this.state;
      const p = event.snap.point;
      const primitive = {
        id: genPrimitiveId(),
        kind: 'rectangle' as const,
        x: Math.min(first.x, p.x),
        y: Math.min(first.y, p.y),
        w: Math.abs(p.x - first.x),
        h: Math.abs(p.y - first.y)
      };
      this.state = { step: 'idle' };
      return { kind: 'committed', primitive, snapEvents: [] };
    }

    if (event.type === 'numericCommit' && event.values.length === 2) {
      const [w, h] = event.values as [number, number];
      const { first } = this.state;
      const primitive = {
        id: genPrimitiveId(),
        kind: 'rectangle' as const,
        x: first.x,
        y: first.y,
        w,
        h
      };
      this.state = { step: 'idle' };
      return { kind: 'committed', primitive, snapEvents: [] };
    }

    return { kind: 'idle' };
  }

  private polyline(a: Point2, b: Point2): Point2[] {
    return [
      { x: a.x, y: a.y },
      { x: b.x, y: a.y },
      { x: b.x, y: b.y },
      { x: a.x, y: b.y },
      { x: a.x, y: a.y }
    ];
  }

  getAnchor(): Point2 | null {
    return this.state.step === 'waitingSecond' ? this.state.first : null;
  }

  reset(): void {
    this.state = { step: 'idle' };
  }

  numericFieldCount(): number {
    return this.state.step === 'waitingSecond' ? 2 : 0;
  }
}
