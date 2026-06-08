import type { PatternAxis, MirrorPlane, Vec3 } from '@zilventor/shared';

export type Pose = { translation: Vec3; quaternion: [number, number, number, number] };

/**
 * Converts quaternion [x,y,z,w] → row-major 3×3 rotation matrix (9 elements).
 * r[i*3+j] = R[i][j].
 */
export function quatToMat3(q: [number, number, number, number]): number[] {
  const [x, y, z, w] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z),     2 * (x * z + w * y),
    2 * (x * y + w * z),     1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y),     2 * (y * z + w * x),     1 - 2 * (x * x + y * y),
  ];
}

/**
 * Converts a row-major 3×3 rotation matrix to a quaternion [x,y,z,w].
 * Uses Shepperd's method (numerically stable).
 */
export function mat3ToQuat(m: number[]): [number, number, number, number] {
  const trace = m[0]! + m[4]! + m[8]!;
  let x: number, y: number, z: number, w: number;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    w = 0.25 / s;
    x = (m[7]! - m[5]!) * s;
    y = (m[2]! - m[6]!) * s;
    z = (m[3]! - m[1]!) * s;
  } else if (m[0]! > m[4]! && m[0]! > m[8]!) {
    const s = 2 * Math.sqrt(1 + m[0]! - m[4]! - m[8]!);
    w = (m[7]! - m[5]!) / s;
    x = 0.25 * s;
    y = (m[1]! + m[3]!) / s;
    z = (m[2]! + m[6]!) / s;
  } else if (m[4]! > m[8]!) {
    const s = 2 * Math.sqrt(1 + m[4]! - m[0]! - m[8]!);
    w = (m[2]! - m[6]!) / s;
    x = (m[1]! + m[3]!) / s;
    y = 0.25 * s;
    z = (m[5]! + m[7]!) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m[8]! - m[0]! - m[4]!);
    w = (m[3]! - m[1]!) / s;
    x = (m[2]! + m[6]!) / s;
    y = (m[5]! + m[7]!) / s;
    z = 0.25 * s;
  }
  const n = Math.sqrt(x * x + y * y + z * z + w * w);
  return [x / n, y / n, z / n, w / n];
}

/** Row-major 3×3 matrix multiply: C = A * B */
function mat3Mul(a: number[], b: number[]): number[] {
  const c: number[] = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let v = 0;
      for (let k = 0; k < 3; k++) v += a[i * 3 + k]! * b[k * 3 + j]!;
      c[i * 3 + j] = v;
    }
  }
  return c;
}

/**
 * Reflection matrix M for world-plane mirror (row-major 3×3).
 * M_yz = diag(-1,1,1)  — negates X
 * M_xz = diag(1,-1,1)  — negates Y
 * M_xy = diag(1,1,-1)  — negates Z
 */
function worldMirrorMat(plane: MirrorPlane): number[] {
  return [
    plane === 'yz' ? -1 : 1, 0, 0,
    0, plane === 'xz' ? -1 : 1, 0,
    0, 0, plane === 'xy' ? -1 : 1,
  ];
}

/**
 * S = diag(-1,1,1): local-YZ reflection.
 * The mirrored part geometry has been reflected with S by kernel.mirrorPart
 * (mirrorShape(oc, shape, 'yz') negates X in the part's local frame).
 */
const S_MAT: number[] = [-1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * Given a source pose and a world mirror plane, compute the mirrored placement pose
 * such that new_world = M * old_world for every point in the part.
 *
 * Derivation: for local point p, M*(R*p + t) = R'*(S*p) + t'
 *   → t' = M*t
 *   → R' = M * R * S   (det = (-1)(+1)(-1) = +1 → proper rotation, quaternion-encodable)
 *
 * The kernel mirrors the part geometry with S = diag(-1,1,1) (plane='yz').
 */
export function computeMirroredPose(sourcePose: Pose, worldPlane: MirrorPlane): Pose {
  const M = worldMirrorMat(worldPlane);
  const R = quatToMat3(sourcePose.quaternion);
  const Rprime = mat3Mul(mat3Mul(M, R), S_MAT);
  const { x: tx, y: ty, z: tz } = sourcePose.translation;
  return {
    translation: {
      x: M[0]! * tx + M[1]! * ty + M[2]! * tz,
      y: M[3]! * tx + M[4]! * ty + M[5]! * tz,
      z: M[6]! * tx + M[7]! * ty + M[8]! * tz,
    },
    quaternion: mat3ToQuat(Rprime),
  };
}

function axisVec(axis: PatternAxis): Vec3 {
  return axis === 'x' ? { x: 1, y: 0, z: 0 }
       : axis === 'y' ? { x: 0, y: 1, z: 0 }
       :                { x: 0, y: 0, z: 1 };
}

/**
 * Returns count1*count2 - 1 poses (origin cell excluded).
 * Each pose = sourcePose.translation + i*spacing1*axis(dir1) + j*spacing2*axis(dir2).
 * Quaternion is copied unchanged from sourcePose.
 */
export function computeRectGridPoses(
  sourcePose: Pose,
  dir1: PatternAxis,
  count1: number,
  spacing1: number,
  dir2?: PatternAxis,
  count2?: number,
  spacing2?: number,
): Pose[] {
  const a1 = axisVec(dir1);
  const a2 = dir2 ? axisVec(dir2) : { x: 0, y: 0, z: 0 };
  const c2 = dir2 && count2 ? count2 : 1;
  const s2 = dir2 && spacing2 ? spacing2 : 0;
  const poses: Pose[] = [];
  for (let j = 0; j < c2; j++) {
    for (let i = 0; i < count1; i++) {
      if (i === 0 && j === 0) continue; // exclude origin
      poses.push({
        translation: {
          x: sourcePose.translation.x + i * spacing1 * a1.x + j * s2 * a2.x,
          y: sourcePose.translation.y + i * spacing1 * a1.y + j * s2 * a2.y,
          z: sourcePose.translation.z + i * spacing1 * a1.z + j * s2 * a2.z,
        },
        quaternion: [...sourcePose.quaternion] as [number, number, number, number],
      });
    }
  }
  return poses;
}
