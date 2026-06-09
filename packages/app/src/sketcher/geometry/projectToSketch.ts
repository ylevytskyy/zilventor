import type { Vec3 } from '@zilventor/shared';

export type SketchFrame = {
  origin: Vec3;
  normal: Vec3;
  xDir: Vec3;
};

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/**
 * Project a 3D world-space point onto a sketch plane, returning (u, v) local coords.
 * u = dot(p - origin, xDir)
 * v = dot(p - origin, yDir) where yDir = cross(normal, xDir)
 *
 * The yDir is computed as cross(normal, xDir) so that (xDir, yDir, normal) form
 * a right-handed orthonormal frame. For a workplane with normal=(0,0,1), xDir=(1,0,0):
 *   yDir = (0,0,1)×(1,0,0) = (0,1,0)  — standard screen-space U-right, V-up.
 */
export function projectToSketch(p: Vec3, frame: SketchFrame): { u: number; v: number } {
  const yDir = cross(frame.normal, frame.xDir);
  const rel = sub(p, frame.origin);
  return {
    u: dot(rel, frame.xDir),
    v: dot(rel, yDir),
  };
}
