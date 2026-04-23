import { describe, it, expect } from 'vitest';
import type { SketchConstraint, PointRef, ConstraintSource } from '../constraints';

describe('SketchConstraint types', () => {
  it('accepts all 8 geometric kinds', () => {
    const samples: SketchConstraint[] = [
      { id: 'c1', kind: 'coincident', a: { primitiveId: 'l1', anchor: 'start' }, b: { primitiveId: 'l2', anchor: 'end' } },
      { id: 'c2', kind: 'horizontal', line: 'l1' },
      { id: 'c3', kind: 'vertical', line: 'l1' },
      { id: 'c4', kind: 'parallel', line1: 'l1', line2: 'l2' },
      { id: 'c5', kind: 'perpendicular', line1: 'l1', line2: 'l2' },
      { id: 'c6', kind: 'tangent', line: 'l1', arc: 'a1' },
      { id: 'c7', kind: 'equal', a: 'l1', b: 'l2' },
      { id: 'c8', kind: 'symmetric', a: { primitiveId: 'l1', anchor: 'start' }, b: { primitiveId: 'l2', anchor: 'end' }, axis: 'l3' }
    ];
    expect(samples).toHaveLength(8);
  });

  it('PointRef accepts start/end/center anchors and cpN for splines', () => {
    const refs: PointRef[] = [
      { primitiveId: 'l1', anchor: 'start' },
      { primitiveId: 'a1', anchor: 'center' },
      { primitiveId: 's1', anchor: 'cp0' },
      { primitiveId: 's1', anchor: 'cp12' }
    ];
    expect(refs).toHaveLength(4);
  });

  it('ConstraintSource is "user" | "auto-snap" | "inferred-migration"', () => {
    const sources: ConstraintSource[] = ['user', 'auto-snap', 'inferred-migration'];
    expect(sources).toHaveLength(3);
  });
});
