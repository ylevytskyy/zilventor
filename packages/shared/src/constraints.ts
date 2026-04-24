export type ConstraintSource = 'user' | 'auto-snap' | 'inferred-migration';

export type PointRef =
  | { primitiveId: string; anchor: 'start' | 'end' | 'center' }
  | { primitiveId: string; anchor: 'bl' | 'br' | 'tr' | 'tl' }
  | { primitiveId: string; anchor: `cp${number}` };

type Base = { id: string; source?: ConstraintSource };

export type DimensionValue =
  | { kind: 'literal'; value: number }
  | { kind: 'param';   paramName: string };

type DimBase = { id: string; source?: ConstraintSource; paramName: string };

export type DimensionConstraint =
  | (DimBase & { kind: 'dim-length';              line: string;                  value: DimensionValue })
  | (DimBase & { kind: 'dim-distance';            a: PointRef; b: PointRef;      value: DimensionValue })
  | (DimBase & { kind: 'dim-angle';               line1: string; line2: string;  value: DimensionValue })
  | (DimBase & { kind: 'dim-radius';              circle: string;                value: DimensionValue })
  | (DimBase & { kind: 'dim-diameter';            circle: string;                value: DimensionValue })
  | (DimBase & { kind: 'dim-point-line-distance'; point: PointRef; line: string; value: DimensionValue });

export type SketchConstraint =
  | (Base & { kind: 'coincident';    a: PointRef; b: PointRef })
  | (Base & { kind: 'horizontal';    line: string })
  | (Base & { kind: 'vertical';      line: string })
  | (Base & { kind: 'parallel';      line1: string; line2: string })
  | (Base & { kind: 'perpendicular'; line1: string; line2: string })
  | (Base & { kind: 'tangent';       line: string; arc: string })
  | (Base & { kind: 'equal';         a: string; b: string })
  | (Base & { kind: 'symmetric';     a: PointRef; b: PointRef; axis: string })
  | DimensionConstraint;

export type SketchConstraintKind = SketchConstraint['kind'];

export const ALL_CONSTRAINT_KINDS: readonly SketchConstraintKind[] = [
  'coincident', 'horizontal', 'vertical', 'parallel',
  'perpendicular', 'tangent', 'equal', 'symmetric'
] as const;

export const ALL_DIMENSION_KINDS: readonly DimensionConstraint['kind'][] = [
  'dim-length', 'dim-distance', 'dim-angle', 'dim-radius', 'dim-diameter', 'dim-point-line-distance'
] as const;
