import type { SketchConstraint } from './constraints';
import type { SketchParameter, ParameterUnit } from './parameters';

/** @deprecated Use ParameterUnit from './parameters' */
export type UnitKind = ParameterUnit;

/** @deprecated Use SketchParameter from './parameters' */
export type Parameter = SketchParameter;

export type BoundingBox = readonly [number, number, number, number, number, number];

export type Mesh = {
  positions: Float32Array;
  indices: Uint32Array;
  boundingBox: BoundingBox;
};

export type SketchPrimitive =
  | { id: string; kind: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { id: string; kind: 'rectangle'; x: number; y: number; w: number; h: number }
  | { id: string; kind: 'circle'; cx: number; cy: number; r: number }
  | { id: string; kind: 'arc'; cx: number; cy: number; r: number; startAngle: number; endAngle: number }
  | { id: string; kind: 'spline'; controlPoints: ReadonlyArray<{ x: number; y: number }>; degree: 2 | 3; closed: boolean };

export type BooleanOperation = 'new' | 'join' | 'cut';

export type Feature =
  | { kind: 'sketch'; id: string; plane: 'XY' | 'XZ' | 'YZ'; primitives: SketchPrimitive[]; constraints: SketchConstraint[] }
  | { kind: 'extrude'; id: string; sketchRef: string; distanceParam: string; direction: 'forward' | 'symmetric'; operation: BooleanOperation };

export type CachedGeometry = {
  brepBlobId: string;
  triangleCount: number;
  boundingBox: BoundingBox;
};

export type PartDocument = {
  id: string;
  name: string;
  units: 'mm';
  parameters: Record<string, SketchParameter>;
  featureTree: Feature[];
  cachedGeometry?: CachedGeometry;
};

export type AssemblyDocument = { id: string; name: string };

export type ProjectFile = {
  formatVersion: 4;
  kind: 'part' | 'assembly';
  createdAt: string;
  appVersion: string;
  document: PartDocument | AssemblyDocument;
};
