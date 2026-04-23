import type {
  SketcherWorkerApi,
  DragSolveResult,
  LoadSketchResult,
  AddConstraintResult,
  DofStatus,
  PrimitiveCoordsDiff,
  SnapEvent
} from '@zilventor/sketcher-worker';
import type {
  SketchPrimitive,
  SketchConstraint,
  PointRef
} from '@zilventor/shared';

export class SketcherClient {
  constructor(private api: SketcherWorkerApi) {}

  loadSketch(args: { primitives: SketchPrimitive[]; constraints: SketchConstraint[] }): Promise<LoadSketchResult> {
    return this.api.loadSketch(args);
  }
  unloadSketch(): Promise<void> { return this.api.unloadSketch(); }
  addPrimitive(p: SketchPrimitive): Promise<{ dof: DofStatus }> { return this.api.addPrimitive(p); }
  removePrimitive(id: string): Promise<{ dof: DofStatus }> { return this.api.removePrimitive(id); }
  updatePrimitive(id: string, patch: Partial<SketchPrimitive>): Promise<{ dof: DofStatus }> {
    return this.api.updatePrimitive(id, patch);
  }
  addConstraint(c: SketchConstraint): Promise<AddConstraintResult> { return this.api.addConstraint(c); }
  removeConstraint(id: string): Promise<{ dof: DofStatus }> { return this.api.removeConstraint(id); }
  beginDrag(ref: PointRef): Promise<void> { return this.api.beginDrag(ref); }
  dragTo(x: number, y: number): Promise<DragSolveResult> { return this.api.dragTo(x, y); }
  endDrag(): Promise<{ dof: DofStatus; finalCoords: PrimitiveCoordsDiff[] }> { return this.api.endDrag(); }
  inferFromSnaps(p: SketchPrimitive, snapEvents: SnapEvent[]): Promise<SketchConstraint[]> {
    return this.api.inferFromSnaps(p, snapEvents);
  }
}
