import type { Vec3 } from './types';
import type { GrooveSpec } from './groove';
import { face2DFrame, faceExtents } from './bore';

/** mm the cutter pokes proud of the face so the boolean subtraction is clean
 *  (avoids a coincident top face, which OCCT can leave as a no-op sliver). */
const OVERCUT = 0.1;

type Dims = { length: number; width: number; thickness: number };

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function corner(
  origin: Vec3,
  uDir: Vec3,
  vDir: Vec3,
  normal: Vec3,
  u: number,
  v: number,
  n: number,
): Vec3 {
  return {
    x: origin.x + u * uDir.x + v * vDir.x + n * normal.x,
    y: origin.y + u * uDir.y + v * vDir.y + n * normal.y,
    z: origin.z + u * uDir.z + v * vDir.z + n * normal.z,
  };
}

/**
 * The two opposite corners of the axis-aligned cutter box for `spec`, in
 * panel-local coordinates (the panel solid spans [-L/2,-W/2,0]..[L/2,W/2,T]).
 *
 * The box spans the full face extent along the run axis, ±width/2 across the
 * cross axis centred at `position`, and from `OVERCUT` proud of the face down to
 * `depth` into the panel. Every panel face frame is axis-aligned, so these two
 * corners feed straight into `BRepPrimAPI_MakeBox_4(p1, p2)`.
 */
export function buildGrooveCutter(panelDims: Dims, spec: GrooveSpec): { p1: Vec3; p2: Vec3 } {
  const { origin, uDir, vDir } = face2DFrame(panelDims, spec.faceRole);
  const { uLen, vLen } = faceExtents(panelDims, spec.faceRole);
  const normal = cross(uDir, vDir); // outward unit normal of the face
  const halfW = spec.width / 2;

  let uA: number, uB: number, vA: number, vB: number;
  if (spec.axis === 'u') {
    uA = 0;
    uB = uLen;
    vA = spec.position - halfW;
    vB = spec.position + halfW;
  } else {
    vA = 0;
    vB = vLen;
    uA = spec.position - halfW;
    uB = spec.position + halfW;
  }

  // n axis: +OVERCUT is proud of the face (outward), -depth is into the panel.
  const p1 = corner(origin, uDir, vDir, normal, uA, vA, OVERCUT);
  const p2 = corner(origin, uDir, vDir, normal, uB, vB, -spec.depth);
  return { p1, p2 };
}
