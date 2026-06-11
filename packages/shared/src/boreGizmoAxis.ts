import type { Vec3 } from './types';
import type { BoreOp } from './bore';
import { rotate } from './jointMath';

const CARCASS_KINDS = new Set(['confirmat', 'minifix', 'dowel']);

/**
 * World move-axis for a draggable bore, or null if the kind has no defined drag axis.
 *
 * - Carcass kinds (confirmat/minifix/dowel): returns bore.jointDir (already world-space unit),
 *   or null if jointDir is absent.
 * - Hinge: returns the cup-face u-axis = rotate({1,0,0}, panelWorldQuat).
 * - shelfPin / drawerSlide / anything else: returns null (not draggable via gizmo).
 */
export function boreGizmoAxis(
  bore: BoreOp,
  panelWorldQuat: [number, number, number, number],
): Vec3 | null {
  if (CARCASS_KINDS.has(bore.connectorKind)) {
    return bore.jointDir ?? null;
  }
  if (bore.connectorKind === 'hinge') {
    return rotate({ x: 1, y: 0, z: 0 }, panelWorldQuat);
  }
  return null;
}
