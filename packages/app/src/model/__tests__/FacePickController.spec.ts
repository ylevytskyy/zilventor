import { describe, it, expect } from 'vitest';
import { FacePickController } from '../FacePickController';
import type { TessellatedFace } from '@zilventor/shared';

const face = (
  role: string,
  start: number,
  count: number
): TessellatedFace => ({
  name: { featureId: 'E1', role, instance: 0 },
  triangleStart: start,
  triangleCount: count,
});

describe('FacePickController', () => {
  it('returns the face name whose range contains the triangle index', () => {
    const ctrl = new FacePickController();
    ctrl.setCandidates([
      face('top', 0, 2),
      face('bottom', 2, 2),
      face('side', 4, 8),
    ]);
    expect(ctrl.pickByTriangleIndex(0)?.role).toBe('top');
    expect(ctrl.pickByTriangleIndex(1)?.role).toBe('top');
    expect(ctrl.pickByTriangleIndex(2)?.role).toBe('bottom');
    expect(ctrl.pickByTriangleIndex(3)?.role).toBe('bottom');
    expect(ctrl.pickByTriangleIndex(11)?.role).toBe('side');
  });

  it('returns null for indices outside every known range', () => {
    const ctrl = new FacePickController();
    ctrl.setCandidates([face('top', 0, 2), face('bottom', 2, 2)]);
    expect(ctrl.pickByTriangleIndex(100)).toBe(null);
  });

  it('returns null when candidates is empty', () => {
    const ctrl = new FacePickController();
    expect(ctrl.pickByTriangleIndex(0)).toBe(null);
  });

  it('sorts unsorted input so binary search remains correct', () => {
    const ctrl = new FacePickController();
    ctrl.setCandidates([
      face('side', 4, 8),
      face('top', 0, 2),
      face('bottom', 2, 2),
    ]);
    expect(ctrl.pickByTriangleIndex(1)?.role).toBe('top');
    expect(ctrl.pickByTriangleIndex(11)?.role).toBe('side');
  });
});
