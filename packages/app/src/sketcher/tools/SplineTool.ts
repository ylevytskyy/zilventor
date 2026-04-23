import { SketchTool, type ToolEvent, type ToolOutput, genPrimitiveId } from './SketchTool';
import type { Point2 } from '../snap';

export class SplineTool extends SketchTool {
  readonly kind = 'spline';
  private points: Point2[] = [];

  handle(event: ToolEvent): ToolOutput {
    if (event.type === 'escapePressed') {
      const wasActive = this.points.length > 0;
      this.points = [];
      return wasActive ? { kind: 'aborted' } : { kind: 'idle' };
    }

    if (event.type === 'pointerClick') {
      this.points.push(event.snap.point);
      return { kind: 'idle' };
    }

    if (event.type === 'pointerMove') {
      if (this.points.length < 1) return { kind: 'idle' };
      const sampled = this.sampleThrough([...this.points, event.snap.point]);
      return { kind: 'preview', polyline: sampled };
    }

    if (event.type === 'enterPressed') {
      if (this.points.length < 2) return { kind: 'idle' };
      const pts = this.points.slice();
      this.points = [];
      return {
        kind: 'committed',
        primitive: {
          id: genPrimitiveId(),
          kind: 'spline',
          controlPoints: pts,
          degree: 3,
          closed: false
        },
        snapEvents: []
      };
    }

    return { kind: 'idle' };
  }

  /**
   * Visual-only preview sampling: linear interpolation through the control polygon.
   * Committed splines are re-sampled properly in CommittedSketchRenderer
   * (via CatmullRomCurve3) and authoritatively in OCCT (via GeomAPI_PointsToBSpline).
   */
  private sampleThrough(pts: Point2[]): Point2[] {
    if (pts.length < 2) return pts;
    const out: Point2[] = [];
    const samplesPerSegment = 8;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!, b = pts[i + 1]!;
      for (let k = 0; k < samplesPerSegment; k++) {
        const t = k / samplesPerSegment;
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    out.push(pts[pts.length - 1]!);
    return out;
  }

  getAnchor(): Point2 | null {
    return this.points.length > 0 ? this.points[this.points.length - 1]! : null;
  }

  reset(): void {
    this.points = [];
  }

  numericFieldCount(): number {
    return 0;
  }
}
