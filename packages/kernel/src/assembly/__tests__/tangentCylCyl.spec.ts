import { describe, it, expect } from 'vitest';
import { buildTangentCylCylResiduals, buildTangentCylCylJacobian } from '../Residuals';
import type { PartLocalGeometry } from '../AssemblyConstraintRefs';
import type { Quat } from '../quat';
import type { Vec3 } from '@zilventor/shared';

const ID_Q: Quat = [0, 0, 0, 1];
const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

function normalizeQ(q: [number, number, number, number]): Quat {
  const len = Math.sqrt(q[0] ** 2 + q[1] ** 2 + q[2] ** 2 + q[3] ** 2);
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

describe('buildTangentCylCylResiduals', () => {
  it('zero residual when parallel axes are exactly r1+r2 apart', () => {
    // Axis A along Z at origin, Axis B along Z offset by (10,0,0).
    // Closest distance = 10 = r1+r2 = 3+7. Residual = 0.
    const axisA: PartLocalGeometry = { kind: 'axis', P: ZERO, D: { x: 0, y: 0, z: 1 } };
    const axisB: PartLocalGeometry = { kind: 'axis', P: { x: 10, y: 0, z: 0 }, D: { x: 0, y: 0, z: 1 } };
    const r = buildTangentCylCylResiduals(axisA, axisB, ZERO, ID_Q, ZERO, ID_Q, 3, 7);
    expect(Math.abs(r[0]!)).toBeLessThan(1e-9);
  });

  it('non-zero residual when parallel axes are not r1+r2 apart', () => {
    // Distance = 15, r1+r2 = 10. Residual = 5.
    const axisA: PartLocalGeometry = { kind: 'axis', P: ZERO, D: { x: 0, y: 0, z: 1 } };
    const axisB: PartLocalGeometry = { kind: 'axis', P: { x: 15, y: 0, z: 0 }, D: { x: 0, y: 0, z: 1 } };
    const r = buildTangentCylCylResiduals(axisA, axisB, ZERO, ID_Q, ZERO, ID_Q, 3, 7);
    expect(r[0]!).toBeCloseTo(5, 6);
  });

  it('degenerate/parallel case: point-to-line distance for coincident origin axes', () => {
    // Both axes along Z, but B is offset by (4,3,0) — distance = 5 = sqrt(16+9).
    const axisA: PartLocalGeometry = { kind: 'axis', P: ZERO, D: { x: 0, y: 0, z: 1 } };
    const axisB: PartLocalGeometry = { kind: 'axis', P: { x: 4, y: 3, z: 100 }, D: { x: 0, y: 0, z: 1 } };
    // Parallel: denom = 1 - (1)^2 = 0 → triggers parallel branch
    const r = buildTangentCylCylResiduals(axisA, axisB, ZERO, ID_Q, ZERO, ID_Q, 2, 3);
    // Distance = 5, r1+r2 = 5 → residual = 0
    expect(Math.abs(r[0]!)).toBeLessThan(1e-9);
  });

  it('skew-line closest distance for non-parallel axes', () => {
    // Axis A: through (0,0,0) in direction Z.
    // Axis B: through (5,3,0) in direction X (offset 3 in y — truly skew lines).
    // sA=0, sB=-5: closest pt on A=(0,0,0), closest pt on B=(0,3,0). dist=3.
    const axisA: PartLocalGeometry = { kind: 'axis', P: ZERO, D: { x: 0, y: 0, z: 1 } };
    const axisB: PartLocalGeometry = { kind: 'axis', P: { x: 5, y: 3, z: 0 }, D: { x: 1, y: 0, z: 0 } };
    const r = buildTangentCylCylResiduals(axisA, axisB, ZERO, ID_Q, ZERO, ID_Q, 1, 2);
    // dist = 3, r1+r2 = 3 → residual = 0
    expect(Math.abs(r[0]!)).toBeLessThan(1e-9);
  });
});

describe('buildTangentCylCylJacobian', () => {
  it('returns 1×14 matrix', () => {
    const axisA: PartLocalGeometry = { kind: 'axis', P: ZERO, D: { x: 0, y: 0, z: 1 } };
    const axisB: PartLocalGeometry = { kind: 'axis', P: { x: 10, y: 0, z: 0 }, D: { x: 0, y: 0, z: 1 } };
    const J = buildTangentCylCylJacobian(axisA, axisB, ZERO, ID_Q, ZERO, ID_Q, 3, 7);
    expect(J).toHaveLength(1);
    expect(J[0]).toHaveLength(14);
  });

  it('analytic Jacobian matches FD over all 14 unknowns (skew lines, raw no-renorm)', () => {
    // Generic skew-line pose with non-trivial quaternions for a thorough test.
    const axisA: PartLocalGeometry = { kind: 'axis', P: { x: 1, y: 2, z: 3 }, D: { x: 0, y: 0, z: 1 } };
    const axisB: PartLocalGeometry = { kind: 'axis', P: { x: 8, y: 3, z: 1 }, D: { x: 0, y: 1, z: 0 } };
    const Ta: Vec3 = ZERO;
    const qa: Quat = [0, 0, 0, 1];
    const Tb: Vec3 = ZERO;
    // Slightly non-identity quaternion for non-trivial Jacobian
    const qb: Quat = normalizeQ([0.1, 0.05, 0.02, Math.sqrt(1 - 0.01 - 0.0025 - 0.0004)]);
    const r1 = 3, r2 = 5;
    const h = 1e-6;

    const analytic = buildTangentCylCylJacobian(axisA, axisB, Ta, qa, Tb, qb, r1, r2);
    const r0 = buildTangentCylCylResiduals(axisA, axisB, Ta, qa, Tb, qb, r1, r2);

    const unknowns: number[] = [
      Ta.x, Ta.y, Ta.z, qa[0]!, qa[1]!, qa[2]!, qa[3]!,
      Tb.x, Tb.y, Tb.z, qb[0]!, qb[1]!, qb[2]!, qb[3]!,
    ];

    for (let j = 0; j < 14; j++) {
      const perturbed = [...unknowns];
      perturbed[j] = perturbed[j]! + h;
      // Raw perturbation — no renormalization (matches solver raw-additive convention)
      const pTa: Vec3 = { x: perturbed[0]!, y: perturbed[1]!, z: perturbed[2]! };
      const pQa: Quat = [perturbed[3]!, perturbed[4]!, perturbed[5]!, perturbed[6]!];
      const pTb: Vec3 = { x: perturbed[7]!, y: perturbed[8]!, z: perturbed[9]! };
      const pQb: Quat = [perturbed[10]!, perturbed[11]!, perturbed[12]!, perturbed[13]!];
      const rPerturbed = buildTangentCylCylResiduals(axisA, axisB, pTa, pQa, pTb, pQb, r1, r2);
      const fdJ = (rPerturbed[0]! - r0[0]!) / h;
      const anaJ = analytic[0]![j]!;
      const absDiff = Math.abs(fdJ - anaJ);
      const scale = Math.max(Math.abs(fdJ), Math.abs(anaJ), 1e-8);
      expect(absDiff / scale).toBeLessThan(1e-3);
    }
  });

  it('analytic Jacobian matches FD — parallel degenerate pose', () => {
    // Parallel axes: B along Z, offset by (6,0,0). Use non-trivial quaternions.
    const axisA: PartLocalGeometry = { kind: 'axis', P: ZERO, D: { x: 0, y: 0, z: 1 } };
    const axisB: PartLocalGeometry = { kind: 'axis', P: { x: 6, y: 0, z: 0 }, D: { x: 0, y: 0, z: 1 } };
    const Ta: Vec3 = { x: 1, y: 0, z: 0 };
    const qa: Quat = normalizeQ([0.05, 0, 0, Math.sqrt(1 - 0.0025)]);
    const Tb: Vec3 = { x: 0, y: 1, z: 0 };
    const qb: Quat = normalizeQ([0, 0.05, 0, Math.sqrt(1 - 0.0025)]);
    const r1 = 2, r2 = 3;
    const h = 1e-6;

    const analytic = buildTangentCylCylJacobian(axisA, axisB, Ta, qa, Tb, qb, r1, r2);
    const r0 = buildTangentCylCylResiduals(axisA, axisB, Ta, qa, Tb, qb, r1, r2);

    const unknowns: number[] = [
      Ta.x, Ta.y, Ta.z, qa[0]!, qa[1]!, qa[2]!, qa[3]!,
      Tb.x, Tb.y, Tb.z, qb[0]!, qb[1]!, qb[2]!, qb[3]!,
    ];

    for (let j = 0; j < 14; j++) {
      const perturbed = [...unknowns];
      perturbed[j] = perturbed[j]! + h;
      const pTa: Vec3 = { x: perturbed[0]!, y: perturbed[1]!, z: perturbed[2]! };
      const pQa: Quat = [perturbed[3]!, perturbed[4]!, perturbed[5]!, perturbed[6]!];
      const pTb: Vec3 = { x: perturbed[7]!, y: perturbed[8]!, z: perturbed[9]! };
      const pQb: Quat = [perturbed[10]!, perturbed[11]!, perturbed[12]!, perturbed[13]!];
      const rPerturbed = buildTangentCylCylResiduals(axisA, axisB, pTa, pQa, pTb, pQb, r1, r2);
      const fdJ = (rPerturbed[0]! - r0[0]!) / h;
      const anaJ = analytic[0]![j]!;
      const absDiff = Math.abs(fdJ - anaJ);
      const scale = Math.max(Math.abs(fdJ), Math.abs(anaJ), 1e-8);
      expect(absDiff / scale).toBeLessThan(1e-3);
    }
  });

  it('reversed order (cyl2↔cyl1) gives same distance residual', () => {
    // Reversing A/B should give the same closest distance (and thus same residual).
    const axisA: PartLocalGeometry = { kind: 'axis', P: { x: 1, y: 2, z: 3 }, D: { x: 0, y: 0, z: 1 } };
    const axisB: PartLocalGeometry = { kind: 'axis', P: { x: 8, y: 3, z: 1 }, D: { x: 0, y: 1, z: 0 } };
    const Ta: Vec3 = ZERO;
    const qa: Quat = ID_Q;
    const Tb: Vec3 = ZERO;
    const qb: Quat = ID_Q;
    const r1 = 3, r2 = 5;

    const rAB = buildTangentCylCylResiduals(axisA, axisB, Ta, qa, Tb, qb, r1, r2);
    const rBA = buildTangentCylCylResiduals(axisB, axisA, Tb, qb, Ta, qa, r2, r1);
    // Both should give same residual (distance is symmetric, radii swapped maintains r1+r2)
    expect(rAB[0]!).toBeCloseTo(rBA[0]!, 10);
  });
});
