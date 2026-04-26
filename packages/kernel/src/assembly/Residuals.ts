import type { Vec3 } from '@zilventor/shared';
import { quatRotateVec, quatRotateVecJacobian, type Quat } from './quat';
import type { PartLocalGeometry } from './AssemblyConstraintRefs';

export type WorldRefGeom = PartLocalGeometry;  // same shape; just transformed

export function worldFromLocal(g: PartLocalGeometry, T: Vec3, q: Quat): WorldRefGeom {
  if (g.kind === 'plane') {
    const Pw = quatRotateVec(q, g.P);
    return { kind: 'plane',
      P: { x: Pw.x + T.x, y: Pw.y + T.y, z: Pw.z + T.z },
      N: quatRotateVec(q, g.N) };
  }
  if (g.kind === 'axis') {
    const Pw = quatRotateVec(q, g.P);
    return { kind: 'axis',
      P: { x: Pw.x + T.x, y: Pw.y + T.y, z: Pw.z + T.z },
      D: quatRotateVec(q, g.D) };
  }
  if (g.kind === 'point') {
    const Pw = quatRotateVec(q, g.P);
    return { kind: 'point',
      P: { x: Pw.x + T.x, y: Pw.y + T.y, z: Pw.z + T.z } };
  }
  // circularEdge
  const aPw = quatRotateVec(q, g.axisP);
  const pPw = quatRotateVec(q, g.planeP);
  return { kind: 'circularEdge',
    axisP: { x: aPw.x + T.x, y: aPw.y + T.y, z: aPw.z + T.z },
    axisD: quatRotateVec(q, g.axisD),
    planeP: { x: pPw.x + T.x, y: pPw.y + T.y, z: pPw.z + T.z },
    planeN: quatRotateVec(q, g.planeN) };
}

/** Pick orthonormal basis (u, v) perpendicular to n. */
export function perpBasis(n: Vec3): { u: Vec3; v: Vec3 } {
  const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
  const helper: Vec3 = ax < ay && ax < az ? { x: 1, y: 0, z: 0 }
                     : ay < az            ? { x: 0, y: 1, z: 0 }
                                          : { x: 0, y: 0, z: 1 };
  const u = { x: n.y * helper.z - n.z * helper.y,
              y: n.z * helper.x - n.x * helper.z,
              z: n.x * helper.y - n.y * helper.x };
  const ul = Math.sqrt(u.x * u.x + u.y * u.y + u.z * u.z);
  const uu = { x: u.x / ul, y: u.y / ul, z: u.z / ul };
  const v = { x: n.y * uu.z - n.z * uu.y,
              y: n.z * uu.x - n.x * uu.z,
              z: n.x * uu.y - n.y * uu.x };
  return { u: uu, v };
}

/** Mate face↔face: 3 residuals — distance + 2 normal-opposing components. */
export function buildMateFaceFaceResiduals(
  localA: PartLocalGeometry, localB: PartLocalGeometry,
  Ta: Vec3, qa: Quat, Tb: Vec3, qb: Quat, offset: number,
): number[] {
  if (localA.kind !== 'plane' || localB.kind !== 'plane')
    throw new Error('mate face↔face requires plane refs');
  const a = worldFromLocal(localA, Ta, qa);
  const b = worldFromLocal(localB, Tb, qb);
  if (a.kind !== 'plane' || b.kind !== 'plane') throw new Error('unreachable');
  const dx = b.P.x - a.P.x, dy = b.P.y - a.P.y, dz = b.P.z - a.P.z;
  const r1 = a.N.x * dx + a.N.y * dy + a.N.z * dz - offset;
  const sx = a.N.x + b.N.x, sy = a.N.y + b.N.y, sz = a.N.z + b.N.z;
  const { u, v } = perpBasis(a.N);
  const r2 = sx * u.x + sy * u.y + sz * u.z;
  const r3 = sx * v.x + sy * v.y + sz * v.z;
  return [r1, r2, r3];
}

/**
 * Returns d(u_hat)/d(Na) as a 3×3 matrix (row = u component, col = Na component).
 * u_hat = normalize(cross(Na, helper)) where helper is the axis least-aligned with Na.
 * d(u_hat)/dN = (I - u_hat u_hat^T) / |u_raw| * d(u_raw)/dN
 * d(u_raw = cross(n, h))/dN: column j is cross(e_j, h) = skew(-h) e_j.
 */
export function duDNa(Na: Vec3, u: Vec3, ul: number, helper: Vec3): number[][] {
  const hx = helper.x, hy = helper.y, hz = helper.z;
  // d(u_raw = cross(n, h))/dN: columns are [cross(e_0,h), cross(e_1,h), cross(e_2,h)]
  // cross(e_0, h) = (0, -hz, hy); cross(e_1, h) = (hz, 0, -hx); cross(e_2, h) = (-hy, hx, 0)
  const duRawCols = [[0, -hz, hy], [hz, 0, -hx], [-hy, hx, 0]];
  const uArr = [u.x, u.y, u.z];
  const result = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let j = 0; j < 3; j++) {
    const col = duRawCols[j]!;
    for (let i = 0; i < 3; i++) {
      let sum = 0;
      for (let m = 0; m < 3; m++)
        sum += ((i === m ? 1 : 0) - uArr[i]! * uArr[m]!) / ul * col[m]!;
      result[i]![j] = sum;
    }
  }
  return result;
}

/**
 * Returns d(v)/d(Na) as a 3×3 matrix, where v = cross(Na, u_hat).
 * d(v)/dN_j = cross(e_j, u) + cross(Na, d(u_hat)/dN_j)
 */
export function dvDNa(Na: Vec3, u: Vec3, duDN: number[][]): number[][] {
  const uArr = [u.x, u.y, u.z];
  const result = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let j = 0; j < 3; j++) {
    // cross(e_j, u)
    const t1 = j === 0 ? [0, -uArr[2]!, uArr[1]!]
             : j === 1 ? [uArr[2]!, 0, -uArr[0]!]
                       : [-uArr[1]!, uArr[0]!, 0];
    // cross(Na, du/dN_j)
    const dCol = [duDN[0]![j]!, duDN[1]![j]!, duDN[2]![j]!];
    const t2 = [
      Na.y * dCol[2]! - Na.z * dCol[1]!,
      Na.z * dCol[0]! - Na.x * dCol[2]!,
      Na.x * dCol[1]! - Na.y * dCol[0]!,
    ];
    for (let i = 0; i < 3; i++) result[i]![j] = t1[i]! + t2[i]!;
  }
  return result;
}

export function buildMateFaceFaceJacobian(
  localA: PartLocalGeometry, localB: PartLocalGeometry,
  Ta: Vec3, qa: Quat, Tb: Vec3, qb: Quat, _offset: number,
): number[][] {
  if (localA.kind !== 'plane' || localB.kind !== 'plane')
    throw new Error('mate face↔face requires plane refs');
  const Na = quatRotateVec(qa, localA.N);
  const Nb = quatRotateVec(qb, localB.N);
  const Pa = (() => { const r = quatRotateVec(qa, localA.P); return { x: r.x + Ta.x, y: r.y + Ta.y, z: r.z + Ta.z }; })();
  const Pb = (() => { const r = quatRotateVec(qb, localB.P); return { x: r.x + Tb.x, y: r.y + Tb.y, z: r.z + Tb.z }; })();
  const dNaQ = quatRotateVecJacobian(qa, localA.N);
  const dNbQ = quatRotateVecJacobian(qb, localB.N);
  const dPaQ = quatRotateVecJacobian(qa, localA.P);
  const dPbQ = quatRotateVecJacobian(qb, localB.P);

  // Compute perpBasis internals needed for Jacobians
  const ax = Math.abs(Na.x), ay = Math.abs(Na.y), az = Math.abs(Na.z);
  const helper: Vec3 = ax < ay && ax < az ? { x: 1, y: 0, z: 0 }
                      : ay < az           ? { x: 0, y: 1, z: 0 }
                                          : { x: 0, y: 0, z: 1 };
  const uRaw = { x: Na.y * helper.z - Na.z * helper.y,
                 y: Na.z * helper.x - Na.x * helper.z,
                 z: Na.x * helper.y - Na.y * helper.x };
  const ul = Math.sqrt(uRaw.x ** 2 + uRaw.y ** 2 + uRaw.z ** 2);
  const u: Vec3 = { x: uRaw.x / ul, y: uRaw.y / ul, z: uRaw.z / ul };
  const v: Vec3 = { x: Na.y * u.z - Na.z * u.y,
                    y: Na.z * u.x - Na.x * u.z,
                    z: Na.x * u.y - Na.y * u.x };
  const duDN = duDNa(Na, u, ul, helper);
  const dvDN = dvDNa(Na, u, duDN);

  const uArr = [u.x, u.y, u.z];
  const vArr = [v.x, v.y, v.z];
  const NpN  = [Na.x + Nb.x, Na.y + Nb.y, Na.z + Nb.z];

  const J: number[][] = [new Array(14).fill(0), new Array(14).fill(0), new Array(14).fill(0)];

  // r1 = Na . (Pb - Pa) - offset
  // d/dTa = -Na;  d/dTb = +Na
  J[0]![0] = -Na.x; J[0]![1] = -Na.y; J[0]![2] = -Na.z;
  J[0]![7] =  Na.x; J[0]![8] =  Na.y; J[0]![9] =  Na.z;
  // d/dqa: dNa/dqa . (Pb - Pa) - Na . dPa/dqa
  for (let k = 0; k < 4; k++) {
    const dNax = dNaQ[0]![k]!, dNay = dNaQ[1]![k]!, dNaz = dNaQ[2]![k]!;
    const dPax = dPaQ[0]![k]!, dPay = dPaQ[1]![k]!, dPaz = dPaQ[2]![k]!;
    J[0]![3 + k] = dNax * (Pb.x - Pa.x) + dNay * (Pb.y - Pa.y) + dNaz * (Pb.z - Pa.z)
                 - (Na.x * dPax + Na.y * dPay + Na.z * dPaz);
  }
  // d/dqb: Na . dPb/dqb
  for (let k = 0; k < 4; k++) {
    J[0]![10 + k] = Na.x * dPbQ[0]![k]! + Na.y * dPbQ[1]![k]! + Na.z * dPbQ[2]![k]!;
  }

  // r2 = (Na + Nb) . u(Na);  r3 = (Na + Nb) . v(Na)
  // d/dqa_k: dNa/dqa_k . u + (Na+Nb) . du/dNa @ dNa/dqa_k   (chain rule for u(Na))
  //          dNa/dqa_k . v + (Na+Nb) . dv/dNa @ dNa/dqa_k
  for (let k = 0; k < 4; k++) {
    const dNak = [dNaQ[0]![k]!, dNaQ[1]![k]!, dNaQ[2]![k]!];
    let t1r2 = 0, t2r2 = 0, t1r3 = 0, t2r3 = 0;
    for (let i = 0; i < 3; i++) {
      t1r2 += dNak[i]! * uArr[i]!;
      t1r3 += dNak[i]! * vArr[i]!;
      // (du/dNa @ dNak)_i = sum_j duDN[i][j] * dNak[j]
      let dui = 0, dvi = 0;
      for (let j = 0; j < 3; j++) {
        dui += duDN[i]![j]! * dNak[j]!;
        dvi += dvDN[i]![j]! * dNak[j]!;
      }
      t2r2 += NpN[i]! * dui;
      t2r3 += NpN[i]! * dvi;
    }
    J[1]![3 + k] = t1r2 + t2r2;
    J[2]![3 + k] = t1r3 + t2r3;
    // d/dqb: only Nb moves, u/v don't depend on qb
    J[1]![10 + k] = dNbQ[0]![k]! * u.x + dNbQ[1]![k]! * u.y + dNbQ[2]![k]! * u.z;
    J[2]![10 + k] = dNbQ[0]![k]! * v.x + dNbQ[1]![k]! * v.y + dNbQ[2]![k]! * v.z;
  }
  return J;
}
