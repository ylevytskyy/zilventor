import { describe, it, expect } from 'vitest';
import type { Feature } from '../types';

describe('RevolveFeature', () => {
  it('accepts the documented shape', () => {
    const f: Extract<Feature, { kind: 'revolve' }> = {
      kind: 'revolve', id: 'r1', sketchRef: 's1',
      axisPrimitiveId: 'L3', angleParam: 'angle0',
      direction: 'normal', operation: 'join'
    };
    expect(f.direction).toBe('normal');
    expect(f.operation).toBe('join');
  });
});
