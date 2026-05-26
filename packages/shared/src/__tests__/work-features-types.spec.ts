import { describe, it, expect } from 'vitest';
import type {
  WorkAxisFeature, WorkPlaneFeature, WorkPointFeature,
  Feature,
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

import type { WorkFeatureValue, Vec3 } from '../types';

describe('WorkFeatureValue', () => {
  it('discriminates axis | plane | point', () => {
    const a: WorkFeatureValue = { featureId: 'WA1', kind: 'axis', origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } };
    const p: WorkFeatureValue = { featureId: 'WP1', kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } };
    const pt: WorkFeatureValue = { featureId: 'WPT1', kind: 'point', position: { x: 0, y: 0, z: 0 } };
    expect([a.kind, p.kind, pt.kind]).toEqual(['axis', 'plane', 'point']);
  });

  it('Vec3 is { x, y, z }', () => {
    const v: Vec3 = { x: 1, y: 2, z: 3 };
    expect(v).toEqual({ x: 1, y: 2, z: 3 });
  });
});
