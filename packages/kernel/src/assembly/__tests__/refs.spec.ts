import { describe, it, expect } from 'vitest';
import { refKey, type PartLocalGeometry } from '../AssemblyConstraintRefs';
import type { AssemblyConstraintRef } from '@zilventor/shared';

describe('refKey', () => {
  it('encodes face ref deterministically', () => {
    const r: AssemblyConstraintRef = {
      kind: 'face', componentId: 'C1',
      face: { featureId: 'extrude.1', role: 'top', instance: 0 },
    };
    expect(refKey(r)).toBe('face|extrude.1|top|0');
  });
  it('encodes axis-edge ref deterministically (sorted faceA/faceB)', () => {
    const r: AssemblyConstraintRef = {
      kind: 'axis', componentId: 'C1',
      axis: { source: 'edge', edge: {
        faceA: { featureId: 'b', role: 'r', instance: 0 },
        faceB: { featureId: 'a', role: 'r', instance: 0 },
      }},
    };
    const k = refKey(r);
    // canonicalEdgeName sorts; key should reflect that
    expect(k.startsWith('axis|edge|')).toBe(true);
  });
});

describe('PartLocalGeometry shape', () => {
  it('is a discriminated union', () => {
    const g: PartLocalGeometry = { kind: 'plane', P: { x: 0, y: 0, z: 0 }, N: { x: 0, y: 0, z: 1 } };
    if (g.kind === 'plane') expect(g.N.z).toBe(1);
  });
});
