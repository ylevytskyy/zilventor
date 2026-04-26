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

// ─── T13 residuals & Jacobians ─────────────────────────────────────────────

// MATE AXIS-AXIS — 4 residuals (collinearity + parallel directions)
export function buildMateAxisAxisResiduals(
  lA: PartLocalGeometry, lB: PartLocalGeometry,
  Ta: Vec3, qa: Quat, Tb: Vec3, qb: Quat, offset: number,
): number[] {
  if (lA.kind !== 'axis' || lB.kind !== 'axis') throw new Error('axis-axis requires axis refs');
  const a = worldFromLocal(lA, Ta, qa); const b = worldFromLocal(lB, Tb, qb);
  if (a.kind !== 'axis' || b.kind !== 'axis') throw new Error('unreachable');
  const dx = b.P.x - a.P.x, dy = b.P.y - a.P.y, dz = b.P.z - a.P.z;
  const along = a.D.x * dx + a.D.y * dy + a.D.z * dz;
  const px = dx - along * a.D.x, py = dy - along * a.D.y, pz = dz - along * a.D.z;
  const { u, v } = perpBasis(a.D);
  const r1 = px * u.x + py * u.y + pz * u.z;
  const r2 = px * v.x + py * v.y + pz * v.z;
  const cx = a.D.y * b.D.z - a.D.z * b.D.y;
  const cy = a.D.z * b.D.x - a.D.x * b.D.z;
  if (Math.abs(offset) < 1e-12) return [r1, r2, cx, cy];
  const mag = r1 * r1 + r2 * r2 - offset * offset;
  return [mag, 0, cx, cy];
}

export function buildMateAxisAxisJacobian(
  lA: PartLocalGeometry, lB: PartLocalGeometry,
  Ta: Vec3, qa: Quat, Tb: Vec3, qb: Quat, _offset: number,
): number[][] {
  if (lA.kind !== 'axis' || lB.kind !== 'axis') throw new Error('axis-axis requires axis refs');
  const Da = quatRotateVec(qa, lA.D);
  const Db = quatRotateVec(qb, lB.D);
  const Pa = (() => { const r = quatRotateVec(qa, lA.P); return { x: r.x + Ta.x, y: r.y + Ta.y, z: r.z + Ta.z }; })();
  const Pb = (() => { const r = quatRotateVec(qb, lB.P); return { x: r.x + Tb.x, y: r.y + Tb.y, z: r.z + Tb.z }; })();
  const dDaQ = quatRotateVecJacobian(qa, lA.D);
  const dDbQ = quatRotateVecJacobian(qb, lB.D);
  const dPaQ = quatRotateVecJacobian(qa, lA.P);
  const dPbQ = quatRotateVecJacobian(qb, lB.P);

  // perpBasis internals for Da
  const ax = Math.abs(Da.x), ay = Math.abs(Da.y), az = Math.abs(Da.z);
  const helper: Vec3 = ax < ay && ax < az ? { x: 1, y: 0, z: 0 }
                      : ay < az           ? { x: 0, y: 1, z: 0 }
                                          : { x: 0, y: 0, z: 1 };
  const uRaw = { x: Da.y * helper.z - Da.z * helper.y,
                 y: Da.z * helper.x - Da.x * helper.z,
                 z: Da.x * helper.y - Da.y * helper.x };
  const ul = Math.sqrt(uRaw.x ** 2 + uRaw.y ** 2 + uRaw.z ** 2);
  const u: Vec3 = { x: uRaw.x / ul, y: uRaw.y / ul, z: uRaw.z / ul };
  const v: Vec3 = { x: Da.y * u.z - Da.z * u.y,
                    y: Da.z * u.x - Da.x * u.z,
                    z: Da.x * u.y - Da.y * u.x };
  const duDN = duDNa(Da, u, ul, helper);
  const dvDN = dvDNa(Da, u, duDN);

  const dx = Pb.x - Pa.x, dy = Pb.y - Pa.y, dz = Pb.z - Pa.z;
  const along = Da.x * dx + Da.y * dy + Da.z * dz;
  const px = dx - along * Da.x, py = dy - along * Da.y, pz = dz - along * Da.z;
  // r1 = perp . u,  r2 = perp . v
  // r3 = Da.y*Db.z - Da.z*Db.y  (cx)
  // r4 = Da.z*Db.x - Da.x*Db.z  (cy)

  const J: number[][] = [
    new Array(14).fill(0), new Array(14).fill(0),
    new Array(14).fill(0), new Array(14).fill(0),
  ];

  // ── r1, r2: d/dTa ──
  // perp = (I - Da Da^T) (Pb - Pa), so d perp / d Pa = -(I - Da Da^T)
  // r1 = perp . u, r2 = perp . v
  const DaArr = [Da.x, Da.y, Da.z];
  const uArr  = [u.x, u.y, u.z];
  const vArr  = [v.x, v.y, v.z];
  for (let i = 0; i < 3; i++) {
    // d r1/d Pa_i = -((I - Da Da^T) e_i) . u = -(u_i - Da_i (Da.u))
    // Da.u = 0 (u perp Da), so d r1/d Pa_i = -u_i
    J[0]![i] = -uArr[i]!;
    J[1]![i] = -vArr[i]!;
    // d/dTb = +
    J[0]![7 + i] = uArr[i]!;
    J[1]![7 + i] = vArr[i]!;
  }

  // ── r1, r2: d/dqa ──
  // r1 = u . perp  where perp depends on Da(qa) and Pa(qa), and u depends on Da(qa)
  // perp = (I - Da Da^T) delta, delta = Pb - Pa
  // d perp / d Da = - (delta . Da) I - Da delta^T + 2 Da Da^T delta ... but let's expand:
  // perp_i = delta_i - (Da.delta) Da_i
  // d perp_i / d Da_j = -delta_j Da_i - (Da.delta) delta_{ij}  (where delta_{ij} is Kronecker, not the diff vec)
  // Hmm: d/d Da_j [(Da.delta) Da_i] = delta_j Da_i + (Da.delta) delta_{ij}
  // so d perp_i / d Da_j = -delta_j Da_i - (Da.delta) [i==j]
  // then chain through dDa/dqa (3×4)
  // Also u and v depend on Da via perpBasis -> use duDN, dvDN (3×3, rows=u comp, cols=Da comp)
  //
  // dr1/dqa_k = u . (d perp/dqa_k) + perp . (du/dqa_k)
  // d perp / dqa_k: need d perp_i / dqa_k = sum_j (d perp_i / d Da_j) * dDa_j/dqa_k
  // du_i / dqa_k = sum_j duDN[i][j] * dDa_j/dqa_k
  //
  // Also Pa depends on qa: d perp / d Pa_j = -(I - Da Da^T)_ij, d Pa_j / dqa_k = dPaQ[j][k]
  for (let k = 0; k < 4; k++) {
    const dDak = [dDaQ[0]![k]!, dDaQ[1]![k]!, dDaQ[2]![k]!];
    const dPak = [dPaQ[0]![k]!, dPaQ[1]![k]!, dPaQ[2]![k]!];

    // contribution from Da changing: d perp / d Da_j * dDa_j/dqa_k
    // d perp_i / d Da_j = -delta_j Da_i - along * [i==j]  (along = Da.delta)
    let dperpU = 0, dperpV = 0;
    for (let i = 0; i < 3; i++) {
      let dperpi = 0;
      for (let j = 0; j < 3; j++) {
        dperpi += (-[dx, dy, dz][j]! * DaArr[i]! - (i === j ? along : 0)) * dDak[j]!;
      }
      dperpU += uArr[i]! * dperpi;
      dperpV += vArr[i]! * dperpi;
    }

    // contribution from u/v changing with Da
    let dUR = 0, dVR = 0;
    for (let i = 0; i < 3; i++) {
      let dui = 0, dvi = 0;
      for (let j = 0; j < 3; j++) {
        dui += duDN[i]![j]! * dDak[j]!;
        dvi += dvDN[i]![j]! * dDak[j]!;
      }
      dUR += [px, py, pz][i]! * dui;
      dVR += [px, py, pz][i]! * dvi;
    }

    // contribution from Pa changing: d perp_i / d Pa_j = -(I - Da Da^T)_{ij}
    // = -(delta_{ij} - Da_i Da_j)
    let dperpUfromPa = 0, dperpVfromPa = 0;
    for (let i = 0; i < 3; i++) {
      let dperpi = 0;
      for (let j = 0; j < 3; j++) {
        dperpi += (-(i === j ? 1 : 0) + DaArr[i]! * DaArr[j]!) * dPak[j]!;
      }
      dperpUfromPa += uArr[i]! * dperpi;
      dperpVfromPa += vArr[i]! * dperpi;
    }

    J[0]![3 + k] = dperpU + dUR + dperpUfromPa;
    J[1]![3 + k] = dperpV + dVR + dperpVfromPa;
  }

  // ── r1, r2: d/dqb ──
  // Only Pb depends on qb: d perp / d Pb = (I - Da Da^T)
  for (let k = 0; k < 4; k++) {
    const dPbk = [dPbQ[0]![k]!, dPbQ[1]![k]!, dPbQ[2]![k]!];
    let r1 = 0, r2 = 0;
    for (let i = 0; i < 3; i++) {
      let dperpi = 0;
      for (let j = 0; j < 3; j++) {
        dperpi += ((i === j ? 1 : 0) - DaArr[i]! * DaArr[j]!) * dPbk[j]!;
      }
      r1 += uArr[i]! * dperpi;
      r2 += vArr[i]! * dperpi;
    }
    J[0]![10 + k] = r1;
    J[1]![10 + k] = r2;
  }

  // ── r3, r4 (cross product): d/dTa = d/dTb = 0 (only directions matter) ──
  // r3 = Da.y*Db.z - Da.z*Db.y,  r4 = Da.z*Db.x - Da.x*Db.z
  // d r3 / d Da = [0, Db.z, -Db.y],  d r3 / d Db = [0, -Da.z, Da.y]
  // d r4 / d Da = [-Db.z, 0, Db.x],  d r4 / d Db = [Da.z, 0, -Da.x]
  for (let k = 0; k < 4; k++) {
    const dDak = [dDaQ[0]![k]!, dDaQ[1]![k]!, dDaQ[2]![k]!];
    const dDbk = [dDbQ[0]![k]!, dDbQ[1]![k]!, dDbQ[2]![k]!];
    // d r3 / dqa_k = [0, Db.z, -Db.y] . dDak
    J[2]![3 + k] = 0 * dDak[0]! + Db.z * dDak[1]! + (-Db.y) * dDak[2]!;
    // d r4 / dqa_k = [-Db.z, 0, Db.x] . dDak
    J[3]![3 + k] = (-Db.z) * dDak[0]! + 0 * dDak[1]! + Db.x * dDak[2]!;
    // d r3 / dqb_k = [0, -Da.z, Da.y] . dDbk
    J[2]![10 + k] = 0 * dDbk[0]! + (-Da.z) * dDbk[1]! + Da.y * dDbk[2]!;
    // d r4 / dqb_k = [Da.z, 0, -Da.x] . dDbk
    J[3]![10 + k] = Da.z * dDbk[0]! + 0 * dDbk[1]! + (-Da.x) * dDbk[2]!;
  }

  return J;
}

// MATE POINT-POINT — 3 residuals (P_b - P_a)
export function buildMatePointPointResiduals(
  lA: PartLocalGeometry, lB: PartLocalGeometry,
  Ta: Vec3, qa: Quat, Tb: Vec3, qb: Quat,
): number[] {
  if (lA.kind !== 'point' || lB.kind !== 'point') throw new Error('point-point requires point refs');
  const a = worldFromLocal(lA, Ta, qa); const b = worldFromLocal(lB, Tb, qb);
  if (a.kind !== 'point' || b.kind !== 'point') throw new Error('unreachable');
  return [b.P.x - a.P.x, b.P.y - a.P.y, b.P.z - a.P.z];
}

export function buildMatePointPointJacobian(
  lA: PartLocalGeometry, lB: PartLocalGeometry,
  Ta: Vec3, qa: Quat, Tb: Vec3, qb: Quat,
): number[][] {
  if (lA.kind !== 'point' || lB.kind !== 'point') throw new Error('point-point requires point refs');
  const dPaQ = quatRotateVecJacobian(qa, lA.P);
  const dPbQ = quatRotateVecJacobian(qb, lB.P);

  const J: number[][] = [new Array(14).fill(0), new Array(14).fill(0), new Array(14).fill(0)];
  // d/dTa = -I_3
  J[0]![0] = -1; J[1]![1] = -1; J[2]![2] = -1;
  // d/dTb = +I_3
  J[0]![7] = 1; J[1]![8] = 1; J[2]![9] = 1;
  // d/dqa = -dPa/dqa
  for (let k = 0; k < 4; k++) {
    J[0]![3 + k] = -dPaQ[0]![k]!;
    J[1]![3 + k] = -dPaQ[1]![k]!;
    J[2]![3 + k] = -dPaQ[2]![k]!;
  }
  // d/dqb = +dPb/dqb
  for (let k = 0; k < 4; k++) {
    J[0]![10 + k] = dPbQ[0]![k]!;
    J[1]![10 + k] = dPbQ[1]![k]!;
    J[2]![10 + k] = dPbQ[2]![k]!;
  }
  return J;
}

// MATE POINT-FACE — 1 residual (signed distance from point to plane)
export function buildMatePointFaceResiduals(
  lA: PartLocalGeometry, lB: PartLocalGeometry,
  Ta: Vec3, qa: Quat, Tb: Vec3, qb: Quat,
): number[] {
  if (lA.kind !== 'point' || lB.kind !== 'plane') throw new Error('point-face requires point/plane');
  const a = worldFromLocal(lA, Ta, qa); const b = worldFromLocal(lB, Tb, qb);
  if (a.kind !== 'point' || b.kind !== 'plane') throw new Error('unreachable');
  return [b.N.x * (a.P.x - b.P.x) + b.N.y * (a.P.y - b.P.y) + b.N.z * (a.P.z - b.P.z)];
}

export function buildMatePointFaceJacobian(
  lA: PartLocalGeometry, lB: PartLocalGeometry,
  Ta: Vec3, qa: Quat, Tb: Vec3, qb: Quat,
): number[][] {
  if (lA.kind !== 'point' || lB.kind !== 'plane') throw new Error('point-face requires point/plane');
  const Nb = quatRotateVec(qb, lB.N);
  const Pa = (() => { const r = quatRotateVec(qa, lA.P); return { x: r.x + Ta.x, y: r.y + Ta.y, z: r.z + Ta.z }; })();
  const Pb = (() => { const r = quatRotateVec(qb, lB.P); return { x: r.x + Tb.x, y: r.y + Tb.y, z: r.z + Tb.z }; })();
  const dNbQ = quatRotateVecJacobian(qb, lB.N);
  const dPaQ = quatRotateVecJacobian(qa, lA.P);
  const dPbQ = quatRotateVecJacobian(qb, lB.P);

  // r = Nb . (Pa - Pb)
  const J: number[][] = [new Array(14).fill(0)];
  // d/dTa = Nb
  J[0]![0] = Nb.x; J[0]![1] = Nb.y; J[0]![2] = Nb.z;
  // d/dTb = -Nb
  J[0]![7] = -Nb.x; J[0]![8] = -Nb.y; J[0]![9] = -Nb.z;
  // d/dqa = Nb . dPa/dqa
  for (let k = 0; k < 4; k++) {
    J[0]![3 + k] = Nb.x * dPaQ[0]![k]! + Nb.y * dPaQ[1]![k]! + Nb.z * dPaQ[2]![k]!;
  }
  // d/dqb = dNb/dqb . (Pa - Pb) - Nb . dPb/dqb
  const diff = { x: Pa.x - Pb.x, y: Pa.y - Pb.y, z: Pa.z - Pb.z };
  for (let k = 0; k < 4; k++) {
    J[0]![10 + k] = dNbQ[0]![k]! * diff.x + dNbQ[1]![k]! * diff.y + dNbQ[2]![k]! * diff.z
                  - (Nb.x * dPbQ[0]![k]! + Nb.y * dPbQ[1]![k]! + Nb.z * dPbQ[2]![k]!);
  }
  return J;
}

// MATE POINT-AXIS — 2 residuals (perpendicular components of point to axis)
export function buildMatePointAxisResiduals(
  lA: PartLocalGeometry, lB: PartLocalGeometry,
  Ta: Vec3, qa: Quat, Tb: Vec3, qb: Quat,
): number[] {
  if (lA.kind !== 'point' || lB.kind !== 'axis') throw new Error('point-axis requires point/axis');
  const a = worldFromLocal(lA, Ta, qa); const b = worldFromLocal(lB, Tb, qb);
  if (a.kind !== 'point' || b.kind !== 'axis') throw new Error('unreachable');
  const dx = a.P.x - b.P.x, dy = a.P.y - b.P.y, dz = a.P.z - b.P.z;
  const along = b.D.x * dx + b.D.y * dy + b.D.z * dz;
  const { u, v } = perpBasis(b.D);
  return [
    (dx - along * b.D.x) * u.x + (dy - along * b.D.y) * u.y + (dz - along * b.D.z) * u.z,
    (dx - along * b.D.x) * v.x + (dy - along * b.D.y) * v.y + (dz - along * b.D.z) * v.z,
  ];
}

export function buildMatePointAxisJacobian(
  lA: PartLocalGeometry, lB: PartLocalGeometry,
  Ta: Vec3, qa: Quat, Tb: Vec3, qb: Quat,
): number[][] {
  if (lA.kind !== 'point' || lB.kind !== 'axis') throw new Error('point-axis requires point/axis');
  const Db = quatRotateVec(qb, lB.D);
  const Pa = (() => { const r = quatRotateVec(qa, lA.P); return { x: r.x + Ta.x, y: r.y + Ta.y, z: r.z + Ta.z }; })();
  const Pb = (() => { const r = quatRotateVec(qb, lB.P); return { x: r.x + Tb.x, y: r.y + Tb.y, z: r.z + Tb.z }; })();
  const dDbQ = quatRotateVecJacobian(qb, lB.D);
  const dPaQ = quatRotateVecJacobian(qa, lA.P);
  const dPbQ = quatRotateVecJacobian(qb, lB.P);

  // perpBasis internals for Db
  const bx = Math.abs(Db.x), by = Math.abs(Db.y), bz = Math.abs(Db.z);
  const helper: Vec3 = bx < by && bx < bz ? { x: 1, y: 0, z: 0 }
                      : by < bz           ? { x: 0, y: 1, z: 0 }
                                          : { x: 0, y: 0, z: 1 };
  const uRaw = { x: Db.y * helper.z - Db.z * helper.y,
                 y: Db.z * helper.x - Db.x * helper.z,
                 z: Db.x * helper.y - Db.y * helper.x };
  const ul = Math.sqrt(uRaw.x ** 2 + uRaw.y ** 2 + uRaw.z ** 2);
  const u: Vec3 = { x: uRaw.x / ul, y: uRaw.y / ul, z: uRaw.z / ul };
  const v: Vec3 = { x: Db.y * u.z - Db.z * u.y,
                    y: Db.z * u.x - Db.x * u.z,
                    z: Db.x * u.y - Db.y * u.x };
  const duDN = duDNa(Db, u, ul, helper);
  const dvDN = dvDNa(Db, u, duDN);

  const dx = Pa.x - Pb.x, dy = Pa.y - Pb.y, dz = Pa.z - Pb.z;
  const along = Db.x * dx + Db.y * dy + Db.z * dz;
  const px = dx - along * Db.x, py = dy - along * Db.y, pz = dz - along * Db.z;

  const DbArr = [Db.x, Db.y, Db.z];
  const uArr  = [u.x, u.y, u.z];
  const vArr  = [v.x, v.y, v.z];
  const perpArr = [px, py, pz];
  const dArr  = [dx, dy, dz];

  const J: number[][] = [new Array(14).fill(0), new Array(14).fill(0)];

  // ── d/dTa: d perp / d Pa = (I - Db Db^T), then dot with u/v ──
  for (let i = 0; i < 3; i++) {
    J[0]![i] = uArr[i]!;   // simplified: u perp Db so (I - Db Db^T) col_i . u = u_i
    J[1]![i] = vArr[i]!;
  }

  // ── d/dTb: d perp / d Pb = -(I - Db Db^T) ──
  for (let i = 0; i < 3; i++) {
    J[0]![7 + i] = -uArr[i]!;
    J[1]![7 + i] = -vArr[i]!;
  }

  // ── d/dqa: only Pa depends on qa ──
  for (let k = 0; k < 4; k++) {
    const dPak = [dPaQ[0]![k]!, dPaQ[1]![k]!, dPaQ[2]![k]!];
    // d perp_i / d Pa_j = (I - Db Db^T)_{ij}; u.perp Db so same simplification
    let r1 = 0, r2 = 0;
    for (let i = 0; i < 3; i++) {
      let dperpi = 0;
      for (let j = 0; j < 3; j++) {
        dperpi += ((i === j ? 1 : 0) - DbArr[i]! * DbArr[j]!) * dPak[j]!;
      }
      r1 += uArr[i]! * dperpi;
      r2 += vArr[i]! * dperpi;
    }
    J[0]![3 + k] = r1;
    J[1]![3 + k] = r2;
  }

  // ── d/dqb: Db, Pb, and hence u,v all depend on qb ──
  for (let k = 0; k < 4; k++) {
    const dDbk = [dDbQ[0]![k]!, dDbQ[1]![k]!, dDbQ[2]![k]!];
    const dPbk = [dPbQ[0]![k]!, dPbQ[1]![k]!, dPbQ[2]![k]!];

    // Contribution from Pb changing: d perp / d Pb = -(I - Db Db^T)
    let r1Pb = 0, r2Pb = 0;
    for (let i = 0; i < 3; i++) {
      let dperpi = 0;
      for (let j = 0; j < 3; j++) {
        dperpi += (-(i === j ? 1 : 0) + DbArr[i]! * DbArr[j]!) * dPbk[j]!;
      }
      r1Pb += uArr[i]! * dperpi;
      r2Pb += vArr[i]! * dperpi;
    }

    // Contribution from Db changing:
    // perp_i = d_i - (Db.d) Db_i  where d = Pa - Pb
    // d perp_i / d Db_j = -d_j Db_i - (Db.d) [i==j]
    let r1Db = 0, r2Db = 0;
    for (let i = 0; i < 3; i++) {
      let dperpi = 0;
      for (let j = 0; j < 3; j++) {
        dperpi += (-dArr[j]! * DbArr[i]! - (i === j ? along : 0)) * dDbk[j]!;
      }
      r1Db += uArr[i]! * dperpi;
      r2Db += vArr[i]! * dperpi;
    }

    // Contribution from u,v changing with Db via perpBasis
    let r1uv = 0, r2uv = 0;
    for (let i = 0; i < 3; i++) {
      let dui = 0, dvi = 0;
      for (let j = 0; j < 3; j++) {
        dui += duDN[i]![j]! * dDbk[j]!;
        dvi += dvDN[i]![j]! * dDbk[j]!;
      }
      r1uv += perpArr[i]! * dui;
      r2uv += perpArr[i]! * dvi;
    }

    J[0]![10 + k] = r1Pb + r1Db + r1uv;
    J[1]![10 + k] = r2Pb + r2Db + r2uv;
  }

  return J;
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

// ─── T14 flush face↔face ───────────────────────────────────────────────────

/** Flush face↔face: 3 residuals — distance + 2 normal-aligned components.
 *  Differs from mate face-face only in the sign of (Na ± Nb) on r2/r3:
 *  mate uses sum (Na + Nb); flush uses difference (Na - Nb). */
export function buildFlushFaceFaceResiduals(
  lA: PartLocalGeometry, lB: PartLocalGeometry,
  Ta: Vec3, qa: Quat, Tb: Vec3, qb: Quat, offset: number,
): number[] {
  if (lA.kind !== 'plane' || lB.kind !== 'plane') throw new Error('flush requires plane refs');
  const a = worldFromLocal(lA, Ta, qa); const b = worldFromLocal(lB, Tb, qb);
  if (a.kind !== 'plane' || b.kind !== 'plane') throw new Error('unreachable');
  const dx = b.P.x - a.P.x, dy = b.P.y - a.P.y, dz = b.P.z - a.P.z;
  const r1 = a.N.x * dx + a.N.y * dy + a.N.z * dz - offset;
  const sx = a.N.x - b.N.x, sy = a.N.y - b.N.y, sz = a.N.z - b.N.z;  // SAME direction → difference
  const { u, v } = perpBasis(a.N);
  return [r1, sx * u.x + sy * u.y + sz * u.z, sx * v.x + sy * v.y + sz * v.z];
}

// ─── T15 angle (face↔face / axis↔axis / face↔axis) ───────────────────────────

/** Returns the direction (rotated normal for plane refs, rotated D for axis refs). */
function worldDir(g: PartLocalGeometry, q: Quat): { x: number; y: number; z: number } {
  if (g.kind === 'plane') return quatRotateVec(q, g.N);
  if (g.kind === 'axis')  return quatRotateVec(q, g.D);
  throw new Error('worldDir requires plane or axis ref');
}

function localDir(g: PartLocalGeometry): { x: number; y: number; z: number } {
  if (g.kind === 'plane') return g.N;
  if (g.kind === 'axis')  return g.D;
  throw new Error('localDir requires plane or axis ref');
}

/** Angle: 1 residual. Da · Db − cos(angle°). Undirected (sign ambiguity resolved by initial guess). */
export function buildAngleResiduals(
  lA: PartLocalGeometry, lB: PartLocalGeometry,
  qa: Quat, qb: Quat, angleDeg: number,
): number[] {
  const Da = worldDir(lA, qa); const Db = worldDir(lB, qb);
  const target = Math.cos((angleDeg * Math.PI) / 180);
  return [Da.x * Db.x + Da.y * Db.y + Da.z * Db.z - target];
}

export function buildAngleJacobian(
  lA: PartLocalGeometry, lB: PartLocalGeometry,
  qa: Quat, qb: Quat, _angleDeg: number,
): number[][] {
  const Da = worldDir(lA, qa); const Db = worldDir(lB, qb);
  const dDaQ = quatRotateVecJacobian(qa, localDir(lA));  // 3×4
  const dDbQ = quatRotateVecJacobian(qb, localDir(lB));  // 3×4
  const J: number[][] = [new Array(14).fill(0)];
  // d(Da · Db)/dTa = 0; d(Da · Db)/dTb = 0 (translation cols 0-2 and 7-9 stay zero)
  // d(Da · Db)/dqa = dDa/dqa · Db (1×4 row, dotted in)
  for (let k = 0; k < 4; k++) {
    J[0]![3 + k] = dDaQ[0]![k]! * Db.x + dDaQ[1]![k]! * Db.y + dDaQ[2]![k]! * Db.z;
  }
  // d(Da · Db)/dqb = Da · dDb/dqb
  for (let k = 0; k < 4; k++) {
    J[0]![10 + k] = Da.x * dDbQ[0]![k]! + Da.y * dDbQ[1]![k]! + Da.z * dDbQ[2]![k]!;
  }
  return J;
}

// ─── T16 insert (composite: axis-axis collinear + face-face mate) ─────────────

/** Insert: 7 residuals = 4 (axis-axis collinear, offset=0) + 3 (face-face mate, axial offset). */
export function buildInsertResiduals(
  lA: PartLocalGeometry, lB: PartLocalGeometry,
  Ta: Vec3, qa: Quat, Tb: Vec3, qb: Quat, offset: number,
): number[] {
  if (lA.kind !== 'circularEdge' || lB.kind !== 'circularEdge')
    throw new Error('insert requires circularEdge refs');
  const axisA: PartLocalGeometry = { kind: 'axis', P: lA.axisP, D: lA.axisD };
  const axisB: PartLocalGeometry = { kind: 'axis', P: lB.axisP, D: lB.axisD };
  const planeA: PartLocalGeometry = { kind: 'plane', P: lA.planeP, N: lA.planeN };
  const planeB: PartLocalGeometry = { kind: 'plane', P: lB.planeP, N: lB.planeN };
  const ra = buildMateAxisAxisResiduals(axisA, axisB, Ta, qa, Tb, qb, 0);
  const rb = buildMateFaceFaceResiduals(planeA, planeB, Ta, qa, Tb, qb, offset);
  return [...ra, ...rb];
}

export function buildInsertJacobian(
  lA: PartLocalGeometry, lB: PartLocalGeometry,
  Ta: Vec3, qa: Quat, Tb: Vec3, qb: Quat, offset: number,
): number[][] {
  if (lA.kind !== 'circularEdge' || lB.kind !== 'circularEdge')
    throw new Error('insert requires circularEdge refs');
  const axisA: PartLocalGeometry = { kind: 'axis', P: lA.axisP, D: lA.axisD };
  const axisB: PartLocalGeometry = { kind: 'axis', P: lB.axisP, D: lB.axisD };
  const planeA: PartLocalGeometry = { kind: 'plane', P: lA.planeP, N: lA.planeN };
  const planeB: PartLocalGeometry = { kind: 'plane', P: lB.planeP, N: lB.planeN };
  const Ja = buildMateAxisAxisJacobian(axisA, axisB, Ta, qa, Tb, qb, 0);
  const Jb = buildMateFaceFaceJacobian(planeA, planeB, Ta, qa, Tb, qb, offset);
  return [...Ja, ...Jb];
}

export function buildFlushFaceFaceJacobian(
  localA: PartLocalGeometry, localB: PartLocalGeometry,
  Ta: Vec3, qa: Quat, Tb: Vec3, qb: Quat, _offset: number,
): number[][] {
  if (localA.kind !== 'plane' || localB.kind !== 'plane')
    throw new Error('flush face↔face requires plane refs');
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
  // flush: (Na - Nb) instead of (Na + Nb)
  const NmN  = [Na.x - Nb.x, Na.y - Nb.y, Na.z - Nb.z];

  const J: number[][] = [new Array(14).fill(0), new Array(14).fill(0), new Array(14).fill(0)];

  // r1 = Na . (Pb - Pa) - offset  (identical to mate face-face)
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

  // r2 = (Na - Nb) . u(Na);  r3 = (Na - Nb) . v(Na)
  // d/dqa_k: dNa/dqa_k . u + (Na-Nb) . du/dNa @ dNa/dqa_k   (chain rule for u(Na))
  //          dNa/dqa_k . v + (Na-Nb) . dv/dNa @ dNa/dqa_k
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
      t2r2 += NmN[i]! * dui;
      t2r3 += NmN[i]! * dvi;
    }
    J[1]![3 + k] = t1r2 + t2r2;
    J[2]![3 + k] = t1r3 + t2r3;
    // d/dqb: only Nb moves, u/v don't depend on qb; flush flips sign vs mate
    J[1]![10 + k] = -(dNbQ[0]![k]! * u.x + dNbQ[1]![k]! * u.y + dNbQ[2]![k]! * u.z);
    J[2]![10 + k] = -(dNbQ[0]![k]! * v.x + dNbQ[1]![k]! * v.y + dNbQ[2]![k]! * v.z);
  }
  return J;
}
