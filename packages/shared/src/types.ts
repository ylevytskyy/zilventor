export type UnitKind = 'mm' | 'deg';

export type Parameter = {
  name: string;
  expression: string;
  value: number;
  unit: UnitKind;
};

export type BoundingBox = readonly [number, number, number, number, number, number];

export type Mesh = {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  boundingBox: BoundingBox;
};

export type SketchPrimitive =
  | { kind: 'rectangle'; x: number; y: number; w: number; h: number }
  | { kind: 'circle'; cx: number; cy: number; r: number };

export type Feature =
  | { kind: 'sketch'; id: string; plane: 'XY' | 'XZ' | 'YZ'; primitives: SketchPrimitive[] }
  | { kind: 'extrude'; id: string; sketchRef: string; distanceParam: string; direction: 'forward' | 'symmetric' };

export type CachedGeometry = {
  brepBlobId: string;
  triangleCount: number;
  boundingBox: BoundingBox;
};

export type PartDocument = {
  id: string;
  name: string;
  units: 'mm';
  parameters: Record<string, Parameter>;
  featureTree: Feature[];
  cachedGeometry?: CachedGeometry;
};

export type AssemblyDocument = { id: string; name: string };

export type ProjectFile = {
  formatVersion: 1;
  kind: 'part' | 'assembly';
  createdAt: string;
  appVersion: string;
  document: PartDocument | AssemblyDocument;
};
