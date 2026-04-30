import { describe, expect, it } from 'vitest';
import { transformPartLocalGeometry } from '../transformPartLocalGeometry';
import type { Pose } from '../walkers/flattenForSolver';

const IDENTITY: Pose = { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] };

describe('transformPartLocalGeometry', () => {
  it('identity pose leaves a plane geometry unchanged', () => {
    const r = transformPartLocalGeometry(
      { kind: 'plane', P: { x: 1, y: 2, z: 3 }, N: { x: 0, y: 0, z: 1 } },
      IDENTITY,
    );
    expect(r).toEqual({ kind: 'plane', P: { x: 1, y: 2, z: 3 }, N: { x: 0, y: 0, z: 1 } });
  });

  it('translation-only pose offsets the point but leaves the normal unchanged', () => {
    const r = transformPartLocalGeometry(
      { kind: 'plane', P: { x: 1, y: 2, z: 3 }, N: { x: 0, y: 0, z: 1 } },
      { translation: { x: 10, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] },
    );
    expect(r.kind).toBe('plane');
    if (r.kind === 'plane') {
      expect(r.P).toEqual({ x: 11, y: 2, z: 3 });
      expect(r.N).toEqual({ x: 0, y: 0, z: 1 });
    }
  });

  it('rotates an axis direction by the pose quaternion (90deg about Z swaps X→Y)', () => {
    const halfPi = Math.SQRT1_2;
    const r = transformPartLocalGeometry(
      { kind: 'axis', P: { x: 1, y: 0, z: 0 }, D: { x: 1, y: 0, z: 0 } },
      { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, halfPi, halfPi] },
    );
    expect(r.kind).toBe('axis');
    if (r.kind === 'axis') {
      expect(r.D.x).toBeCloseTo(0);
      expect(r.D.y).toBeCloseTo(1);
      expect(r.D.z).toBeCloseTo(0);
      expect(r.P.x).toBeCloseTo(0);
      expect(r.P.y).toBeCloseTo(1);
      expect(r.P.z).toBeCloseTo(0);
    }
  });

  it('transforms a circularEdge with all four vectors', () => {
    const r = transformPartLocalGeometry(
      {
        kind: 'circularEdge',
        axisP: { x: 1, y: 0, z: 0 }, axisD: { x: 0, y: 0, z: 1 },
        planeP: { x: 1, y: 0, z: 0 }, planeN: { x: 0, y: 0, z: 1 },
      },
      { translation: { x: 5, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] },
    );
    expect(r.kind).toBe('circularEdge');
    if (r.kind === 'circularEdge') {
      expect(r.axisP).toEqual({ x: 6, y: 0, z: 0 });
      expect(r.axisD).toEqual({ x: 0, y: 0, z: 1 });
      expect(r.planeP).toEqual({ x: 6, y: 0, z: 0 });
      expect(r.planeN).toEqual({ x: 0, y: 0, z: 1 });
    }
  });

  it('transforms a point geometry by translating P only', () => {
    const r = transformPartLocalGeometry(
      { kind: 'point', P: { x: 1, y: 2, z: 3 } },
      { translation: { x: 0, y: 10, z: 0 }, quaternion: [0, 0, 0, 1] },
    );
    expect(r.kind).toBe('point');
    if (r.kind === 'point') expect(r.P).toEqual({ x: 1, y: 12, z: 3 });
  });
});
