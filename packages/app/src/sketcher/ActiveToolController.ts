import type { SketchPrimitive } from '@zilventor/shared';
import type { Point2, SnapResult } from './snap';
import { resolveSnap } from './snap';
import { SketchTool, type ToolOutput } from './tools/SketchTool';
import { LineTool } from './tools/LineTool';
import { RectTool } from './tools/RectTool';
import { CircleTool } from './tools/CircleTool';
import { ArcTool } from './tools/ArcTool';
import { SplineTool } from './tools/SplineTool';

export type ToolKind = 'line' | 'rect' | 'circle' | 'arc' | 'spline';

export type PointerEvent =
  | { type: 'click'; point: Point2 }
  | { type: 'move'; point: Point2 };

export type ControllerDeps = {
  emitPrimitive(primitive: SketchPrimitive): void;
  onPreview(polyline: Point2[] | null, snap: SnapResult): void;
};

const NEUTRAL_SNAP: SnapResult = { point: { x: 0, y: 0 }, kind: 'none' };

export class ActiveToolController {
  private tool: SketchTool | null = null;

  constructor(private deps: ControllerDeps) {}

  setToolKind(kind: ToolKind | null): void {
    if (this.tool) {
      this.tool.handle({ type: 'escapePressed' }); // abort any in-progress draw
    }
    this.tool = kind ? this.instantiate(kind) : null;
    this.deps.onPreview(null, NEUTRAL_SNAP);
  }

  private instantiate(kind: ToolKind): SketchTool {
    switch (kind) {
      case 'line': return new LineTool();
      case 'rect': return new RectTool();
      case 'circle': return new CircleTool();
      case 'arc': return new ArcTool();
      case 'spline': return new SplineTool();
    }
  }

  handlePointer(event: PointerEvent, primitives: SketchPrimitive[]): void {
    if (!this.tool) return;
    const anchor = this.tool.getAnchor() ?? undefined;
    const snap = resolveSnap(event.point, { primitives, pixelTolerance: 5, anchor });
    const output: ToolOutput =
      event.type === 'click'
        ? this.tool.handle({ type: 'pointerClick', point: event.point, snap })
        : this.tool.handle({ type: 'pointerMove', point: event.point, snap });
    this.applyOutput(output, snap);
  }

  handleKey(key: 'Enter' | 'Escape'): void {
    if (!this.tool) return;
    const output = this.tool.handle({ type: key === 'Enter' ? 'enterPressed' : 'escapePressed' });
    this.applyOutput(output, NEUTRAL_SNAP);
  }

  handleNumericCommit(values: number[]): void {
    if (!this.tool) return;
    const output = this.tool.handle({ type: 'numericCommit', values });
    this.applyOutput(output, NEUTRAL_SNAP);
  }

  numericFieldCount(): number {
    return this.tool ? this.tool.numericFieldCount() : 0;
  }

  getAnchor(): Point2 | null {
    return this.tool ? this.tool.getAnchor() : null;
  }

  private applyOutput(output: ToolOutput, snap: SnapResult): void {
    switch (output.kind) {
      case 'preview':
        this.deps.onPreview(output.polyline, snap);
        break;
      case 'committed':
        this.deps.emitPrimitive(output.primitive);
        this.deps.onPreview(null, snap);
        break;
      case 'aborted':
      case 'idle':
        this.deps.onPreview(null, snap);
        break;
    }
  }
}
