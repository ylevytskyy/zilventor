import type { Vec3 } from './types';
import type { ConnectorMember } from './connectorCoupling';
import { rotate } from './jointMath';
import { face2DFrame, faceExtents, type PanelFaceRole } from './bore';

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

/**
 * Largest-magnitude delta (same sign as `requested`) keeping every member's bore
 * center within [r, faceLen − r] on both u and v axes.
 *
 * A single delta is returned and must be applied identically to all members so
 * coupled connectors stay in sync (no per-member clamp → desync).
 *
 * For each member, a unit of `delta` along `worldDir` shifts bore (u,v) by
 *   du = dot(worldDir, worldU),  dv = dot(worldDir, worldV)
 * where worldU/worldV = rotate(uDir/vDir, worldPose.quaternion).
 * The allowable signed-delta interval per member is intersected across all
 * members and the requested delta is clamped into it.
 */
export function clampDeltaToFaceExtents(
  members: ConnectorMember[],
  worldDir: Vec3,
  requested: number,
): number {
  let lo = -Infinity;
  let hi = Infinity;

  for (const m of members) {
    const { uDir, vDir } = face2DFrame(m.panelDims, m.bore.face.role as PanelFaceRole);
    const { uLen, vLen } = faceExtents(m.panelDims, m.bore.face.role as PanelFaceRole);
    const q = m.worldPose.quaternion;
    const worldU = rotate(uDir, q);
    const worldV = rotate(vDir, q);
    const du = dot(worldDir, worldU);
    const dv = dot(worldDir, worldV);
    const r = m.bore.diameter / 2;

    // For a given axis coef `c` and current coordinate `cur` on a face of length `len`,
    // the constraint cur + c*delta ∈ [r, len-r] gives two bounds t1 and t2.
    // When c > 0: t1 = (r - cur)/c (lower bound), t2 = (len-r - cur)/c (upper bound).
    // When c < 0: the inequality flips, so t1 becomes the upper bound and t2 the lower.
    // Math.min(t1,t2)/Math.max(t1,t2) handles both signs uniformly.
    const applyBound = (cur: number, coef: number, len: number): void => {
      if (Math.abs(coef) < 1e-9) return; // worldDir orthogonal to this axis: no constraint
      const t1 = (r - cur) / coef;
      const t2 = (len - r - cur) / coef;
      lo = Math.max(lo, Math.min(t1, t2));
      hi = Math.min(hi, Math.max(t1, t2));
    };

    applyBound(m.bore.u, du, uLen);
    applyBound(m.bore.v, dv, vLen);
  }

  return Math.max(lo, Math.min(hi, requested));
}
