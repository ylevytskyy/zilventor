// packages/shared/src/drawing/viewMatrix.ts
import type { BoundingBox } from '../types';

/**
 * 4×4 row-major homogeneous matrix stored as a flat number[16] array.
 * Row i, column j: M[i*4 + j].
 */
export type Mat4 = readonly number[];

export type Vec3 = { x: number; y: number; z: number };

/** Multiply two 4×4 row-major matrices: C = A * B */
function mul(A: Mat4, B: Mat4): Mat4 {
  const C = new Array<number>(16).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      for (let k = 0; k < 4; k++) s += A[r * 4 + k]! * B[k * 4 + c]!;
      C[r * 4 + c] = s;
    }
  }
  return C;
}

/** Identity matrix */
function identity(): Mat4 {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
}

/** Translation matrix */
function translation(tx: number, ty: number, tz: number): Mat4 {
  return [
    1, 0, 0, tx,
    0, 1, 0, ty,
    0, 0, 1, tz,
    0, 0, 0,  1,
  ];
}

/** Rotation about X axis by angle radians (right-hand rule) */
function rotateX(a: number): Mat4 {
  const c = Math.cos(a), s = Math.sin(a);
  return [
    1,  0,  0, 0,
    0,  c, -s, 0,
    0,  s,  c, 0,
    0,  0,  0, 1,
  ];
}

/** Rotation about Y axis by angle radians (right-hand rule) */
function rotateY(a: number): Mat4 {
  const c = Math.cos(a), s = Math.sin(a);
  return [
     c, 0, -s, 0,
     0, 1,  0, 0,
     s, 0,  c, 0,
     0, 0,  0, 1,
  ];
}

/** Apply 4×4 row-major matrix M to a Vec3 (homogeneous divide) */
export function apply(M: Mat4, v: Vec3): Vec3 {
  const { x, y, z } = v;
  /* eslint-disable @typescript-eslint/no-non-null-assertion */
  const w = M[12]! * x + M[13]! * y + M[14]! * z + M[15]!;
  return {
    x: (M[0]! * x + M[1]! * y + M[2]!  * z + M[3]!)  / w,
    y: (M[4]! * x + M[5]! * y + M[6]!  * z + M[7]!)  / w,
    z: (M[8]! * x + M[9]! * y + M[10]! * z + M[11]!) / w,
  };
  /* eslint-enable @typescript-eslint/no-non-null-assertion */
}

export type ViewOrientation =
  | 'front' | 'top' | 'right' | 'back' | 'bottom' | 'left'
  | 'iso-NE' | 'iso-NW' | 'iso-SE' | 'iso-SW';

/**
 * Build the view matrix for a given orientation and source bounding box.
 *
 * Pipeline (applied right-to-left in column-major, but written left-to-right here):
 *   M = T_offset · S_scale · R_orient · T_recenter
 *
 * S_scale and T_offset are identity here — scale is applied at render time.
 * T_recenter translates the bbox centre to the origin to minimise float error.
 */
export function buildViewMatrix(orientation: ViewOrientation, sourceBbox: BoundingBox): Mat4 {
  const [minX, minY, minZ, maxX, maxY, maxZ] = sourceBbox;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;

  const Trecenter = translation(-cx, -cy, -cz);

  let Rorient: Mat4;

  switch (orientation) {
    case 'front':
      Rorient = identity();
      break;
    case 'top':
      Rorient = rotateX(-Math.PI / 2);
      break;
    case 'right':
      Rorient = rotateY(-Math.PI / 2);
      break;
    case 'back':
      Rorient = rotateY(Math.PI);
      break;
    case 'bottom':
      Rorient = rotateX(Math.PI / 2);
      break;
    case 'left':
      Rorient = rotateY(Math.PI / 2);
      break;
    case 'iso-NE':
      Rorient = mul(rotateX(-Math.atan(1 / Math.sqrt(2))), rotateY(Math.PI / 4));
      break;
    case 'iso-NW':
      Rorient = mul(rotateX(-Math.atan(1 / Math.sqrt(2))), rotateY(-Math.PI / 4));
      break;
    case 'iso-SE':
      Rorient = mul(rotateX(-Math.atan(1 / Math.sqrt(2))), rotateY((3 * Math.PI) / 4));
      break;
    case 'iso-SW':
      Rorient = mul(rotateX(-Math.atan(1 / Math.sqrt(2))), rotateY((-3 * Math.PI) / 4));
      break;
    default: {
      const _exhaustive: never = orientation;
      throw new Error(`Unknown orientation: ${_exhaustive}`);
    }
  }

  // M = Rorient · Trecenter  (T_offset and S_scale are identity)
  return mul(Rorient, Trecenter);
}
