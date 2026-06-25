/**
 * drawerBoxMath — 5-panel butt-jointed drawer box (присадка slice 4, §14.2/14.9).
 *
 * Box-local coordinate frame (box origin = front-bottom-left corner):
 *   +X = right (toward right side panel)
 *   +Y = depth (toward back of cabinet)
 *   +Z = up
 *
 * §14.2 AUTHORITATIVE: side panels MUST use {length: bh, width: bd, thickness: 16}
 * so that the panel's u-axis (part-X / length direction) = height.  This aligns
 * the bore u-coordinate with world-Z height for slide-rail boring.
 */

import {
  BOX_PANEL_THICKNESS as T,
  BOX_BOTTOM_THICKNESS,
  BOX_VERT_CLEARANCE,
  SLIDE_CLEARANCE_PER_SIDE,
  BOX_BACK_CLEARANCE,
} from './drawerConventions';
import { TANDEM_SLIDE_CLEARANCE_PER_SIDE } from './tandemConventions';
import type { PanelRole } from './cabinets/types';

type Vec3 = { x: number; y: number; z: number };
type Quaternion = [number, number, number, number];

export interface DrawerBoxPanel {
  role: Extract<PanelRole, 'drawerBox-side' | 'drawerBox-front' | 'drawerBox-back' | 'drawerBox-bottom'>;
  /** true for the left side panel, false for right; only set on side panels. */
  isLeft?: boolean;
  dims: { length: number; width: number; thickness: number };
  /** Box-local pose. translation = panel component origin in box-local frame.
   *  The component origin is the CENTROID of the panel (part built as
   *  [-L/2,-W/2,0]..[L/2,W/2,T]; centroid in part-frame = (0,0,T/2)).
   *  world_centroid = panelR*(0,0,T/2) + translation  (in box-local space). */
  pose: { translation: Vec3; quaternion: Quaternion };
}

export interface DrawerBoxResult {
  panels: DrawerBoxPanel[];
  outer: { width: number; height: number; depth: number };
}

/** Slot from drawerBankLayout: bottomZ and topZ in cabinet-local coordinates. */
export interface BoxSlot {
  bottomZ: number;
  topZ: number;
}

/** Opening geometry of the cabinet. */
export interface BoxOpening {
  openW: number;   // inner width of cabinet opening (mm)
  innerD: number;  // inner depth of cabinet (mm)
  slideSystem?: 'sideMount' | 'tandem';
}

// ---------------------------------------------------------------------------
// Quaternion for upright panels whose face normal points along ±X.
//
// Rotation: part-X(length) → world-Z (+up), part-Y(width) → world-(-Y) (depth
// runs from front toward back, but part-Y is oriented front→back = negative Y),
// part-Z(thickness) → world-+X.
//
// Matrix R (col0=world-image-of-part-X, col1=..., col2=...):
//   col0 = (0, 0, 1)   part-X → +Z
//   col1 = (0,-1, 0)   part-Y → -Y
//   col2 = (1, 0, 0)   part-Z → +X
// det = 1 ✓  (verified by cofactor expansion)
//
// Quaternion derived from Shepperd's method applied to this R matrix:
//   trace = 0 - 1 + 0 = -1.  R[0][0]=0 > R[1][1]=-1: use x-branch.
//   s = 2*sqrt(1 + R[0][0] - R[1][1] - R[2][2]) = 2*sqrt(1+0+1-0) = 2√2
//   x = 0.25*s = √2/2
//   y = (R[0][1]+R[1][0])/s = 0
//   z = (R[0][2]+R[2][0])/s = (1+1)/(2√2) = 1/√2 = √2/2
//   w = (R[2][1]-R[1][2])/s = 0
//   Normalized: q = [√2/2, 0, √2/2, 0]
//
// This gives centroid offset R*(0,0,T/2) = (T/2, 0, 0) — thickness/2 in world-X.
// ---------------------------------------------------------------------------
const SIDE_PANEL_QUAT: Quaternion = [Math.SQRT2 / 2, 0, Math.SQRT2 / 2, 0];

// ---------------------------------------------------------------------------
// Quaternion for front/back panels (face normal pointing ±Y).
//
// Rotation: part-X(length) → world-+X, part-Y(width) → world-+Z (height up),
// part-Z(thickness) → world-+Y.
//
// col0=(1,0,0), col1=(0,0,1), col2=(0,1,0).
// det = 1*(0*0-1*1) + ... = -1. REFLECTION — not valid.
//
// Use instead: part-X → +X, part-Y → -Z (height goes down in part-Y, but
// symmetrically fine for panels), part-Z → +Y (thickness points into box).
//   col0=(1,0,0), col1=(0,0,-1), col2=(0,1,0).
//   R = [[1,0,0],[0,0,1],[0,-1,0]]
//   det = 1*(0*0-1*(-1)) = 1 ✓
//
// Quaternion: trace = 1+0+0=1 > 0.
//   s = 0.5/sqrt(2), w = sqrt(2)/2
//   x = (R[2][1]-R[1][2])/s_denom = (-1-1)/(4*(0.5/sqrt(2)))... let me redo:
//   With trace>0: s_coeff = 0.5/sqrt(trace+1) = 0.5/sqrt(2)
//   w = 0.25/s_coeff = 0.25/(0.5/sqrt(2)) = 0.25*2/sqrt(2)*sqrt(2) = sqrt(2)/2 ≈ 0.707
//   x = (R[2][1]-R[1][2])*s_coeff = (-1-1)*0.5/sqrt(2) = -1/sqrt(2) = -sqrt(2)/2
//   y = (R[0][2]-R[2][0])*s_coeff = (0-0)*0.5/sqrt(2) = 0
//   z = (R[1][0]-R[0][1])*s_coeff = (0-0)*0.5/sqrt(2) = 0
//   q = [-sqrt(2)/2, 0, 0, sqrt(2)/2]
//
// Verify R*(0,0,T/2): col2 = (0,1,0) → offset = (0,T/2,0) ✓
// ---------------------------------------------------------------------------
const FRONT_BACK_QUAT: Quaternion = [-Math.SQRT2 / 2, 0, 0, Math.SQRT2 / 2];

// ---------------------------------------------------------------------------
// Quaternion for bottom panel (face normal pointing +Z).
//
// Bottom is horizontal, flush with box bottom (z=0). Normal points up (+Z = part-Z).
// Standard PanelOps default: thickness along +Z. So identity rotation works.
// part-X(length) → world-+X, part-Y(width) → world-+Y, part-Z(thickness) → +Z.
// q = [0, 0, 0, 1] (identity).
// Centroid offset R*(0,0,BOT/2) = (0,0,BOT/2) → world-z = BOT/2.
// ---------------------------------------------------------------------------
const BOTTOM_QUAT: Quaternion = [0, 0, 0, 1];

export function drawerBoxMath(slot: BoxSlot, opening: BoxOpening): DrawerBoxResult {
  const slotH = slot.topZ - slot.bottomZ;

  // §14.2 authoritative dimensions
  const clearance = opening.slideSystem === 'tandem'
    ? TANDEM_SLIDE_CLEARANCE_PER_SIDE
    : SLIDE_CLEARANCE_PER_SIDE;
  const bw = opening.openW - 2 * clearance; // box outer width
  const bh = slotH - 2 * BOX_VERT_CLEARANCE;               // box outer height
  const bd = opening.innerD - BOX_BACK_CLEARANCE;           // box outer depth

  // Front/back panel inner width (fits between the two side panels)
  const fbLen = bw - 2 * T;
  // Bottom panel inner dimensions (sits between sides AND front/back)
  const botLen = bw - 2 * T;
  const botWid = bd - 2 * T;

  // ---------------------------------------------------------------------------
  // Panel poses in box-local frame (origin = front-bottom-left corner).
  //
  // Side panel centroids:
  //   Left:  (T/2, bd/2, bh/2)
  //   Right: (bw - T/2, bd/2, bh/2)
  //
  // With SIDE_PANEL_QUAT: centroid offset = R*(0,0,T/2) = (T/2, 0, 0).
  //   pose.translation = centroid - offset:
  //   Left:  (T/2 - T/2, bd/2, bh/2) = (0, bd/2, bh/2)
  //   Right: (bw - T/2 - T/2, bd/2, bh/2) = (bw - T, bd/2, bh/2)
  //
  // Front/back centroids:
  //   Front: (bw/2, T/2, bh/2)
  //   Back:  (bw/2, bd - T/2, bh/2)
  //
  // With FRONT_BACK_QUAT: R*(0,0,T/2): col2=(0,1,0) → offset=(0,T/2,0).
  //   pose.translation = centroid - offset:
  //   Front: (bw/2, T/2 - T/2, bh/2) = (bw/2, 0, bh/2)
  //   Back:  (bw/2, bd - T/2 - T/2, bh/2) = (bw/2, bd - T, bh/2)
  //
  // Bottom centroid: (bw/2, bd/2, BOT/2)
  // With identity quat: offset=(0,0,BOT/2).
  //   pose.translation = (bw/2, bd/2, BOT/2 - BOT/2) = (bw/2, bd/2, 0)
  // ---------------------------------------------------------------------------

  const BOT = BOX_BOTTOM_THICKNESS;

  const panels: DrawerBoxPanel[] = [
    // Left side panel: §14.2 requires {length:bh, width:bd, thickness:T}
    {
      role: 'drawerBox-side',
      isLeft: true,
      dims: { length: bh, width: bd, thickness: T },
      pose: {
        translation: { x: 0, y: bd / 2, z: bh / 2 },
        quaternion: SIDE_PANEL_QUAT,
      },
    },
    // Right side panel: same dims; pose shifted to right wall
    {
      role: 'drawerBox-side',
      isLeft: false,
      dims: { length: bh, width: bd, thickness: T },
      pose: {
        translation: { x: bw - T, y: bd / 2, z: bh / 2 },
        quaternion: SIDE_PANEL_QUAT,
      },
    },
    // Front panel (box front wall, at y=0..T, sits between the two sides)
    {
      role: 'drawerBox-front',
      dims: { length: fbLen, width: bh, thickness: T },
      pose: {
        translation: { x: bw / 2, y: 0, z: bh / 2 },
        quaternion: FRONT_BACK_QUAT,
      },
    },
    // Back panel (box back wall, at y=bd-T..bd)
    {
      role: 'drawerBox-back',
      dims: { length: fbLen, width: bh, thickness: T },
      pose: {
        translation: { x: bw / 2, y: bd - T, z: bh / 2 },
        quaternion: FRONT_BACK_QUAT,
      },
    },
    // Bottom panel (horizontal, flush with box bottom, sits inside sides+front+back)
    {
      role: 'drawerBox-bottom',
      dims: { length: botLen, width: botWid, thickness: BOT },
      pose: {
        translation: { x: bw / 2, y: bd / 2, z: 0 },
        quaternion: BOTTOM_QUAT,
      },
    },
  ];

  return {
    panels,
    outer: { width: bw, height: bh, depth: bd },
  };
}
