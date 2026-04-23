import { SketchTool, type ToolEvent, type ToolOutput, genPrimitiveId } from './SketchTool';
import type { Point2, SnapResult } from '../snap';
import type { SnapEvent } from '@zilventor/sketcher-worker';

function snapEventsFromResult(snap: SnapResult): SnapEvent[] {
  if (snap.kind === 'horizontal-axis') return [{ kind: 'axis', axis: 'h' }];
  if (snap.kind === 'vertical-axis') return [{ kind: 'axis', axis: 'v' }];
  // 'endpoint' snap from snap.ts does not carry primitiveId — no SnapEvent emitted
  return [];
}

type State =
  | { step: 'idle' }
  | { step: 'waitingEnd'; firstPoint: Point2; lastMove: Point2 };

export class LineTool extends SketchTool {
  readonly kind = 'line';
  private state: State = { step: 'idle' };

  handle(event: ToolEvent): ToolOutput {
    if (event.type === 'escapePressed') {
      const wasActive = this.state.step !== 'idle';
      this.state = { step: 'idle' };
      return wasActive ? { kind: 'aborted' } : { kind: 'idle' };
    }

    if (this.state.step === 'idle') {
      if (event.type === 'pointerClick') {
        this.state = { step: 'waitingEnd', firstPoint: event.snap.point, lastMove: event.snap.point };
      }
      return { kind: 'idle' };
    }

    // waitingEnd
    if (event.type === 'pointerMove') {
      this.state = { ...this.state, lastMove: event.snap.point };
      return { kind: 'preview', polyline: [this.state.firstPoint, event.snap.point] };
    }

    if (event.type === 'pointerClick') {
      const primitive = {
        id: genPrimitiveId(),
        kind: 'line' as const,
        x1: this.state.firstPoint.x,
        y1: this.state.firstPoint.y,
        x2: event.snap.point.x,
        y2: event.snap.point.y
      };
      const snapEvents = snapEventsFromResult(event.snap);
      this.state = { step: 'idle' };
      return { kind: 'committed', primitive, snapEvents };
    }

    if (event.type === 'numericCommit' && event.values.length === 1) {
      const length = event.values[0]!;
      const dx = this.state.lastMove.x - this.state.firstPoint.x;
      const dy = this.state.lastMove.y - this.state.firstPoint.y;
      const mag = Math.hypot(dx, dy) || 1;
      const ux = dx / mag, uy = dy / mag;
      const primitive = {
        id: genPrimitiveId(),
        kind: 'line' as const,
        x1: this.state.firstPoint.x,
        y1: this.state.firstPoint.y,
        x2: this.state.firstPoint.x + ux * length,
        y2: this.state.firstPoint.y + uy * length
      };
      this.state = { step: 'idle' };
      return { kind: 'committed', primitive, snapEvents: [] };
    }

    return { kind: 'idle' };
  }

  getAnchor(): Point2 | null {
    return this.state.step === 'waitingEnd' ? this.state.firstPoint : null;
  }

  reset(): void {
    this.state = { step: 'idle' };
  }

  numericFieldCount(): number {
    return this.state.step === 'waitingEnd' ? 1 : 0;
  }
}
