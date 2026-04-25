import { describe, it, expect } from 'vitest';
import { dot, cross, sub, add, scale, normalize, length } from '../WorkFeatureOps';
import type { Vec3 } from '@zilventor/shared';

describe('Vec3 helpers', () => {
  it('dot product', () => {
    expect(dot({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 })).toBe(32);
  });

  it('cross product', () => {
    expect(cross({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('cross product is anti-commutative', () => {
    const a: Vec3 = { x: 1, y: 2, z: 3 };
    const b: Vec3 = { x: 4, y: 5, z: 6 };
    const ab = cross(a, b);
    const ba = cross(b, a);
    expect(ab).toEqual({ x: -ba.x, y: -ba.y, z: -ba.z });
  });

  it('subtract', () => {
    expect(sub({ x: 5, y: 5, z: 5 }, { x: 1, y: 2, z: 3 })).toEqual({ x: 4, y: 3, z: 2 });
  });

  it('add', () => {
    expect(add({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 })).toEqual({ x: 5, y: 7, z: 9 });
  });

  it('scale', () => {
    expect(scale({ x: 1, y: 2, z: 3 }, 2)).toEqual({ x: 2, y: 4, z: 6 });
  });

  it('normalize unit vector', () => {
    const n = normalize({ x: 3, y: 0, z: 0 });
    expect(n.x).toBeCloseTo(1, 5);
    expect(n.y).toBeCloseTo(0, 5);
    expect(n.z).toBeCloseTo(0, 5);
  });

  it('normalize returns zero for near-zero input', () => {
    const n = normalize({ x: 0, y: 0, z: 0 });
    expect(n).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('length', () => {
    expect(length({ x: 3, y: 4, z: 0 })).toBeCloseTo(5, 5);
  });
});

import { evaluateWorkAxis, evaluateWorkPlane, evaluateWorkPoint, resolveWorkAxisRef, resolveWorkPlaneRef, resolveWorkPointRef } from '../WorkFeatureOps';
import type { WorkFeatureValue } from '@zilventor/shared';
import type { OcctInstance } from '../occtLoader';

const occtStub = null as unknown as OcctInstance;

describe('evaluateWorkAxis origin', () => {
  it('axis X returns origin (0,0,0) direction (1,0,0)', () => {
    const r = evaluateWorkAxis(occtStub, null, { mode: 'origin', axis: 'X' }, new Map());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } });
  });

  it.each([
    ['Y', { x: 0, y: 1, z: 0 }],
    ['Z', { x: 0, y: 0, z: 1 }],
  ] as const)('axis %s direction is %j', (axis, expected) => {
    const r = evaluateWorkAxis(occtStub, null, { mode: 'origin', axis }, new Map());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.direction).toEqual(expected);
  });
});

describe('evaluateWorkPlane origin', () => {
  it.each([
    ['XY', { x: 0, y: 0, z: 1 }],
    ['YZ', { x: 1, y: 0, z: 0 }],
    ['XZ', { x: 0, y: 1, z: 0 }],
  ] as const)('plane %s normal is %j', (plane, expected) => {
    const r = evaluateWorkPlane(occtStub, null, { mode: 'origin', plane }, new Map(), {});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.origin).toEqual({ x: 0, y: 0, z: 0 });
      expect(r.value.normal).toEqual(expected);
    }
  });
});

describe('evaluateWorkPoint origin', () => {
  it('returns position (0,0,0)', () => {
    const r = evaluateWorkPoint(occtStub, null, { mode: 'origin' }, new Map());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.position).toEqual({ x: 0, y: 0, z: 0 });
  });
});


describe('resolveWorkPlaneRef', () => {
  it('resolves a workPlane reference from the cache', () => {
    const wfs = new Map<string, WorkFeatureValue>([
      ['origin.XY', { featureId: 'origin.XY', kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } }],
    ]);
    const r = resolveWorkPlaneRef({ source: 'workPlane', featureId: 'origin.XY' }, occtStub, null, wfs);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.origin).toEqual({ x: 0, y: 0, z: 0 });
      expect(r.value.normal).toEqual({ x: 0, y: 0, z: 1 });
    }
  });

  it('returns featureNotFound when work plane is missing', () => {
    const r = resolveWorkPlaneRef({ source: 'workPlane', featureId: 'missing' }, occtStub, null, new Map());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('featureNotFound');
  });

  it('returns notImplemented for face source (Task 14)', () => {
    const r = resolveWorkPlaneRef({ source: 'face', face: { featureId: 'X', role: 'top' } }, occtStub, null, new Map());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('notImplemented');
  });
});

describe('resolveWorkAxisRef', () => {
  it('resolves a workAxis reference from the cache', () => {
    const wfs = new Map<string, WorkFeatureValue>([
      ['WA1', { featureId: 'WA1', kind: 'axis', origin: { x: 1, y: 2, z: 3 }, direction: { x: 0, y: 0, z: 1 } }],
    ]);
    const r = resolveWorkAxisRef({ source: 'workAxis', featureId: 'WA1' }, occtStub, null, wfs);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.origin).toEqual({ x: 1, y: 2, z: 3 });
      expect(r.value.direction).toEqual({ x: 0, y: 0, z: 1 });
    }
  });

  it('returns featureNotFound when missing', () => {
    const r = resolveWorkAxisRef({ source: 'workAxis', featureId: 'no' }, occtStub, null, new Map());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('featureNotFound');
  });
});

describe('resolveWorkPointRef', () => {
  it('resolves a workPoint reference', () => {
    const wfs = new Map<string, WorkFeatureValue>([
      ['origin.O', { featureId: 'origin.O', kind: 'point', position: { x: 0, y: 0, z: 0 } }],
    ]);
    const r = resolveWorkPointRef({ source: 'workPoint', featureId: 'origin.O' }, occtStub, null, wfs);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.position).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('returns featureNotFound when missing', () => {
    const r = resolveWorkPointRef({ source: 'workPoint', featureId: 'missing' }, occtStub, null, new Map());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('featureNotFound');
  });
});

describe('evaluateWorkAxis non-OCCT modes', () => {
  it('twoPoints: origin → (10,0,0) ⇒ axis at origin direction +X', () => {
    const wfs = new Map<string, WorkFeatureValue>([
      ['origin.O', { featureId: 'origin.O', kind: 'point', position: { x: 0, y: 0, z: 0 } }],
      ['P1', { featureId: 'P1', kind: 'point', position: { x: 10, y: 0, z: 0 } }],
    ]);
    const r = evaluateWorkAxis(occtStub, null, {
      mode: 'twoPoints',
      pointA: { source: 'workPoint', featureId: 'origin.O' },
      pointB: { source: 'workPoint', featureId: 'P1' },
    }, wfs);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.origin).toEqual({ x: 0, y: 0, z: 0 });
      expect(r.value.direction.x).toBeCloseTo(1, 5);
      expect(r.value.direction.y).toBeCloseTo(0, 5);
      expect(r.value.direction.z).toBeCloseTo(0, 5);
    }
  });

  it('twoPoints: propagates featureNotFound when one point is missing', () => {
    const wfs = new Map<string, WorkFeatureValue>([
      ['origin.O', { featureId: 'origin.O', kind: 'point', position: { x: 0, y: 0, z: 0 } }],
    ]);
    const r = evaluateWorkAxis(occtStub, null, {
      mode: 'twoPoints',
      pointA: { source: 'workPoint', featureId: 'origin.O' },
      pointB: { source: 'workPoint', featureId: 'missing' },
    }, wfs);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('featureNotFound');
  });

  it('normalToPlaneThroughPoint: XY through (3,4,0) ⇒ axis up at (3,4,0)', () => {
    const wfs = new Map<string, WorkFeatureValue>([
      ['origin.XY', { featureId: 'origin.XY', kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } }],
      ['P', { featureId: 'P', kind: 'point', position: { x: 3, y: 4, z: 0 } }],
    ]);
    const r = evaluateWorkAxis(occtStub, null, {
      mode: 'normalToPlaneThroughPoint',
      plane: { source: 'workPlane', featureId: 'origin.XY' },
      point: { source: 'workPoint', featureId: 'P' },
    }, wfs);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.origin).toEqual({ x: 3, y: 4, z: 0 });
      expect(r.value.direction.x).toBeCloseTo(0, 5);
      expect(r.value.direction.y).toBeCloseTo(0, 5);
      expect(r.value.direction.z).toBeCloseTo(1, 5);
    }
  });

  it('twoPlanes: XY ∩ XZ ⇒ direction along ±X', () => {
    const wfs = new Map<string, WorkFeatureValue>([
      ['origin.XY', { featureId: 'origin.XY', kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } }],
      ['origin.XZ', { featureId: 'origin.XZ', kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } }],
    ]);
    const r = evaluateWorkAxis(occtStub, null, {
      mode: 'twoPlanes',
      planeA: { source: 'workPlane', featureId: 'origin.XY' },
      planeB: { source: 'workPlane', featureId: 'origin.XZ' },
    }, wfs);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Math.abs(r.value.direction.x)).toBeCloseTo(1, 5);
      expect(r.value.direction.y).toBeCloseTo(0, 5);
      expect(r.value.direction.z).toBeCloseTo(0, 5);
    }
  });

  it('twoPlanes: parallel planes return invalidGeometry', () => {
    const wfs = new Map<string, WorkFeatureValue>([
      ['A', { featureId: 'A', kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } }],
      ['B', { featureId: 'B', kind: 'plane', origin: { x: 0, y: 0, z: 5 }, normal: { x: 0, y: 0, z: 1 } }],
    ]);
    const r = evaluateWorkAxis(occtStub, null, {
      mode: 'twoPlanes',
      planeA: { source: 'workPlane', featureId: 'A' },
      planeB: { source: 'workPlane', featureId: 'B' },
    }, wfs);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('invalidGeometry');
  });
});

import type { SketchParameter } from '@zilventor/shared';

const noParams: Record<string, SketchParameter> = {};

describe('evaluateWorkPlane non-OCCT modes', () => {
  it('offsetFromPlane: XY + 10mm ⇒ origin (0,0,10) normal (0,0,1)', () => {
    const wfs = new Map<string, WorkFeatureValue>([
      ['origin.XY', { featureId: 'origin.XY', kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } }],
    ]);
    const r = evaluateWorkPlane(occtStub, null, {
      mode: 'offsetFromPlane',
      plane: { source: 'workPlane', featureId: 'origin.XY' },
      offset: { kind: 'literal', value: 10 },
    }, wfs, noParams);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.origin.z).toBeCloseTo(10, 5);
      expect(r.value.normal.z).toBeCloseTo(1, 5);
    }
  });

  it('offsetFromPlane: param-driven offset reads from params map', () => {
    const wfs = new Map<string, WorkFeatureValue>([
      ['origin.XY', { featureId: 'origin.XY', kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } }],
    ]);
    const params: Record<string, SketchParameter> = {
      d0: { name: 'd0', expression: '25', value: 25, unit: 'mm' },
    };
    const r = evaluateWorkPlane(occtStub, null, {
      mode: 'offsetFromPlane',
      plane: { source: 'workPlane', featureId: 'origin.XY' },
      offset: { kind: 'param', paramName: 'd0' },
    }, wfs, params);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.origin.z).toBeCloseTo(25, 5);
  });

  it('threePoints: (0,0,0) (1,0,0) (0,1,0) ⇒ normal +Z', () => {
    const wfs = new Map<string, WorkFeatureValue>([
      ['A', { featureId: 'A', kind: 'point', position: { x: 0, y: 0, z: 0 } }],
      ['B', { featureId: 'B', kind: 'point', position: { x: 1, y: 0, z: 0 } }],
      ['C', { featureId: 'C', kind: 'point', position: { x: 0, y: 1, z: 0 } }],
    ]);
    const r = evaluateWorkPlane(occtStub, null, {
      mode: 'threePoints',
      points: [
        { source: 'workPoint', featureId: 'A' },
        { source: 'workPoint', featureId: 'B' },
        { source: 'workPoint', featureId: 'C' },
      ],
    }, wfs, noParams);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.normal.z).toBeCloseTo(1, 5);
  });

  it('threePoints: collinear inputs return invalidGeometry', () => {
    const wfs = new Map<string, WorkFeatureValue>([
      ['A', { featureId: 'A', kind: 'point', position: { x: 0, y: 0, z: 0 } }],
      ['B', { featureId: 'B', kind: 'point', position: { x: 1, y: 0, z: 0 } }],
      ['C', { featureId: 'C', kind: 'point', position: { x: 2, y: 0, z: 0 } }],
    ]);
    const r = evaluateWorkPlane(occtStub, null, {
      mode: 'threePoints',
      points: [
        { source: 'workPoint', featureId: 'A' },
        { source: 'workPoint', featureId: 'B' },
        { source: 'workPoint', featureId: 'C' },
      ],
    }, wfs, noParams);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('invalidGeometry');
  });

  it('midplane: parallel XY at z=0 + z=10 ⇒ plane at z=5', () => {
    const wfs = new Map<string, WorkFeatureValue>([
      ['P0', { featureId: 'P0', kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } }],
      ['P1', { featureId: 'P1', kind: 'plane', origin: { x: 0, y: 0, z: 10 }, normal: { x: 0, y: 0, z: 1 } }],
    ]);
    const r = evaluateWorkPlane(occtStub, null, {
      mode: 'midplane',
      planeA: { source: 'workPlane', featureId: 'P0' },
      planeB: { source: 'workPlane', featureId: 'P1' },
    }, wfs, noParams);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.origin.z).toBeCloseTo(5, 5);
  });

  it('midplane: non-parallel input planes return invalidGeometry', () => {
    const wfs = new Map<string, WorkFeatureValue>([
      ['xy', { featureId: 'xy', kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } }],
      ['yz', { featureId: 'yz', kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } }],
    ]);
    const r = evaluateWorkPlane(occtStub, null, {
      mode: 'midplane',
      planeA: { source: 'workPlane', featureId: 'xy' },
      planeB: { source: 'workPlane', featureId: 'yz' },
    }, wfs, noParams);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('invalidGeometry');
  });

  it('axisPerpendicularToPlane: X-axis + XY ⇒ plane normal ±Y', () => {
    const wfs = new Map<string, WorkFeatureValue>([
      ['ax', { featureId: 'ax', kind: 'axis', origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }],
      ['xy', { featureId: 'xy', kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } }],
    ]);
    const r = evaluateWorkPlane(occtStub, null, {
      mode: 'axisPerpendicularToPlane',
      axis: { source: 'workAxis', featureId: 'ax' },
      plane: { source: 'workPlane', featureId: 'xy' },
    }, wfs, noParams);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Math.abs(r.value.normal.y)).toBeCloseTo(1, 5);
      expect(r.value.normal.x).toBeCloseTo(0, 5);
      expect(r.value.normal.z).toBeCloseTo(0, 5);
    }
  });

  it('axisAtAngleToPlane: 90° rotation of XY normal about X-axis ⇒ normal ±Y', () => {
    const wfs = new Map<string, WorkFeatureValue>([
      ['ax', { featureId: 'ax', kind: 'axis', origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }],
      ['xy', { featureId: 'xy', kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } }],
    ]);
    const r = evaluateWorkPlane(occtStub, null, {
      mode: 'axisAtAngleToPlane',
      axis: { source: 'workAxis', featureId: 'ax' },
      plane: { source: 'workPlane', featureId: 'xy' },
      angle: { kind: 'literal', value: 90 },
    }, wfs, noParams);
    expect(r.ok).toBe(true);
    if (r.ok) expect(Math.abs(r.value.normal.y)).toBeCloseTo(1, 5);
  });
});
