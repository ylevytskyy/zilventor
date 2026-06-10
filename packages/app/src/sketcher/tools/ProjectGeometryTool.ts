import type { SketchPrimitive, TessellatedEdge } from '@zilventor/shared';
import type { SketchFrame } from '../geometry/projectToSketch';
import { projectToSketch } from '../geometry/projectToSketch';
import i18n from '../../i18n';

export type ProjectGeometryToolOpts = {
  /** null = face-sourced sketch (no xDir known) → toast and no-op */
  frame: SketchFrame | null;
  emitPrimitive(p: SketchPrimitive): void;
  showToast(message: string): void;
};

/**
 * ProjectGeometryTool — projects a straight 3D model edge onto the active sketch
 * plane as an ordinary (non-construction) sketch line. Non-associative MVP:
 * projected geometry is baked once and not updated when the source model changes.
 *
 * Supports workplane-based sketches only (frame != null).
 * Face-sourced sketches (frame == null) are guarded with a toast.
 * Curved edges (segments.length > 1) are guarded with a toast.
 *
 * Invocation: call `projectEdge(tessellatedEdge)` from the app when the user
 * ray-picks a 3D edge in sketch mode with this tool active.
 */
export class ProjectGeometryTool {
  constructor(private readonly opts: ProjectGeometryToolOpts) {}

  /** Called when the user ray-picks a 3D edge in sketch mode. */
  projectEdge(edge: TessellatedEdge): void {
    // Guard: face-sourced sketches have no xDir → cannot project.
    if (!this.opts.frame) {
      this.opts.showToast(
        i18n.t('toast.projectGeometry.workplaneOnly'),
      );
      return;
    }

    // Guard: only single-segment (straight) edges are supported.
    // A multi-segment edge represents a curved edge; reject it.
    if (edge.segments.length !== 1) {
      this.opts.showToast(
        i18n.t('toast.projectGeometry.curvedEdgeNotSupported'),
      );
      return;
    }

    const [p3a, p3b] = edge.segments[0]!;
    const uvA = projectToSketch(p3a, this.opts.frame);
    const uvB = projectToSketch(p3b, this.opts.frame);

    const line: Extract<SketchPrimitive, { kind: 'line' }> = {
      id: `p-proj-${crypto.randomUUID().slice(0, 8)}`,
      kind: 'line',
      x1: uvA.u, y1: uvA.v,
      x2: uvB.u, y2: uvB.v,
    };
    this.opts.emitPrimitive(line);
  }

  onEscapePressed(): void { /* stateless */ }
}
