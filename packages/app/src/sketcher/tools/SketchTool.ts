import type { SketchPrimitive } from '@zilventor/shared';
import type { Point2, SnapResult } from '../snap';

export type ToolEvent =
  | { type: 'pointerMove'; point: Point2; snap: SnapResult }
  | { type: 'pointerClick'; point: Point2; snap: SnapResult }
  | { type: 'enterPressed' }
  | { type: 'escapePressed' }
  | { type: 'numericCommit'; values: number[] };

export type ToolOutput =
  | { kind: 'preview'; polyline: Point2[] }
  | { kind: 'committed'; primitive: SketchPrimitive }
  | { kind: 'aborted' }
  | { kind: 'idle' };

export abstract class SketchTool {
  abstract readonly kind: 'line' | 'rect' | 'circle' | 'arc' | 'spline';
  abstract handle(event: ToolEvent): ToolOutput;
  abstract getAnchor(): Point2 | null;
  abstract reset(): void;
  /** Number of numeric fields this tool accepts during drawing; 0 = numeric input disabled right now. */
  abstract numericFieldCount(): number;
}

export function genPrimitiveId(): string {
  return `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
