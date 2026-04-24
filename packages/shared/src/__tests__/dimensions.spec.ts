import { describe, it, expect } from 'vitest';
import type { SketchConstraint, DimensionValue } from '../constraints';

describe('Dimension constraint variants', () => {
  it('accepts all 6 dimension kinds', () => {
    const samples: SketchConstraint[] = [
      { id: 'c1', kind: 'dim-length',              paramName: 'd0', line: 'L1',
        value: { kind: 'literal', value: 50 } },
      { id: 'c2', kind: 'dim-distance',            paramName: 'd1',
        a: { primitiveId: 'L1', anchor: 'start' }, b: { primitiveId: 'L2', anchor: 'end' },
        value: { kind: 'literal', value: 100 } },
      { id: 'c3', kind: 'dim-angle',               paramName: 'd2',
        line1: 'L1', line2: 'L2', value: { kind: 'literal', value: 90 } },
      { id: 'c4', kind: 'dim-radius',              paramName: 'd3', circle: 'C1',
        value: { kind: 'literal', value: 25 } },
      { id: 'c5', kind: 'dim-diameter',            paramName: 'd4', circle: 'C1',
        value: { kind: 'param', paramName: 'd3' } },
      { id: 'c6', kind: 'dim-point-line-distance', paramName: 'd5',
        point: { primitiveId: 'L1', anchor: 'end' }, line: 'L2',
        value: { kind: 'literal', value: 15 } }
    ];
    expect(samples).toHaveLength(6);
  });

  it('DimensionValue accepts literal or param reference', () => {
    const lit: DimensionValue = { kind: 'literal', value: 42 };
    const ref: DimensionValue = { kind: 'param', paramName: 'width' };
    expect(lit.kind).toBe('literal');
    expect(ref.kind).toBe('param');
  });
});
