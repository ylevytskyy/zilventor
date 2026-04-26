import { describe, it, expect } from 'vitest';
import { refKey, type PartLocalGeometry, resolveRef, type ExtractorBundle, AssemblyRefCache } from '../AssemblyConstraintRefs';
import type { AssemblyConstraintRef } from '@zilventor/shared';

const stubExtractors: ExtractorBundle = {
  extractFacePlane:    (_s, _f) => ({ ok: true, value: { P: { x: 0, y: 0, z: 0 }, N: { x: 0, y: 0, z: 1 } } }),
  extractCylinderAxis: (_s, _f) => ({ ok: true, value: { P: { x: 1, y: 0, z: 0 }, D: { x: 0, y: 0, z: 1 } } }),
  extractEdgeLine:     (_s, _e) => ({ ok: true, value: { P: { x: 0, y: 0, z: 0 }, D: { x: 1, y: 0, z: 0 } } }),
  extractEdgeEndpoint: (_s, _e, _end) => ({ ok: true, value: { P: { x: 2, y: 0, z: 0 } } }),
  extractEdgeMidpoint: (_s, _e) => ({ ok: true, value: { P: { x: 1, y: 0, z: 0 } } }),
};

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

describe('resolveRef', () => {
  it('dispatches face → plane via extractFacePlane', () => {
    const r = { kind: 'face', componentId: 'C', face: { featureId: 'a', role: 'r' } } as const;
    const out = resolveRef(r, null as any, new Map(), stubExtractors);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value.kind).toBe('plane');
  });
  it('dispatches axis-edge → axis via extractEdgeLine', () => {
    const r = { kind: 'axis', componentId: 'C', axis: { source: 'edge', edge: { faceA: { featureId: 'a', role: 'r' }, faceB: { featureId: 'b', role: 'r' } } } } as const;
    const out = resolveRef(r, null as any, new Map(), stubExtractors);
    expect(out.ok).toBe(true);
    if (out.ok && out.value.kind === 'axis') expect(out.value.D.x).toBe(1);
  });
  it('dispatches workAxis ref to workFeatureValues map', () => {
    const wfs = new Map<string, any>();
    wfs.set('wa1', { featureId: 'wa1', kind: 'axis', origin: { x: 9, y: 0, z: 0 }, direction: { x: 0, y: 1, z: 0 } });
    const r = { kind: 'axis', componentId: 'C', axis: { source: 'workAxis', featureId: 'wa1' } } as const;
    const out = resolveRef(r, null as any, wfs, stubExtractors);
    expect(out.ok).toBe(true);
    if (out.ok && out.value.kind === 'axis') expect(out.value.P.x).toBe(9);
  });
});

describe('AssemblyRefCache', () => {
  it('memoizes by (partPath, refKey)', () => {
    const cache = new AssemblyRefCache();
    let calls = 0;
    const r = { kind: 'face', componentId: 'C', face: { featureId: 'a', role: 'r' } } as const;
    const compute = () => { calls++; return { ok: true as const, value: { kind: 'plane' as const, P: { x: 0, y: 0, z: 0 }, N: { x: 0, y: 0, z: 1 } } }; };
    cache.getOrCompute('p.zipt', r, compute);
    cache.getOrCompute('p.zipt', r, compute);
    expect(calls).toBe(1);
    cache.getOrCompute('q.zipt', r, compute);
    expect(calls).toBe(2);
  });
  it("invalidate(partPath) clears that part's entries", () => {
    const cache = new AssemblyRefCache();
    let calls = 0;
    const r = { kind: 'face', componentId: 'C', face: { featureId: 'a', role: 'r' } } as const;
    const compute = () => { calls++; return { ok: true as const, value: { kind: 'plane' as const, P: { x: 0, y: 0, z: 0 }, N: { x: 0, y: 0, z: 1 } } }; };
    cache.getOrCompute('p.zipt', r, compute);
    cache.invalidate('p.zipt');
    cache.getOrCompute('p.zipt', r, compute);
    expect(calls).toBe(2);
  });
});
