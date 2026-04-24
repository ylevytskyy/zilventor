import { describe, it, expect } from 'vitest';
import type { BooleanOperation, Feature } from '../types';

describe('BooleanOperation', () => {
  it('accepts the three operation variants', () => {
    const ops: BooleanOperation[] = ['new', 'join', 'cut'];
    expect(ops).toHaveLength(3);
  });

  it('Extrude features carry an operation field', () => {
    const ex: Extract<Feature, { kind: 'extrude' }> = {
      kind: 'extrude', id: 'e1', sketchRef: 's1',
      distanceParam: 'd0', direction: 'forward', operation: 'new'
    };
    expect(ex.operation).toBe('new');
  });
});
