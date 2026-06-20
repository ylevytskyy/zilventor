import { describe, it, expect } from 'vitest';
import { buildTangentCylPlaneResiduals, buildTangentCylPlaneJacobian } from '../Residuals';
import type { PartLocalGeometry } from '../AssemblyConstraintRefs';
import type { Quat } from '../quat';
import type { Vec3 } from '@zilventor/shared';

const ID_Q: Quat = [0, 0, 0, 1];
const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

function quatNorm(q: Quat): Quat {
  const n = Math.sqrt(q[0]**2 + q[1]**2 + q[2]**2 + q[3]**2);
  return [q[0]/n, q[1]/n, q[2]/n, q[3]/n];
}

/** Finite-difference Jacobian with quaternion renormalization after each perturbation. */
function fdJacobianTangent(
  buildResid: (xa: number[], xb: number[]) => number[],
  xa: number[], xb: number[],
): number[][] {
  const eps = 1e-6;
  const r0 = buildResid(xa, xb);
  const J: number[][] = Array.from({ length: r0.length }, () => new Array(14).fill(0));
  for (let k = 0; k < 7; k++) {
    for (const side of ['a', 'b'] as const) {
      const xp = side === 'a' ? xa.slice() : xb.slice();
      xp[k]! += eps;
      const xm = side === 'a' ? xa.slice() : xb.slice();
      xm[k]! -= eps;
      // Renormalize quaternion components (indices 3-6)
      if (k >= 3) {
        const qp = quatNorm([xp[3]!, xp[4]!, xp[5]!, xp[6]!]); xp[3]=qp[0]; xp[4]=qp[1]; xp[5]=qp[2]; xp[6]=qp[3];
        const qm = quatNorm([xm[3]!, xm[4]!, xm[5]!, xm[6]!]); xm[3]=qm[0]; xm[4]=qm[1]; xm[5]=qm[2]; xm[6]=qm[3];
      }
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

describe('buildTangentCylPlaneResiduals', () => {
  it('residuals are zero when axis-to-plane distance equals radius and axis is parallel to plane', () => {
    // Cylinder axis at x=5 pointing Z (parallel to plane), radius=5.
    // Plane at x=0 with normal +X. Distance = 5 = radius → tangent. Axis Z ⊥ normal X → parallel.
    const axisRef: PartLocalGeometry = { kind: 'axis', P: { x: 5, y: 0, z: 0 }, D: { x: 0, y: 0, z: 1 } };
    const planeRef: PartLocalGeometry = { kind: 'plane', P: ZERO, N: { x: 1, y: 0, z: 0 } };
    const r = buildTangentCylPlaneResiduals(axisRef, planeRef, ZERO, ID_Q, ZERO, ID_Q, 5);
    expect(Math.abs(r[0]!)).toBeLessThan(1e-9);  // distance residual
    expect(Math.abs(r[1]!)).toBeLessThan(1e-9);  // parallelism residual
  });

  it('distance residual is non-zero when distance differs from radius', () => {
    const axisRef: PartLocalGeometry = { kind: 'axis', P: { x: 8, y: 0, z: 0 }, D: { x: 0, y: 0, z: 1 } };
    const planeRef: PartLocalGeometry = { kind: 'plane', P: ZERO, N: { x: 1, y: 0, z: 0 } };
    const r = buildTangentCylPlaneResiduals(axisRef, planeRef, ZERO, ID_Q, ZERO, ID_Q, 5);
    expect(Math.abs(r[0]!)).toBeGreaterThan(0.1);  // dist=8, radius=5 → r=3
  });
});

describe('buildTangentCylPlaneJacobian', () => {
  it('returns 2×14 matrix', () => {
    const axisRef: PartLocalGeometry = { kind: 'axis', P: { x: 5, y: 0, z: 0 }, D: { x: 0, y: 0, z: 1 } };
    const planeRef: PartLocalGeometry = { kind: 'plane', P: ZERO, N: { x: 1, y: 0, z: 0 } };
    const J = buildTangentCylPlaneJacobian(axisRef, planeRef, ZERO, ID_Q, ZERO, ID_Q, 5);
    expect(J).toHaveLength(2);
    expect(J[0]).toHaveLength(14);
    expect(J[1]).toHaveLength(14);
  });

  it('analytic Jacobian matches finite-difference (random pose, renormalized quats)', () => {
    // Use a pose where the constraint is NOT satisfied (generic position for a good FD test)
    const axisRef: PartLocalGeometry = { kind: 'axis', P: { x: 1, y: 2, z: 0 }, D: { x: 0, y: 0, z: 1 } };
    const planeRef: PartLocalGeometry = { kind: 'plane', P: { x: 0, y: 0, z: 0 }, N: { x: 1, y: 0, z: 0 } };
    // Non-trivial poses (non-identity rotation)
    const qa: Quat = quatNorm([0.1, 0.2, 0.3, 0.9]);
    const qb: Quat = quatNorm([0.2, -0.1, 0.4, 0.8]);
    const Ta: Vec3 = { x: 3, y: 1, z: -2 };
    const Tb: Vec3 = { x: -1, y: 2, z: 1 };
    const radius = 4;

    const xa = [Ta.x, Ta.y, Ta.z, ...qa];
    const xb = [Tb.x, Tb.y, Tb.z, ...qb];

    const buildResid = (xa: number[], xb: number[]) =>
      buildTangentCylPlaneResiduals(
        axisRef, planeRef,
        { x: xa[0]!, y: xa[1]!, z: xa[2]! }, [xa[3]!, xa[4]!, xa[5]!, xa[6]!] as Quat,
        { x: xb[0]!, y: xb[1]!, z: xb[2]! }, [xb[3]!, xb[4]!, xb[5]!, xb[6]!] as Quat,
        radius,
      );

    const Jfd = fdJacobianTangent(buildResid, xa, xb);
    const Jan = buildTangentCylPlaneJacobian(
      axisRef, planeRef,
      Ta, qa, Tb, qb, radius,
    );

    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 14; c++) {
        const analytic = Jan[r]![c]!;
        const fd = Jfd[r]![c]!;
        const absDiff = Math.abs(analytic - fd);
        const scale = Math.max(Math.abs(analytic), Math.abs(fd), 1e-3);
        expect(absDiff / scale).toBeLessThan(1e-4);  // 0.01% relative tolerance
      }
    }
  });
});
