import { describe, it, expect } from 'vitest';
import { type Quat } from '../quat';
import {
  type WorldRefGeom, worldFromLocal,
  buildMateFaceFaceResiduals, buildMateFaceFaceJacobian,
  buildMateAxisAxisResiduals, buildMateAxisAxisJacobian,
  buildMatePointPointResiduals, buildMatePointPointJacobian,
  buildMatePointFaceResiduals, buildMatePointFaceJacobian,
  buildMatePointAxisResiduals, buildMatePointAxisJacobian,
  buildFlushFaceFaceResiduals, buildFlushFaceFaceJacobian,
  buildAngleResiduals, buildAngleJacobian,
  buildInsertResiduals, buildInsertJacobian,
} from '../Residuals';

function randomPose(): { T: { x: number; y: number; z: number }; q: Quat } {
  const r = () => Math.random() - 0.5;
  const T = { x: r() * 10, y: r() * 10, z: r() * 10 };
  const v = [r(), r(), r(), r()] as Quat;
  const n = Math.sqrt(v[0]! ** 2 + v[1]! ** 2 + v[2]! ** 2 + v[3]! ** 2);
  return { T, q: [v[0]! / n, v[1]! / n, v[2]! / n, v[3]! / n] };
}

function fdJacobian(
  buildResid: (xa: number[], xb: number[]) => number[],
  xa: number[], xb: number[],
): number[][] {
  const eps = 1e-6;
  const r0 = buildResid(xa, xb);
  const J: number[][] = [];
  for (let row = 0; row < r0.length; row++) J.push(new Array(14).fill(0));
  for (let k = 0; k < 7; k++) {
    for (const side of ['a', 'b'] as const) {
      const xp = side === 'a' ? xa.slice() : xb.slice();
      xp[k]! += eps;
      const xm = side === 'a' ? xa.slice() : xb.slice();
      xm[k]! -= eps;
      const rp = side === 'a' ? buildResid(xp, xb) : buildResid(xa, xp);
      const rm = side === 'a' ? buildResid(xm, xb) : buildResid(xa, xm);
      const col = side === 'a' ? k : k + 7;
      for (let row = 0; row < r0.length; row++) {
        J[row]![col] = (rp[row]! - rm[row]!) / (2 * eps);
      }
    }
  }
  return J;
}

describe('worldFromLocal', () => {
  it('plane: rotates normal, transforms point', () => {
    const local: WorldRefGeom = { kind: 'plane', P: { x: 1, y: 0, z: 0 }, N: { x: 0, y: 0, z: 1 } };
    const T = { x: 5, y: 5, z: 5 };
    const q: Quat = [0, 0, 0, 1];
    const w = worldFromLocal(local, T, q);
    expect(w.kind).toBe('plane');
    if (w.kind === 'plane') {
      expect(w.P.x).toBe(6); expect(w.N.z).toBe(1);
    }
  });
});

describe('mate face↔face', () => {
  const localA: WorldRefGeom = { kind: 'plane', P: { x: 0, y: 0, z: 0 }, N: { x: 0, y: 0, z: 1 } };
  const localB: WorldRefGeom = { kind: 'plane', P: { x: 0, y: 0, z: 0 }, N: { x: 0, y: 0, z: 1 } };

  it('residual is 3 scalars', () => {
    const r = buildMateFaceFaceResiduals(localA, localB,
      { x: 0, y: 0, z: 0 }, [0, 0, 0, 1],
      { x: 0, y: 0, z: 0 }, [0, 0, 0, 1], 0);
    expect(r).toHaveLength(3);
  });

  it('analytic Jacobian matches finite difference', () => {
    const pa = randomPose(); const pb = randomPose();
    const xa = [pa.T.x, pa.T.y, pa.T.z, ...pa.q];
    const xb = [pb.T.x, pb.T.y, pb.T.z, ...pb.q];
    const buildResid = (xa: number[], xb: number[]) =>
      buildMateFaceFaceResiduals(localA, localB,
        { x: xa[0]!, y: xa[1]!, z: xa[2]! }, [xa[3]!, xa[4]!, xa[5]!, xa[6]!] as Quat,
        { x: xb[0]!, y: xb[1]!, z: xb[2]! }, [xb[3]!, xb[4]!, xb[5]!, xb[6]!] as Quat, 5);
    const Jfd = fdJacobian(buildResid, xa, xb);
    const Jan = buildMateFaceFaceJacobian(localA, localB,
      { x: xa[0]!, y: xa[1]!, z: xa[2]! }, [xa[3]!, xa[4]!, xa[5]!, xa[6]!] as Quat,
      { x: xb[0]!, y: xb[1]!, z: xb[2]! }, [xb[3]!, xb[4]!, xb[5]!, xb[6]!] as Quat, 5);
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 14; c++)
        expect(Jan[r]![c]!).toBeCloseTo(Jfd[r]![c]!, 5);
  });
});

describe('mate axis↔axis', () => {
  const localA: WorldRefGeom = { kind: 'axis', P: { x: 0, y: 0, z: 0 }, D: { x: 0, y: 0, z: 1 } };
  const localB: WorldRefGeom = { kind: 'axis', P: { x: 0, y: 0, z: 0 }, D: { x: 0, y: 0, z: 1 } };

  it('residual is 4 scalars', () => {
    const r = buildMateAxisAxisResiduals(localA, localB,
      { x: 0, y: 0, z: 0 }, [0, 0, 0, 1],
      { x: 0, y: 0, z: 0 }, [0, 0, 0, 1], 0);
    expect(r).toHaveLength(4);
  });

  it('analytic Jacobian matches finite difference', () => {
    const pa = randomPose(); const pb = randomPose();
    const xa = [pa.T.x, pa.T.y, pa.T.z, ...pa.q];
    const xb = [pb.T.x, pb.T.y, pb.T.z, ...pb.q];
    const buildResid = (xa: number[], xb: number[]) =>
      buildMateAxisAxisResiduals(localA, localB,
        { x: xa[0]!, y: xa[1]!, z: xa[2]! }, [xa[3]!, xa[4]!, xa[5]!, xa[6]!] as Quat,
        { x: xb[0]!, y: xb[1]!, z: xb[2]! }, [xb[3]!, xb[4]!, xb[5]!, xb[6]!] as Quat, 0);
    const Jfd = fdJacobian(buildResid, xa, xb);
    const Jan = buildMateAxisAxisJacobian(localA, localB,
      { x: xa[0]!, y: xa[1]!, z: xa[2]! }, [xa[3]!, xa[4]!, xa[5]!, xa[6]!] as Quat,
      { x: xb[0]!, y: xb[1]!, z: xb[2]! }, [xb[3]!, xb[4]!, xb[5]!, xb[6]!] as Quat, 0);
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 14; c++)
        expect(Jan[r]![c]!).toBeCloseTo(Jfd[r]![c]!, 5);
  });
});

describe('mate point↔point', () => {
  const localA: WorldRefGeom = { kind: 'point', P: { x: 0, y: 0, z: 0 } };
  const localB: WorldRefGeom = { kind: 'point', P: { x: 1, y: 0, z: 0 } };

  it('residual is 3 scalars', () => {
    const r = buildMatePointPointResiduals(localA, localB,
      { x: 0, y: 0, z: 0 }, [0, 0, 0, 1],
      { x: 0, y: 0, z: 0 }, [0, 0, 0, 1]);
    expect(r).toHaveLength(3);
  });

  it('analytic Jacobian matches finite difference', () => {
    const pa = randomPose(); const pb = randomPose();
    const xa = [pa.T.x, pa.T.y, pa.T.z, ...pa.q];
    const xb = [pb.T.x, pb.T.y, pb.T.z, ...pb.q];
    const buildResid = (xa: number[], xb: number[]) =>
      buildMatePointPointResiduals(localA, localB,
        { x: xa[0]!, y: xa[1]!, z: xa[2]! }, [xa[3]!, xa[4]!, xa[5]!, xa[6]!] as Quat,
        { x: xb[0]!, y: xb[1]!, z: xb[2]! }, [xb[3]!, xb[4]!, xb[5]!, xb[6]!] as Quat);
    const Jfd = fdJacobian(buildResid, xa, xb);
    const Jan = buildMatePointPointJacobian(localA, localB,
      { x: xa[0]!, y: xa[1]!, z: xa[2]! }, [xa[3]!, xa[4]!, xa[5]!, xa[6]!] as Quat,
      { x: xb[0]!, y: xb[1]!, z: xb[2]! }, [xb[3]!, xb[4]!, xb[5]!, xb[6]!] as Quat);
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 14; c++)
        expect(Jan[r]![c]!).toBeCloseTo(Jfd[r]![c]!, 5);
  });
});

describe('mate point↔face', () => {
  const localA: WorldRefGeom = { kind: 'point', P: { x: 0, y: 0, z: 0 } };
  const localB: WorldRefGeom = { kind: 'plane', P: { x: 0, y: 0, z: 0 }, N: { x: 0, y: 0, z: 1 } };

  it('residual is 1 scalar', () => {
    const r = buildMatePointFaceResiduals(localA, localB,
      { x: 0, y: 0, z: 0 }, [0, 0, 0, 1],
      { x: 0, y: 0, z: 0 }, [0, 0, 0, 1]);
    expect(r).toHaveLength(1);
  });

  it('analytic Jacobian matches finite difference', () => {
    const pa = randomPose(); const pb = randomPose();
    const xa = [pa.T.x, pa.T.y, pa.T.z, ...pa.q];
    const xb = [pb.T.x, pb.T.y, pb.T.z, ...pb.q];
    const buildResid = (xa: number[], xb: number[]) =>
      buildMatePointFaceResiduals(localA, localB,
        { x: xa[0]!, y: xa[1]!, z: xa[2]! }, [xa[3]!, xa[4]!, xa[5]!, xa[6]!] as Quat,
        { x: xb[0]!, y: xb[1]!, z: xb[2]! }, [xb[3]!, xb[4]!, xb[5]!, xb[6]!] as Quat);
    const Jfd = fdJacobian(buildResid, xa, xb);
    const Jan = buildMatePointFaceJacobian(localA, localB,
      { x: xa[0]!, y: xa[1]!, z: xa[2]! }, [xa[3]!, xa[4]!, xa[5]!, xa[6]!] as Quat,
      { x: xb[0]!, y: xb[1]!, z: xb[2]! }, [xb[3]!, xb[4]!, xb[5]!, xb[6]!] as Quat);
    for (let c = 0; c < 14; c++)
      expect(Jan[0]![c]!).toBeCloseTo(Jfd[0]![c]!, 5);
  });
});

describe('mate point↔axis', () => {
  const localA: WorldRefGeom = { kind: 'point', P: { x: 1, y: 0, z: 0 } };
  const localB: WorldRefGeom = { kind: 'axis', P: { x: 0, y: 0, z: 0 }, D: { x: 0, y: 0, z: 1 } };

  it('residual is 2 scalars', () => {
    const r = buildMatePointAxisResiduals(localA, localB,
      { x: 0, y: 0, z: 0 }, [0, 0, 0, 1],
      { x: 0, y: 0, z: 0 }, [0, 0, 0, 1]);
    expect(r).toHaveLength(2);
  });

  it('analytic Jacobian matches finite difference', () => {
    const pa = randomPose(); const pb = randomPose();
    const xa = [pa.T.x, pa.T.y, pa.T.z, ...pa.q];
    const xb = [pb.T.x, pb.T.y, pb.T.z, ...pb.q];
    const buildResid = (xa: number[], xb: number[]) =>
      buildMatePointAxisResiduals(localA, localB,
        { x: xa[0]!, y: xa[1]!, z: xa[2]! }, [xa[3]!, xa[4]!, xa[5]!, xa[6]!] as Quat,
        { x: xb[0]!, y: xb[1]!, z: xb[2]! }, [xb[3]!, xb[4]!, xb[5]!, xb[6]!] as Quat);
    const Jfd = fdJacobian(buildResid, xa, xb);
    const Jan = buildMatePointAxisJacobian(localA, localB,
      { x: xa[0]!, y: xa[1]!, z: xa[2]! }, [xa[3]!, xa[4]!, xa[5]!, xa[6]!] as Quat,
      { x: xb[0]!, y: xb[1]!, z: xb[2]! }, [xb[3]!, xb[4]!, xb[5]!, xb[6]!] as Quat);
    for (let r = 0; r < 2; r++)
      for (let c = 0; c < 14; c++)
        expect(Jan[r]![c]!).toBeCloseTo(Jfd[r]![c]!, 5);
  });
});

describe('flush face↔face', () => {
  const localA: WorldRefGeom = { kind: 'plane', P: { x: 0, y: 0, z: 0 }, N: { x: 0, y: 0, z: 1 } };
  const localB: WorldRefGeom = { kind: 'plane', P: { x: 0, y: 0, z: 0 }, N: { x: 0, y: 0, z: 1 } };

  it('residual is 3 scalars', () => {
    const r = buildFlushFaceFaceResiduals(localA, localB,
      { x: 0, y: 0, z: 0 }, [0, 0, 0, 1],
      { x: 0, y: 0, z: 0 }, [0, 0, 0, 1], 0);
    expect(r).toHaveLength(3);
  });

  it('analytic Jacobian matches finite difference', () => {
    const pa = randomPose(); const pb = randomPose();
    const xa = [pa.T.x, pa.T.y, pa.T.z, ...pa.q];
    const xb = [pb.T.x, pb.T.y, pb.T.z, ...pb.q];
    const buildResid = (xa: number[], xb: number[]) =>
      buildFlushFaceFaceResiduals(localA, localB,
        { x: xa[0]!, y: xa[1]!, z: xa[2]! }, [xa[3]!, xa[4]!, xa[5]!, xa[6]!] as Quat,
        { x: xb[0]!, y: xb[1]!, z: xb[2]! }, [xb[3]!, xb[4]!, xb[5]!, xb[6]!] as Quat, 5);
    const Jfd = fdJacobian(buildResid, xa, xb);
    const Jan = buildFlushFaceFaceJacobian(localA, localB,
      { x: xa[0]!, y: xa[1]!, z: xa[2]! }, [xa[3]!, xa[4]!, xa[5]!, xa[6]!] as Quat,
      { x: xb[0]!, y: xb[1]!, z: xb[2]! }, [xb[3]!, xb[4]!, xb[5]!, xb[6]!] as Quat, 5);
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 14; c++)
        expect(Jan[r]![c]!).toBeCloseTo(Jfd[r]![c]!, 5);
  });
});

describe('angle', () => {
  it('residual is 1 scalar (face-face)', () => {
    const lA: WorldRefGeom = { kind: 'plane', P: { x: 0, y: 0, z: 0 }, N: { x: 0, y: 0, z: 1 } };
    const lB: WorldRefGeom = { kind: 'plane', P: { x: 0, y: 0, z: 0 }, N: { x: 0, y: 0, z: 1 } };
    const r = buildAngleResiduals(lA, lB, [0, 0, 0, 1], [0, 0, 0, 1], 0);
    expect(r).toHaveLength(1);
    expect(r[0]).toBeCloseTo(0, 9);  // parallel normals at 0° → dot=1, cos(0)=1, r=1-1=0
  });

  it('analytic Jacobian matches finite difference (face-face)', () => {
    const lA: WorldRefGeom = { kind: 'plane', P: { x: 0, y: 0, z: 0 }, N: { x: 0, y: 0, z: 1 } };
    const lB: WorldRefGeom = { kind: 'plane', P: { x: 0, y: 0, z: 0 }, N: { x: 0, y: 0, z: 1 } };
    const pa = randomPose(); const pb = randomPose();
    const xa = [pa.T.x, pa.T.y, pa.T.z, ...pa.q];
    const xb = [pb.T.x, pb.T.y, pb.T.z, ...pb.q];
    const buildResid = (xa: number[], xb: number[]) =>
      buildAngleResiduals(lA, lB,
        [xa[3]!, xa[4]!, xa[5]!, xa[6]!] as Quat,
        [xb[3]!, xb[4]!, xb[5]!, xb[6]!] as Quat, 45);
    const Jfd = fdJacobian(buildResid, xa, xb);
    const Jan = buildAngleJacobian(lA, lB,
      [xa[3]!, xa[4]!, xa[5]!, xa[6]!] as Quat,
      [xb[3]!, xb[4]!, xb[5]!, xb[6]!] as Quat, 45);
    for (let c = 0; c < 14; c++)
      expect(Jan[0]![c]!).toBeCloseTo(Jfd[0]![c]!, 5);
  });

  it('analytic Jacobian matches finite difference (axis-axis)', () => {
    const lA: WorldRefGeom = { kind: 'axis', P: { x: 0, y: 0, z: 0 }, D: { x: 0, y: 0, z: 1 } };
    const lB: WorldRefGeom = { kind: 'axis', P: { x: 0, y: 0, z: 0 }, D: { x: 0, y: 0, z: 1 } };
    const pa = randomPose(); const pb = randomPose();
    const xa = [pa.T.x, pa.T.y, pa.T.z, ...pa.q];
    const xb = [pb.T.x, pb.T.y, pb.T.z, ...pb.q];
    const buildResid = (xa: number[], xb: number[]) =>
      buildAngleResiduals(lA, lB,
        [xa[3]!, xa[4]!, xa[5]!, xa[6]!] as Quat,
        [xb[3]!, xb[4]!, xb[5]!, xb[6]!] as Quat, 30);
    const Jfd = fdJacobian(buildResid, xa, xb);
    const Jan = buildAngleJacobian(lA, lB,
      [xa[3]!, xa[4]!, xa[5]!, xa[6]!] as Quat,
      [xb[3]!, xb[4]!, xb[5]!, xb[6]!] as Quat, 30);
    for (let c = 0; c < 14; c++)
      expect(Jan[0]![c]!).toBeCloseTo(Jfd[0]![c]!, 5);
  });
});

describe('insert', () => {
  const lA: WorldRefGeom = { kind: 'circularEdge',
    axisP: { x: 0, y: 0, z: 0 }, axisD: { x: 0, y: 0, z: 1 },
    planeP: { x: 0, y: 0, z: 0 }, planeN: { x: 0, y: 0, z: 1 } };
  const lB: WorldRefGeom = { kind: 'circularEdge',
    axisP: { x: 0, y: 0, z: 0 }, axisD: { x: 0, y: 0, z: 1 },
    planeP: { x: 0, y: 0, z: 0 }, planeN: { x: 0, y: 0, z: 1 } };

  it('residual is 7 scalars', () => {
    const r = buildInsertResiduals(lA, lB,
      { x: 0, y: 0, z: 0 }, [0, 0, 0, 1],
      { x: 0, y: 0, z: 0 }, [0, 0, 0, 1], 0);
    expect(r).toHaveLength(7);
  });

  it('analytic Jacobian matches finite difference', () => {
    const pa = randomPose(); const pb = randomPose();
    const xa = [pa.T.x, pa.T.y, pa.T.z, ...pa.q];
    const xb = [pb.T.x, pb.T.y, pb.T.z, ...pb.q];
    const buildResid = (xa: number[], xb: number[]) =>
      buildInsertResiduals(lA, lB,
        { x: xa[0]!, y: xa[1]!, z: xa[2]! }, [xa[3]!, xa[4]!, xa[5]!, xa[6]!] as Quat,
        { x: xb[0]!, y: xb[1]!, z: xb[2]! }, [xb[3]!, xb[4]!, xb[5]!, xb[6]!] as Quat, 5);
    const Jfd = fdJacobian(buildResid, xa, xb);
    const Jan = buildInsertJacobian(lA, lB,
      { x: xa[0]!, y: xa[1]!, z: xa[2]! }, [xa[3]!, xa[4]!, xa[5]!, xa[6]!] as Quat,
      { x: xb[0]!, y: xb[1]!, z: xb[2]! }, [xb[3]!, xb[4]!, xb[5]!, xb[6]!] as Quat, 5);
    for (let r = 0; r < 7; r++)
      for (let c = 0; c < 14; c++)
        expect(Jan[r]![c]!).toBeCloseTo(Jfd[r]![c]!, 5);
  });
});
