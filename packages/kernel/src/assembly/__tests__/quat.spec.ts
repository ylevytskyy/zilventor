import { describe, it, expect } from 'vitest';
import { quatRotateVec, quatMultiply, quatNormalize, quatRotateVecJacobian, quatFromEulerXYZ, quatToEulerXYZ } from '../quat';

describe('quatRotateVec', () => {
  it('identity quaternion is no-op', () => {
    const v = quatRotateVec([0, 0, 0, 1], { x: 1, y: 2, z: 3 });
    expect(v.x).toBeCloseTo(1, 12);
    expect(v.y).toBeCloseTo(2, 12);
    expect(v.z).toBeCloseTo(3, 12);
  });
  it('rotates +X 90deg around Z onto +Y', () => {
    const s = Math.sin(Math.PI / 4); const c = Math.cos(Math.PI / 4);
    const v = quatRotateVec([0, 0, s, c], { x: 1, y: 0, z: 0 });
    expect(v.x).toBeCloseTo(0, 9);
    expect(v.y).toBeCloseTo(1, 9);
    expect(v.z).toBeCloseTo(0, 9);
  });
});

describe('quatMultiply', () => {
  it('q * identity = q', () => {
    const q: [number, number, number, number] = [0.1, 0.2, 0.3, 0.927];
    const out = quatMultiply(q, [0, 0, 0, 1]);
    expect(out[0]).toBeCloseTo(q[0], 12);
    expect(out[3]).toBeCloseTo(q[3], 12);
  });
});

describe('quatNormalize', () => {
  it('rescales to unit norm', () => {
    const out = quatNormalize([2, 0, 0, 0]);
    expect(out).toEqual([1, 0, 0, 0]);
  });
});

describe('quatRotateVecJacobian', () => {
  it('matches finite difference for identity quaternion', () => {
    const q: [number, number, number, number] = [0, 0, 0, 1];
    const v = { x: 1, y: 2, z: 3 };
    const J = quatRotateVecJacobian(q, v);  // 3x4
    const eps = 1e-6;
    for (let k = 0; k < 4; k++) {
      const qp = q.slice() as [number, number, number, number];
      const qm = q.slice() as [number, number, number, number];
      (qp as number[])[k] = (qp as number[])[k]! + eps;
      (qm as number[])[k] = (qm as number[])[k]! - eps;
      const vp = quatRotateVec(qp, v);
      const vm = quatRotateVec(qm, v);
      const fd: [number, number, number] = [
        (vp.x - vm.x) / (2 * eps),
        (vp.y - vm.y) / (2 * eps),
        (vp.z - vm.z) / (2 * eps),
      ];
      expect(J[0]![k]!).toBeCloseTo(fd[0], 6);
      expect(J[1]![k]!).toBeCloseTo(fd[1], 6);
      expect(J[2]![k]!).toBeCloseTo(fd[2], 6);
    }
  });
});

describe('quatFromEulerXYZ / quatToEulerXYZ round trip', () => {
  it('identity', () => {
    const q = quatFromEulerXYZ(0, 0, 0);
    expect(q[3]).toBeCloseTo(1, 12);
  });
  it('round-trips a non-trivial rotation', () => {
    const q = quatFromEulerXYZ(30, -45, 60);
    const e = quatToEulerXYZ(q);
    const q2 = quatFromEulerXYZ(e.rx, e.ry, e.rz);
    expect(q2[0]).toBeCloseTo(q[0], 6);
    expect(q2[1]).toBeCloseTo(q[1], 6);
    expect(q2[2]).toBeCloseTo(q[2], 6);
    expect(q2[3]).toBeCloseTo(q[3], 6);
  });
});
