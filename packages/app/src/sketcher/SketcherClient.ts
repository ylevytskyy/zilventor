import type {
  SketcherWorkerApi,
  DragSolveResult,
  LoadSketchResult,
  AddConstraintResult,
  AddDimensionResult,
  DofStatus,
  PrimitiveCoordsDiff,
  SnapEvent
} from '@zilventor/sketcher-worker';
import type {
  SketchPrimitive,
  SketchConstraint,
  PointRef,
  DimensionConstraint
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
  addDimension(c: DimensionConstraint, resolvedValue: number): Promise<AddDimensionResult> {
    return this.api.addDimension(c, resolvedValue);
  }
  removeDimension(id: string): Promise<{ dof: DofStatus; coords: PrimitiveCoordsDiff[] }> {
    return this.api.removeDimension(id);
  }
  updateDimensionValue(id: string, resolvedValue: number): Promise<{ dof: DofStatus; coords: PrimitiveCoordsDiff[] }> {
    return this.api.updateDimensionValue(id, resolvedValue);
  }
  beginDrag(ref: PointRef): Promise<void> { return this.api.beginDrag(ref); }
  async dragTo(x: number, y: number): Promise<DragSolveResult> {
    const r = await this.api.dragTo(x, y);
    if (typeof window !== 'undefined' && import.meta.env.DEV) {
      const w = window as unknown as { __zilventorDragSolverMsSamples?: number[] };
      if (w.__zilventorDragSolverMsSamples) w.__zilventorDragSolverMsSamples.push(r.solverMs);
    }
    return r;
  }
  endDrag(): Promise<{ dof: DofStatus; finalCoords: PrimitiveCoordsDiff[] }> { return this.api.endDrag(); }
  inferFromSnaps(p: SketchPrimitive, snapEvents: SnapEvent[]): Promise<SketchConstraint[]> {
    return this.api.inferFromSnaps(p, snapEvents);
  }
}
