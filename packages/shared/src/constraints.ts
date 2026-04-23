export type ConstraintSource = 'user' | 'auto-snap' | 'inferred-migration';

export type PointRef =
  | { primitiveId: string; anchor: 'start' | 'end' | 'center' }
  | { primitiveId: string; anchor: `cp${number}` };

type Base = { id: string; source?: ConstraintSource };

export type SketchConstraint =
  | (Base & { kind: 'coincident';    a: PointRef; b: PointRef })
  | (Base & { kind: 'horizontal';    line: string })
  | (Base & { kind: 'vertical';      line: string })
  | (Base & { kind: 'parallel';      line1: string; line2: string })
  | (Base & { kind: 'perpendicular'; line1: string; line2: string })
  | (Base & { kind: 'tangent';       line: string; arc: string })
  | (Base & { kind: 'equal';         a: string; b: string })
  | (Base & { kind: 'symmetric';     a: PointRef; b: PointRef; axis: string });

export type SketchConstraintKind = SketchConstraint['kind'];

export const ALL_CONSTRAINT_KINDS: readonly SketchConstraintKind[] = [
  'coincident', 'horizontal', 'vertical', 'parallel',
  'perpendicular', 'tangent', 'equal', 'symmetric'
] as const;
