import { face2DFrame, type BoreOp, type PanelFaceRole } from './bore';
import { rotate } from './jointMath';
import type { Vec3 } from './types';

export interface ConnectorMember {
  bore: BoreOp;                  // mutated in place (u += du, v += dv)
  panelDims: { length: number; width: number; thickness: number };
  worldPose: {
    translation: Vec3;
    quaternion: [number, number, number, number];
  };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * Convention-free coupled move of a connector along a world-space unit direction.
 *
 * For each member bore, the part-local face axes (uDir, vDir) are rotated to world
 * space by the panel's quaternion. The world translation Δ·worldDir is then projected
 * onto each axis to yield du/dv in panel-local face coordinates.
 *
 * This is face-convention-agnostic: it works for bSwapUV faces (Left/Right/Front/Back
 * endB on carcass joints), for hinge cup/plate pairs, and for any rotated cabinet pose.
 * No geometry literals are declared here.
 * Imports rotate() from jointMath.ts (single source — no duplication).
 * Does NOT import hingeMath or PLATE_PAIR_SPACING.
 */
export function translateConnectorAlong(
  members: ConnectorMember[],
  worldDir: Vec3,  // unit world vector
  delta: number,   // mm
): void {
  for (const { bore, panelDims, worldPose } of members) {
    const faceRole = bore.face.role as PanelFaceRole;
    const { uDir, vDir } = face2DFrame(panelDims, faceRole);
    const worldUDir = rotate(uDir, worldPose.quaternion);
    const worldVDir = rotate(vDir, worldPose.quaternion);
    bore.u += delta * dot(worldDir, worldUDir);
    bore.v += delta * dot(worldDir, worldVDir);
  }
}
