import type { SketchPrimitive, SketchConstraint, DimensionConstraint } from '@zilventor/shared';
import type { DofStatus, PrimitiveCoordsDiff } from '@zilventor/sketcher-worker';
import type { Point2, SnapResult } from './snap';
import { resolveSnap } from './snap';
import { SketchTool, type ToolOutput } from './tools/SketchTool';
import { LineTool } from './tools/LineTool';
import { RectTool } from './tools/RectTool';
import { CircleTool } from './tools/CircleTool';
import { ArcTool } from './tools/ArcTool';
import { SplineTool } from './tools/SplineTool';
import { SelectTool } from './tools/SelectTool';
import { ConstraintTool } from './tools/ConstraintTool';
import { GeneralDimensionTool } from './tools/GeneralDimensionTool';
import type { SketcherClient } from './SketcherClient';

export type ToolKind =
  | 'select'
  | 'line' | 'rect' | 'circle' | 'arc' | 'spline'
  | 'constrain-coincident' | 'constrain-horizontal' | 'constrain-vertical'
  | 'constrain-parallel' | 'constrain-perpendicular' | 'constrain-tangent'
  | 'constrain-equal' | 'constrain-symmetric'
  | 'dimension';

export type PointerEvent =
  | { type: 'click'; point: Point2 }
  | { type: 'move'; point: Point2 }
  | { type: 'pointerdown'; point: Point2 }
  | { type: 'pointerup'; point: Point2 };

export type ControllerDeps = {
  emitPrimitive(primitive: SketchPrimitive): void;
  onPreview(polyline: Point2[] | null, snap: SnapResult): void;
  emitConstraint?(c: SketchConstraint): void;
  sketcherClient?: SketcherClient;
  onCoords?(diff: PrimitiveCoordsDiff[]): void;
  onDof?(dof: DofStatus): void;
  onDimensionReady?(d: DimensionConstraint): void;
  isConstructionMode?(): boolean;
};

const NEUTRAL_SNAP: SnapResult = { point: { x: 0, y: 0 }, kind: 'none' };

type ActiveTool = SketchTool | SelectTool | ConstraintTool | GeneralDimensionTool;

export class ActiveToolController {
  private tool: ActiveTool | null = null;

  constructor(private deps: ControllerDeps) {}

  setToolKind(kind: ToolKind | null): void {
    if (this.tool instanceof SketchTool) {
      this.tool.handle({ type: 'escapePressed' }); // abort any in-progress draw
    } else if (this.tool instanceof ConstraintTool) {
      this.tool.onEscapePressed();
    } else if (this.tool instanceof GeneralDimensionTool) {
      this.tool.onEscapePressed();
    }
    this.tool = kind ? this.instantiate(kind) : null;
    if (!(this.tool instanceof SelectTool) && !(this.tool instanceof ConstraintTool) && !(this.tool instanceof GeneralDimensionTool)) {
      this.deps.onPreview(null, NEUTRAL_SNAP);
    }
  }

  currentTool(): ActiveTool | null {
    return this.tool;
  }

  private instantiate(kind: ToolKind): ActiveTool {
    switch (kind) {
      case 'line':   return new LineTool();
      case 'rect':   return new RectTool();
      case 'circle': return new CircleTool();
      case 'arc':    return new ArcTool();
      case 'spline': return new SplineTool();

      case 'select': {
        const t = new SelectTool();
        if (this.deps.sketcherClient && this.deps.onCoords && this.deps.onDof) {
          t.bind({
            client: this.deps.sketcherClient,
            onCoords: this.deps.onCoords,
            onDof: this.deps.onDof,
          });
        }
        return t;
      }

      case 'dimension':
        return new GeneralDimensionTool({
          onDimensionReady: (d) => { this.deps.onDimensionReady?.(d); },
        });

      case 'constrain-coincident':
      case 'constrain-horizontal':
      case 'constrain-vertical':
      case 'constrain-parallel':
      case 'constrain-perpendicular':
      case 'constrain-tangent':
      case 'constrain-equal':
      case 'constrain-symmetric': {
        // The switch arms above only produce geometric constrain-* kinds,
        // so the narrowed type excludes dimensional kinds.
        const constraintKind = kind.slice('constrain-'.length) as
          Exclude<SketchConstraint['kind'], `dim-${string}`>;
        return new ConstraintTool({
          kind: constraintKind,
          onCommit: (c) => { this.deps.emitConstraint?.(c); },
        });
      }
    }
  }

  handlePointer(event: PointerEvent, primitives: SketchPrimitive[]): void {
    if (!this.tool) return;

    if (this.tool instanceof SelectTool) {
      this.tool.setPrimitives(primitives);
      if (event.type === 'pointerdown') {
        void this.tool.onPointerDown(event.point);
      } else if (event.type === 'move') {
        void this.tool.onPointerMove(event.point);
      } else if (event.type === 'pointerup') {
        void this.tool.onPointerUp();
      }
      return;
    }

    if (this.tool instanceof ConstraintTool) {
      this.tool.setPrimitives(primitives);
      if (event.type === 'click') {
        void this.tool.onPointerClick(event.point);
      }
      return;
    }

    if (this.tool instanceof GeneralDimensionTool) {
      this.tool.setPrimitives(primitives);
      if (event.type === 'click') void this.tool.onPointerClick(event.point);
      return;
    }

    // SketchTool path
    const sketchTool = this.tool;
    const anchor = sketchTool.getAnchor();
    const snap = anchor
      ? resolveSnap(event.point, { primitives, pixelTolerance: 5, anchor })
      : resolveSnap(event.point, { primitives, pixelTolerance: 5 });
    let output: ToolOutput;
    if (event.type === 'click') {
      output = sketchTool.handle({ type: 'pointerClick', point: event.point, snap });
    } else if (event.type === 'move') {
      output = sketchTool.handle({ type: 'pointerMove', point: event.point, snap });
    } else {
      // pointerdown/pointerup not used by drawing tools — ignore
      return;
    }
    this.applyOutput(output, snap);
  }

  handleKey(key: 'Enter' | 'Escape'): void {
    if (!this.tool) return;

    if (this.tool instanceof ConstraintTool) {
      if (key === 'Escape') this.tool.onEscapePressed();
      return;
    }

    if (this.tool instanceof GeneralDimensionTool) {
      if (key === 'Escape') this.tool.onEscapePressed();
      return;
    }

    if (this.tool instanceof SelectTool) return;

    const output = this.tool.handle({ type: key === 'Enter' ? 'enterPressed' : 'escapePressed' });
    this.applyOutput(output, NEUTRAL_SNAP);
  }

  handleNumericCommit(values: number[]): void {
    if (!this.tool) return;
    if (!(this.tool instanceof SketchTool)) return;
    const output = this.tool.handle({ type: 'numericCommit', values });
    this.applyOutput(output, NEUTRAL_SNAP);
  }

  numericFieldCount(): number {
    if (!this.tool || !(this.tool instanceof SketchTool)) return 0;
    return this.tool.numericFieldCount();
  }

  getAnchor(): Point2 | null {
    if (!this.tool || !(this.tool instanceof SketchTool)) return null;
    return this.tool.getAnchor();
  }

  private applyOutput(output: ToolOutput, snap: SnapResult): void {
    switch (output.kind) {
      case 'preview':
        this.deps.onPreview(output.polyline, snap);
        break;
      case 'committed': {
        const primitive: SketchPrimitive = this.deps.isConstructionMode?.()
          ? { ...output.primitive, construction: true }
          : output.primitive;
        this.deps.emitPrimitive(primitive);
        if (output.snapEvents.length > 0 && this.deps.sketcherClient) {
          void this.deps.sketcherClient
            .inferFromSnaps(primitive, output.snapEvents)
            .then((inferred) => {
              if (this.deps.emitConstraint) {
                for (const c of inferred) this.deps.emitConstraint!(c);
              }
            });
        }
        this.deps.onPreview(null, snap);
        break;
      }
      case 'aborted':
      case 'idle':
        this.deps.onPreview(null, snap);
        break;
    }
  }
}
