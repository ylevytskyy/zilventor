import { describe, it, expect } from 'vitest';
import type {
  WorkAxisFeature, WorkPlaneFeature, WorkPointFeature,
  WorkAxisRef, WorkPlaneRef, WorkPointRef, ParamOrLiteral, Feature,
} from '../types';

describe('Work feature types', () => {
  it('WorkAxisFeature discriminates by mode', () => {
    const a: WorkAxisFeature = {
      kind: 'workAxis', id: 'WA1', visible: true,
      source: { mode: 'origin', axis: 'X' },
    };
    expect(a.kind).toBe('workAxis');
  });

  it('WorkPlaneFeature offsetFromPlane has offset param', () => {
    const p: WorkPlaneFeature = {
      kind: 'workPlane', id: 'WP1', visible: true,
      source: {
        mode: 'offsetFromPlane',
        plane: { source: 'workPlane', featureId: 'origin.XY' },
        offset: { kind: 'literal', value: 10 },
      },
    };
    if (p.source.mode === 'offsetFromPlane') {
      expect(p.source.offset.kind).toBe('literal');
    }
  });

  it('WorkPointFeature midpointOfEdge has edge ref', () => {
    const pt: WorkPointFeature = {
      kind: 'workPoint', id: 'WPT1', visible: true,
      source: {
        mode: 'midpointOfEdge',
        edge: { faceA: { featureId: 'E1', role: 'top' }, faceB: { featureId: 'E1', role: 'side' } },
      },
    };
    expect(pt.source.mode).toBe('midpointOfEdge');
  });

  it('Feature union includes all three new kinds', () => {
    const f1: Feature = { kind: 'workAxis', id: 'a', visible: true, source: { mode: 'origin', axis: 'Y' } };
    const f2: Feature = { kind: 'workPlane', id: 'p', visible: true, source: { mode: 'origin', plane: 'XZ' } };
    const f3: Feature = { kind: 'workPoint', id: 'q', visible: true, source: { mode: 'origin' } };
    expect([f1.kind, f2.kind, f3.kind]).toEqual(['workAxis', 'workPlane', 'workPoint']);
  });
});

describe('SketchFeature.plane is a WorkPlaneRef', () => {
  it('accepts a workPlane reference', () => {
    const f: Feature = {
      kind: 'sketch', id: 'S1',
      plane: { source: 'workPlane', featureId: 'origin.XY' },
      primitives: [], constraints: [],
    };
    if (f.kind === 'sketch' && f.plane.source === 'workPlane') {
      expect(f.plane.featureId).toBe('origin.XY');
    }
  });

  it('accepts a face reference', () => {
    const f: Feature = {
      kind: 'sketch', id: 'S2',
      plane: { source: 'face', face: { featureId: 'E1', role: 'top' } },
      primitives: [], constraints: [],
    };
    if (f.kind === 'sketch' && f.plane.source === 'face') {
      expect(f.plane.face.role).toBe('top');
    }
  });
});
