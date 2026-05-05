// packages/shared/src/drawing/planeFingerprint.ts
// Uses a synchronous djb2 hash — browser-safe, no Node.js crypto required.

const HASH_TOL = 1e-3; // mm

function roundTo(v: number, tol: number): number {
  return Math.round(v / tol) * tol;
}

type Vec3Like = { x: number; y: number; z: number };

function normalizeVec3(v: Vec3Like): Vec3Like {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (len < 1e-12) return { x: 0, y: 0, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/** djb2 hash — deterministic, browser-safe. */
function djb2(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
    h = h >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function fingerprintPlane(plane: { origin: Vec3Like; normal: Vec3Like }): string {
  const norm = normalizeVec3(plane.normal);
  const payload = [
    roundTo(plane.origin.x, HASH_TOL),
    roundTo(plane.origin.y, HASH_TOL),
    roundTo(plane.origin.z, HASH_TOL),
    roundTo(norm.x, HASH_TOL),
    roundTo(norm.y, HASH_TOL),
    roundTo(norm.z, HASH_TOL),
  ].join(',');
  return djb2(payload);
}
