import type { Vec3 } from '@zilventor/shared';

export type Quat = [number, number, number, number];  // [x, y, z, w]

export function quatRotateVec(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  // v' = v + 2 * cross(qxyz, cross(qxyz, v) + w * v)
  const cx = y * v.z - z * v.y + w * v.x;
  const cy = z * v.x - x * v.z + w * v.y;
  const cz = x * v.y - y * v.x + w * v.z;
  return {
    x: v.x + 2 * (y * cz - z * cy),
    y: v.y + 2 * (z * cx - x * cz),
    z: v.z + 2 * (x * cy - y * cx),
  };
}

export function quatMultiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function quatNormalize(q: Quat): Quat {
  const n = Math.sqrt(q[0] ** 2 + q[1] ** 2 + q[2] ** 2 + q[3] ** 2);
  if (n < 1e-12) return [0, 0, 0, 1];
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/**
 * Returns a 3×4 Jacobian ∂(R(q) v)/∂q for fixed local-frame vector v.
 * Columns: derivatives w.r.t. qx, qy, qz, qw.
 */
export function quatRotateVecJacobian(q: Quat, v: Vec3): number[][] {
  const [x, y, z, w] = q;
  const vx = v.x, vy = v.y, vz = v.z;
  // Closed-form derivative of R(q) v.
  return [
    [
      2 * (y * vy + z * vz),
      2 * (-2 * y * vx + x * vy + w * vz),
      2 * (-2 * z * vx - w * vy + x * vz),
      2 * (-z * vy + y * vz),
    ],
    [
      2 * (y * vx - 2 * x * vy - w * vz),
      2 * (x * vx + z * vz),
      2 * (w * vx - 2 * z * vy + y * vz),
      2 * (z * vx - x * vz),
    ],
    [
      2 * (z * vx + w * vy - 2 * x * vz),
      2 * (-w * vx + z * vy - 2 * y * vz),
      2 * (x * vx + y * vy),
      2 * (-y * vx + x * vy),
    ],
  ];
}

export function quatFromEulerXYZ(rxDeg: number, ryDeg: number, rzDeg: number): Quat {
  const rx = (rxDeg * Math.PI) / 180;
  const ry = (ryDeg * Math.PI) / 180;
  const rz = (rzDeg * Math.PI) / 180;
  const cx = Math.cos(rx / 2), sx = Math.sin(rx / 2);
  const cy = Math.cos(ry / 2), sy = Math.sin(ry / 2);
  const cz = Math.cos(rz / 2), sz = Math.sin(rz / 2);
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ];
}

export function quatToEulerXYZ(q: Quat): { rx: number; ry: number; rz: number } {
  const [x, y, z, w] = q;
  // Intrinsic XYZ (q = qx·qy·qz). R = Rx·Ry·Rz.
  // R13 = 2(xz+wy) = sin(ry)
  const sinRy = 2 * (x * z + w * y);
  const ry = Math.asin(Math.max(-1, Math.min(1, sinRy)));
  // R23 = 2(yz-wx) = -sin(rx)cos(ry),  R33 = 1-2(x²+y²) = cos(rx)cos(ry)
  const rx = Math.atan2(-2 * (y * z - w * x), 1 - 2 * (x * x + y * y));
  // R12 = 2(xy-wz) = -cos(ry)sin(rz),  R11 = 1-2(y²+z²) = cos(ry)cos(rz)
  const rz = Math.atan2(-2 * (x * y - w * z), 1 - 2 * (y * y + z * z));
  return { rx: (rx * 180) / Math.PI, ry: (ry * 180) / Math.PI, rz: (rz * 180) / Math.PI };
}
