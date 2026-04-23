import type { SketchPrimitive, SketchConstraint, PointRef } from '@zilventor/shared';

export type DofStatus = { count: number; state: 'under' | 'fully' | 'over' };

export type PrimitiveCoordsDiff = {
  primitiveId: string;
  patch: Partial<SketchPrimitive>;
};

export type AddConstraintResult =
  | { ok: true;  dof: DofStatus; coords: PrimitiveCoordsDiff[] }
  | { ok: false; reason: 'redundant' | 'conflict'; offendingConstraintIds: string[] };

export type DragSolveResult = {
  coords: PrimitiveCoordsDiff[];
  dof: DofStatus;
  solverMs: number;
};

export type SolverWarning = { code: 'redundant' | 'conflict'; constraintIds: string[] };

export type LoadSketchResult = { dof: DofStatus; warnings: SolverWarning[] };

export type SnapEvent =
  | { kind: 'endpoint'; primitiveId: string; anchor: PointRef['anchor'] }
  | { kind: 'axis'; axis: 'h' | 'v' };

export interface SketcherWorkerApi {
  loadSketch(args: { primitives: SketchPrimitive[]; constraints: SketchConstraint[] }): Promise<LoadSketchResult>;
  unloadSketch(): Promise<void>;

  addPrimitive(p: SketchPrimitive): Promise<{ dof: DofStatus }>;
  removePrimitive(id: string): Promise<{ dof: DofStatus }>;
  updatePrimitive(id: string, patch: Partial<SketchPrimitive>): Promise<{ dof: DofStatus }>;

  addConstraint(c: SketchConstraint): Promise<AddConstraintResult>;
  removeConstraint(id: string): Promise<{ dof: DofStatus }>;

  beginDrag(ref: PointRef): Promise<void>;
  dragTo(x: number, y: number): Promise<DragSolveResult>;
  endDrag(): Promise<{ dof: DofStatus; finalCoords: PrimitiveCoordsDiff[] }>;

  inferFromSnaps(p: SketchPrimitive, snapEvents: SnapEvent[]): Promise<SketchConstraint[]>;
}
