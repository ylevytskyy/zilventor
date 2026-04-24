import { describe, it, expect } from 'vitest';
import type { Feature, FilletFeature, ParamOrLiteral } from '../types';

describe('FilletFeature', () => {
  it('accepts the documented shape', () => {
    const radius: ParamOrLiteral = { kind: 'param', paramName: 'r_fillet' };
    const f: FilletFeature = {
      kind: 'fillet', id: 'F1', mode: 'constant',
      edges: [{
        edgeId: {
          faceA: { featureId: 'E1', role: 'top' },
          faceB: { featureId: 'E1', role: 'side', instance: 0 }
        },
        selectionMode: 'edge',
        radius
      }],
      setbacks: []
    };
    expect(f.kind).toBe('fillet');
    const asUnion: Feature = f;
    expect(asUnion.kind).toBe('fillet');
  });
});
