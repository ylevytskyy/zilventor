// packages/shared/src/drawing/sectionPlane.ts
//
// Derives the world-space cutting plane and section view matrix from a
// 2D section line drawn on a parent view.
//
// Convention note: Mat4 in this codebase is ROW-MAJOR (M[row*4 + col]).
// apply(M, v) = M[0..3] · [vx,vy,vz,1], M[4..7] · [...], etc.

import type { Mat4, Vec3 } from './viewMatrix';
import type { Vec2 } from './types';

export type Plane = { origin: Vec3; normal: Vec3 };

// ---------------------------------------------------------------------------
// 3D vector helpers
// ---------------------------------------------------------------------------

function normalize3(v: Vec3): Vec3 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (len < 1e-12) return { x: 0, y: 0, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dot3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

// ---------------------------------------------------------------------------
// Row-major 4×4 matrix inverse (general, cofactor expansion)
// Row r, col c: M[r*4 + c]
// ---------------------------------------------------------------------------
function invertMat4RowMajor(m: number[]): number[] {
  /* eslint-disable @typescript-eslint/no-non-null-assertion */
  // cofactors (using 0-indexed row-major layout: m[r*4+c])
  const inv = new Array<number>(16).fill(0);

  inv[0]  =  m[5]!*m[10]!*m[15]! - m[5]!*m[11]!*m[14]! - m[9]!*m[6]!*m[15]! + m[9]!*m[7]!*m[14]! + m[13]!*m[6]!*m[11]! - m[13]!*m[7]!*m[10]!;
  inv[1]  = -m[1]!*m[10]!*m[15]! + m[1]!*m[11]!*m[14]! + m[9]!*m[2]!*m[15]! - m[9]!*m[3]!*m[14]! - m[13]!*m[2]!*m[11]! + m[13]!*m[3]!*m[10]!;
  inv[2]  =  m[1]!*m[6]! *m[15]! - m[1]!*m[7]! *m[14]! - m[5]!*m[2]!*m[15]! + m[5]!*m[3]!*m[14]! + m[13]!*m[2]!*m[7]!  - m[13]!*m[3]!*m[6]!;
  inv[3]  = -m[1]!*m[6]! *m[11]! + m[1]!*m[7]! *m[10]! + m[5]!*m[2]!*m[11]! - m[5]!*m[3]!*m[10]! - m[9]! *m[2]!*m[7]!  + m[9]! *m[3]!*m[6]!;

  inv[4]  = -m[4]!*m[10]!*m[15]! + m[4]!*m[11]!*m[14]! + m[8]!*m[6]!*m[15]! - m[8]!*m[7]!*m[14]! - m[12]!*m[6]!*m[11]! + m[12]!*m[7]!*m[10]!;
  inv[5]  =  m[0]!*m[10]!*m[15]! - m[0]!*m[11]!*m[14]! - m[8]!*m[2]!*m[15]! + m[8]!*m[3]!*m[14]! + m[12]!*m[2]!*m[11]! - m[12]!*m[3]!*m[10]!;
  inv[6]  = -m[0]!*m[6]! *m[15]! + m[0]!*m[7]! *m[14]! + m[4]!*m[2]!*m[15]! - m[4]!*m[3]!*m[14]! - m[12]!*m[2]!*m[7]!  + m[12]!*m[3]!*m[6]!;
  inv[7]  =  m[0]!*m[6]! *m[11]! - m[0]!*m[7]! *m[10]! - m[4]!*m[2]!*m[11]! + m[4]!*m[3]!*m[10]! + m[8]! *m[2]!*m[7]!  - m[8]! *m[3]!*m[6]!;

  inv[8]  =  m[4]!*m[9]! *m[15]! - m[4]!*m[11]!*m[13]! - m[8]!*m[5]!*m[15]! + m[8]!*m[7]!*m[13]! + m[12]!*m[5]!*m[11]! - m[12]!*m[7]!*m[9]!;
  inv[9]  = -m[0]!*m[9]! *m[15]! + m[0]!*m[11]!*m[13]! + m[8]!*m[1]!*m[15]! - m[8]!*m[3]!*m[13]! - m[12]!*m[1]!*m[11]! + m[12]!*m[3]!*m[9]!;
  inv[10] =  m[0]!*m[5]! *m[15]! - m[0]!*m[7]! *m[13]! - m[4]!*m[1]!*m[15]! + m[4]!*m[3]!*m[13]! + m[12]!*m[1]!*m[7]!  - m[12]!*m[3]!*m[5]!;
  inv[11] = -m[0]!*m[5]! *m[11]! + m[0]!*m[7]! *m[9]!  + m[4]!*m[1]!*m[11]! - m[4]!*m[3]!*m[9]!  - m[8]! *m[1]!*m[7]!  + m[8]! *m[3]!*m[5]!;

  inv[12] = -m[4]!*m[9]! *m[14]! + m[4]!*m[10]!*m[13]! + m[8]!*m[5]!*m[14]! - m[8]!*m[6]!*m[13]! - m[12]!*m[5]!*m[10]! + m[12]!*m[6]!*m[9]!;
  inv[13] =  m[0]!*m[9]! *m[14]! - m[0]!*m[10]!*m[13]! - m[8]!*m[1]!*m[14]! + m[8]!*m[2]!*m[13]! + m[12]!*m[1]!*m[10]! - m[12]!*m[2]!*m[9]!;
  inv[14] = -m[0]!*m[5]! *m[14]! + m[0]!*m[6]! *m[13]! + m[4]!*m[1]!*m[14]! - m[4]!*m[2]!*m[13]! - m[12]!*m[1]!*m[6]!  + m[12]!*m[2]!*m[5]!;
  inv[15] =  m[0]!*m[5]! *m[10]! - m[0]!*m[6]! *m[9]!  - m[4]!*m[1]!*m[10]! + m[4]!*m[2]!*m[9]!  + m[8]! *m[1]!*m[6]!  - m[8]! *m[2]!*m[5]!;

  const det = m[0]! * inv[0]! + m[1]! * inv[4]! + m[2]! * inv[8]! + m[3]! * inv[12]!;
  /* eslint-enable @typescript-eslint/no-non-null-assertion */
  if (Math.abs(det) < 1e-12) throw new Error('deriveSectionPlane: singular view matrix');
  const d = 1 / det;
  return inv.map(v => v * d);
}

// Apply row-major 4×4 to a point (homogeneous, w=1 assumed on output)
function applyRowMajor(m: number[], v: Vec3): Vec3 {
  // Row 0: m[0..3], Row 1: m[4..7], Row 2: m[8..11], Row 3: m[12..15]
  const w = m[12]! * v.x + m[13]! * v.y + m[14]! * v.z + m[15]!;
  return {
    x: (m[0]! * v.x + m[1]! * v.y + m[2]!  * v.z + m[3]!)  / w,
    y: (m[4]! * v.x + m[5]! * v.y + m[6]!  * v.z + m[7]!)  / w,
    z: (m[8]! * v.x + m[9]! * v.y + m[10]! * v.z + m[11]!) / w,
  };
}

// Apply rotation part only (no translation) — for direction vectors
function applyRowMajorDir(m: number[], v: Vec3): Vec3 {
  return {
    x: m[0]! * v.x + m[1]! * v.y + m[2]!  * v.z,
    y: m[4]! * v.x + m[5]! * v.y + m[6]!  * v.z,
    z: m[8]! * v.x + m[9]! * v.y + m[10]! * v.z,
  };
}

// ---------------------------------------------------------------------------
// Build row-major lookAt matrix: eye, target, up
// Result: transforms world → view (camera) space.
// ---------------------------------------------------------------------------
function lookAtRowMajor(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  // Forward (from eye toward target)
  const fwd = normalize3({ x: target.x - eye.x, y: target.y - eye.y, z: target.z - eye.z });
  const right = normalize3(cross3(fwd, normalize3(up)));
  const trueUp = cross3(right, fwd);

  // Row-major view matrix:
  // [right.x,  right.y,  right.z,  -dot(right, eye)]
  // [trueUp.x, trueUp.y, trueUp.z, -dot(trueUp, eye)]
  // [-fwd.x,  -fwd.y,   -fwd.z,    dot(fwd, eye)   ]
  // [0,        0,        0,         1               ]
  const m: Mat4 = [
    right.x,   right.y,   right.z,  -dot3(right,  eye),
    trueUp.x,  trueUp.y,  trueUp.z, -dot3(trueUp, eye),
    -fwd.x,   -fwd.y,    -fwd.z,    dot3(fwd,    eye),
    0,         0,         0,         1,
  ];
  return m;
}

// ---------------------------------------------------------------------------
// deriveSectionPlane
// ---------------------------------------------------------------------------

export function deriveSectionPlane(
  sectionLine: { p0: Vec2; p1: Vec2 },
  parentViewMatrix: Mat4,
  parentScale: number,
  arrowDirection: -1 | 1,
): { plane: Plane; sectionViewMatrix: Mat4 } {
  const m = parentViewMatrix as unknown as number[];
  const invM = invertMat4RowMajor(m);

  // Midpoint of section line in view space (mm).
  // parentScale converts from drawing units to mm: worldMm = viewCoord / scale
  const midView: Vec3 = {
    x: (sectionLine.p0.x + sectionLine.p1.x) / 2 / parentScale,
    y: (sectionLine.p0.y + sectionLine.p1.y) / 2 / parentScale,
    z: 0,
  };

  // 2D direction of section line in view space (scale-independent for normal direction)
  const dx = sectionLine.p1.x - sectionLine.p0.x;
  const dy = sectionLine.p1.y - sectionLine.p0.y;

  // 2D normal perpendicular to line in view XY plane (pointing to arrow side)
  const normalView: Vec3 = normalize3({ x: -dy * arrowDirection, y: dx * arrowDirection, z: 0 });

  // Transform midpoint and normal to world space via inverse view matrix
  const origin = applyRowMajor(invM, midView);
  const normal = normalize3(applyRowMajorDir(invM, normalView));

  const plane: Plane = { origin, normal };

  // Build section view matrix: camera placed along the normal, looking at origin
  const viewDist = 1000; // mm — large enough for orthographic-style viewing
  const eye: Vec3 = {
    x: origin.x + normal.x * viewDist,
    y: origin.y + normal.y * viewDist,
    z: origin.z + normal.z * viewDist,
  };

  // Up direction: prefer world +Z; fall back to world +Y if normal is near-parallel to Z
  const worldZ: Vec3 = { x: 0, y: 0, z: 1 };
  let up = normalize3(cross3(worldZ, normal));
  const upLen = Math.sqrt(up.x * up.x + up.y * up.y + up.z * up.z);
  if (upLen < 0.1) {
    up = normalize3(cross3({ x: 0, y: 1, z: 0 }, normal));
  }

  const sectionViewMatrix = lookAtRowMajor(eye, origin, up);

  return { plane, sectionViewMatrix };
}
