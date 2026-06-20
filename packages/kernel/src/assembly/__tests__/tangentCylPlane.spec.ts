import { describe, it, expect } from 'vitest';
import { buildTangentCylPlaneResiduals, buildTangentCylPlaneJacobian } from '../Residuals';
import { buildAllJacobian, type SolverInput } from '../AssemblyConstraintSolver';
import type { PartLocalGeometry } from '../AssemblyConstraintRefs';
import type { Quat } from '../quat';
import type { Vec3, AssemblyConstraint } from '@zilventor/shared';

const ID_Q: Quat = [0, 0, 0, 1];
const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

function quatNorm(q: Quat): Quat {
  const n = Math.sqrt(q[0]**2 + q[1]**2 + q[2]**2 + q[3]**2);
  return [q[0]/n, q[1]/n, q[2]/n, q[3]/n];
}

/** Finite-difference Jacobian with raw (un-normalized) quaternion perturbations.
 *  Matches the raw analytic Jacobian emitted by buildTangentCylPlaneJacobian,
 *  consistent with all other constraint FD tests in the solver. */
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
      // No renormalization — perturbed quaternion stays raw, matching raw analytic derivatives
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

/** Swap cols 0-6 ↔ 7-13 (mirrors swapAB in the solver). */
function swapAB(J: number[][]): number[][] {
  return J.map((row) => {
    const out = new Array(14).fill(0) as number[];
    for (let c = 0; c < 7; c++) { out[c] = row[c + 7]!; out[c + 7] = row[c]!; }
    return out;
  });
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

describe('reversed dispatch: plane-first tangent constraint', () => {
  /**
   * Gate for FIX 1: when refA=plane and refB=axis, buildAllJacobian must apply swapAB so
   * that cols 0-6 belong to the PLANE component (refA) and cols 7-13 to the AXIS (refB).
   *
   * Invariant: Jacobian(plane-first)[row][c] === swapAB(Jacobian(axis-first))[row][c]
   *
   * Before the fix (missing swapAB), the un-swapped block would place axis derivatives
   * in the plane's columns, so this test would FAIL.
   */
  it('plane-first dispatch Jacobian equals swapAB of axis-first Jacobian block', () => {
    const axisRef: PartLocalGeometry = { kind: 'axis', P: { x: 1, y: 2, z: 0 }, D: { x: 0, y: 0, z: 1 } };
    const planeRef: PartLocalGeometry = { kind: 'plane', P: { x: 0, y: 0, z: 0 }, N: { x: 1, y: 0, z: 0 } };
    const qa: Quat = quatNorm([0.1, 0.2, 0.3, 0.9]);
    const qb: Quat = quatNorm([0.2, -0.1, 0.4, 0.8]);
    const Ta: Vec3 = { x: 3, y: 1, z: -2 };
    const Tb: Vec3 = { x: -1, y: 2, z: 1 };
    const radius = 4;

    // Axis-first analytic Jacobian (directly from Residuals.ts, cols 0-6 = axis, 7-13 = plane)
    const JaxisFirst = buildTangentCylPlaneJacobian(axisRef, planeRef, Ta, qa, Tb, qb, radius);
    // Expected for plane-first: swap the column blocks
    const JexpectedPlaneFirst = swapAB(JaxisFirst);

    // Build the Jacobian via the full solver dispatch with refA=plane, refB=axis.
    // The solver places cols at offA (plane component = id 'P') and offB (axis component = id 'A').
    // Both components are free (not grounded), so offA=0, offB=7 in a 14-wide x vector.
    // The solver only reads componentPath[0] from the refs (for component IDs) and resolvedRefs
    // for the actual geometry, so the face/axis sub-shapes can be cast for test purposes.
    const solverInput: SolverInput = {
      components: [
        { id: 'P', T: Tb, q: qb },   // refA = plane component
        { id: 'A', T: Ta, q: qa },   // refB = axis component
      ],
      grounded: new Set(),
      constraints: [{
        id: 'c1',
        kind: 'tangent',
        refA: { kind: 'face', componentPath: ['P'], face: { featureId: 'f', role: 'plane' } },
        refB: { kind: 'axis', componentPath: ['A'], axis: { source: 'cylindricalFace', face: { featureId: 'f', role: 'axis' } } },
        radius: { kind: 'literal', value: radius },
        suppressed: false,
      } as AssemblyConstraint],
      resolvedRefs: new Map<string, PartLocalGeometry>([
        ['c1#P', planeRef],
        ['c1#A', axisRef],
      ]),
      paramValues: {},
    };

    // x vector: [Tb(0-2), qb(3-6), Ta(7-9), qa(10-13)]
    const x = [Tb.x, Tb.y, Tb.z, ...qb, Ta.x, Ta.y, Ta.z, ...qa];
    const Jfull = buildAllJacobian(solverInput, x);

    // Jfull has 2 constraint rows (+ 2 soft-norm rows — skip those).
    // The constraint block in Jfull[0..1] should match JexpectedPlaneFirst.
    expect(Jfull).toHaveLength(4);  // 2 constraint + 2 soft-norm (one per free component)
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 14; c++) {
        expect(Jfull[r]![c]!).toBeCloseTo(JexpectedPlaneFirst[r]![c]!, 10);
      }
    }
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
