/**
 * Drawer-front sizing per §14.1 (присадка slice 4 — collision-free overlay gap model).
 *
 * Does NOT call doorMath — imports only CONSTANTS from that module plus drawerConventions.
 * DOOR_POSE is imported from prisadkaFaceConventions (single source of truth).
 */

import { DRAWER_FRONT_GAP, DRAWER_FRONT_THICKNESS, overlayOverhang } from './drawerConventions';
import { DOOR_POSE } from './prisadkaFaceConventions';
import type { Slot } from './drawerBankLayout';
import type { Vec3 } from './types';

export interface DrawerFrontParams {
  /** Cabinet panel thickness Tc (used to compute full/half overhang). */
  Tc: number;
  /** Overlay reveal (mm) — used for door mode; kept for API parity, not used in front sizing. */
  reveal: number;
  /** Inset clearance c (mm) — inset fronts retract by this on every edge. */
  insetClearance: number;
}

export interface DrawerFrontResult {
  index: number;
  bottomZ: number;
  topZ: number;
  width: number;
  height: number;
  thickness: number;
  pose: {
    translation: Vec3;
    quaternion: [number, number, number, number];
  };
}

/**
 * Compute the front panel geometry for drawer `index` within a bank of `n` drawers.
 *
 * §14.1 formula:
 *   slotH     = openH / n
 *   slotBottomZ_i = openBottomZ + i * slotH
 *   slotTopZ_i    = openBottomZ + (i+1) * slotH
 *
 * Full/half overlay:
 *   overhang  = overlayOverhang(overlay, Tc)    // Tc for full; Tc/2 for half; 0 for inset
 *   bottomZ_i = slotBottomZ_i + (i === 0     ? -overhang : +GAP/2)
 *   topZ_i    = slotTopZ_i    + (i === n - 1 ? +overhang : -GAP/2)
 *
 * Inset:
 *   bottomZ_i = slotBottomZ_i + c
 *   topZ_i    = slotTopZ_i    - c
 *   width     = openW - 2c
 *
 * Invariant (tested): adjacent bottomZ_{i+1} - topZ_i === DRAWER_FRONT_GAP (> 0, no overlap).
 *
 * @param index   0-based drawer index (bottom drawer = 0).
 * @param n       Total number of drawers in the bank.
 * @param slot    Pre-computed slot edges from drawerBankLayout.
 * @param opening Cabinet opening geometry (width + front Y; Z edges come from slot).
 * @param overlay 'full' | 'half' | 'inset'.
 * @param params  Tc, reveal, insetClearance.
 */
export function drawerFrontMath(
  index: number,
  n: number,
  slot: Slot,
  opening: { openW: number; frontY: number },
  overlay: 'full' | 'half' | 'inset',
  params: DrawerFrontParams,
): DrawerFrontResult {
  const { openW, frontY } = opening;
  const { Tc, insetClearance: c } = params;

  const slotBottomZ = slot.bottomZ;
  const slotTopZ = slot.topZ;

  let bottomZ: number;
  let topZ: number;
  let width: number;

  if (overlay === 'inset') {
    bottomZ = slotBottomZ + c;
    topZ = slotTopZ - c;
    width = openW - 2 * c;
  } else {
    // full or half overlay
    const overhang = overlayOverhang(overlay, Tc);
    const GAP = DRAWER_FRONT_GAP;
    bottomZ = slotBottomZ + (index === 0 ? -overhang : GAP / 2);
    topZ = slotTopZ + (index === n - 1 ? overhang : -GAP / 2);
    width = openW + 2 * overhang;
  }

  const height = topZ - bottomZ;
  const thickness = DRAWER_FRONT_THICKNESS;

  // Pose: front-face center at (openW/2, frontY, centerZ).
  // Quaternion = DOOR_POSE (part-X=height→world-Z, part-Y=width→world-X, part-Z=thickness→world-Y).
  const centerZ = (bottomZ + topZ) / 2;
  const translation: Vec3 = { x: openW / 2, y: frontY, z: centerZ };

  return {
    index,
    bottomZ,
    topZ,
    width,
    height,
    thickness,
    pose: {
      translation,
      quaternion: DOOR_POSE.quaternion,
    },
  };
}
