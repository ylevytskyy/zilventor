import { describe, it, expect } from 'vitest';
import { boreGizmoAxis } from '../boreGizmoAxis';
import type { BoreOp } from '../bore';

const base = (kind: BoreOp['connectorKind'], extra: Partial<BoreOp> = {}): BoreOp => ({
  id: 'b1', face: { featureId: 'panel', role: 'Top', instance: 0 },
  u: 10, v: 10, diameter: 5, depth: 12, role: 'carcass-a',
  connectorId: 'c1', connectorKind: kind, ...extra,
} as BoreOp);

const IDENTITY_QUAT: [number, number, number, number] = [0, 0, 0, 1];

describe('boreGizmoAxis', () => {
  it('returns jointDir for carcass kinds', () => {
    const jd = { x: 0, y: 0, z: 1 };
    for (const k of ['confirmat', 'minifix', 'dowel'] as const) {
      expect(boreGizmoAxis(base(k, { jointDir: jd }), IDENTITY_QUAT)).toEqual(jd);
    }
  });

  it('returns the cup u-axis (rotated {1,0,0}) for hinge', () => {
    // identity quat → {1,0,0} unchanged
    expect(boreGizmoAxis(base('hinge'), IDENTITY_QUAT)).toEqual({ x: 1, y: 0, z: 0 });
  });

  it('returns null for out-of-scope kinds', () => {
    expect(boreGizmoAxis(base('shelfPin'), IDENTITY_QUAT)).toBeNull();
    expect(boreGizmoAxis(base('drawerSlide'), IDENTITY_QUAT)).toBeNull();
  });

  it('returns null for carcass without jointDir', () => {
    expect(boreGizmoAxis(base('confirmat'), IDENTITY_QUAT)).toBeNull();
  });
});
