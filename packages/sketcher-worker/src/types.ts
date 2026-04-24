import type { SketchPrimitive, SketchConstraint, PointRef, DimensionConstraint } from '@zilventor/shared';

export type DofStatus = { count: number; state: 'under' | 'fully' | 'over' };

export type PrimitiveCoordsDiff = {
  primitiveId: string;
  patch: Partial<SketchPrimitive>;
};

export type AddConstraintResult =
  | { ok: true;  dof: DofStatus; coords: PrimitiveCoordsDiff[] }
  | { ok: false; reason: 'redundant' | 'conflict'; offendingConstraintIds: string[] };

export type AddDimensionResult =
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
  loadSketch(args: { primitives: SketchPrimitive[]; constraints: SketchConstraint[]; dimensionResolvedValues?: Record<string, number> }): Promise<LoadSketchResult>;
  unloadSketch(): Promise<void>;

  addPrimitive(p: SketchPrimitive): Promise<{ dof: DofStatus }>;
  removePrimitive(id: string): Promise<{ dof: DofStatus }>;
  updatePrimitive(id: string, patch: Partial<SketchPrimitive>): Promise<{ dof: DofStatus }>;

  addConstraint(c: SketchConstraint): Promise<AddConstraintResult>;
  removeConstraint(id: string): Promise<{ dof: DofStatus }>;

  addDimension(constraint: DimensionConstraint, resolvedValue: number): Promise<AddDimensionResult>;
  removeDimension(id: string): Promise<{ dof: DofStatus; coords: PrimitiveCoordsDiff[] }>;
  updateDimensionValue(id: string, resolvedValue: number): Promise<{ dof: DofStatus; coords: PrimitiveCoordsDiff[] }>;

  beginDrag(ref: PointRef): Promise<void>;
  dragTo(x: number, y: number): Promise<DragSolveResult>;
  endDrag(): Promise<{ dof: DofStatus; finalCoords: PrimitiveCoordsDiff[] }>;

  inferFromSnaps(p: SketchPrimitive, snapEvents: SnapEvent[]): Promise<SketchConstraint[]>;
}
