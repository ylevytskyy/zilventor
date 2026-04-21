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

// Extended in later tasks.
export type Feature = never;
export type PartDocument = unknown;
export type AssemblyDocument = unknown;
export type ProjectFile = unknown;
