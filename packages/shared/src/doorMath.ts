import type { DoorSpec, Vec3 } from './types';
import { DOOR_POSE } from './prisadkaFaceConventions';
import { hingeCountForHeight } from './hingeMath';

export const DEFAULT_DOOR_THICKNESS = 18; // Td
export const DEFAULT_REVEAL = 2;          // r  (overlay)
export const DEFAULT_CLEARANCE = 2;       // c  (inset)
export const DEFAULT_CENTER_REVEAL = 3;   // cr (double)

export interface DoorMathInput {
  cabinet: { width: number; height: number; depth: number; Tc: number; toekickHeight: number };
  count: 'single' | 'double';
  overlay: 'full' | 'half' | 'inset';
  hingeSide: 'left' | 'right'; // single only; ignored for double
  thickness: number;           // Td, default 18
  reveal: number;              // r, default 2 (overlay)
  clearance: number;           // c, default 2 (inset)
  centerReveal: number;        // cr, default 3 (double)
  /** Door construction style. Absent/'slab' = single panel (legacy). 'shaker'/
   *  'raisedPanel' = framed door built as a nested rail+stile+panel .ziasm.
   *  Additive (v27) — no migration; doorMath itself is style-agnostic (it sizes
   *  the OUTER door leaves), the command reads style to choose the builder. */
  style?: 'slab' | 'shaker' | 'raisedPanel';
  /** Rail & stile width for framed styles (mm). Default 70. */
  frameWidth?: number;
  /** Center-panel thickness for framed styles (mm). Default = thickness. */
  panelThickness?: number;
}

export interface DoorPanel {
  dims: { length: number; width: number; thickness: number }; // length=doorH, width=doorW, thickness=Td
  pose: { translation: Vec3; quaternion: [number, number, number, number] };
  doorSpec: DoorSpec;
}

interface Sizing {
  doorH: number;
  /** total combined door width available (single = one leaf; double = sum of both leaves) */
  totalDoorW: number;
}

function sizing(input: DoorMathInput): Sizing {
  const { width: W, height: H, Tc, toekickHeight: tkH } = input.cabinet;
  const r = input.reveal;
  const c = input.clearance;
  if (input.overlay === 'inset') {
    const Wo = W - 2 * Tc;
    const innerOpeningH = H - tkH - 2 * Tc;
    return { doorH: innerOpeningH - 2 * c, totalDoorW: Wo - 2 * c };
  }
  // full + half overlay sit OVER the front; sizing identical (half differs only
  // in the cup setback constant, applied later in hingeMath).
  return { doorH: H - 2 * r, totalDoorW: W - 2 * r };
}

export function doorMath(input: DoorMathInput): DoorPanel[] {
  const { doorH, totalDoorW } = sizing(input);
  const Td = input.thickness;
  const hingeCount = hingeCountForHeight(doorH);

  // World Y position of the door plane: at the cabinet front (y = depth), proud
  // for overlay, flush-into-opening for inset. The exact proud/recess offset is
  // derived from Phase 0's DOOR_POSE; the cabinet-front Y is the door plane.
  const frontY =
    input.overlay === 'inset'
      ? input.cabinet.depth - Td // recessed into the opening (front board face)
      : input.cabinet.depth;     // overlay door sits just proud of the front

  // The rotation quaternion is the Phase-0-derived upright pose — NEVER a local
  // re-declaration. Only the per-door translation is computed here.
  const quaternion = DOOR_POSE.quaternion;

  if (input.count === 'single') {
    const doorW = totalDoorW;
    return [
      {
        dims: { length: doorH, width: doorW, thickness: Td },
        pose: {
          translation: { x: input.cabinet.width / 2, y: frontY, z: input.cabinet.height / 2 },
          quaternion,
        },
        doorSpec: {
          overlay: input.overlay,
          hingeSide: input.hingeSide,
          pair: 'single',
          hingeCount,
        },
      },
    ];
  }

  // double: split totalDoorW into two equal leaves with a center clearance.
  // overlay center clearance = centerReveal; inset center clearance = centerReveal
  // (both consume the same gap between leaves).
  const each = (totalDoorW - input.centerReveal) / 2;
  const halfSpan = each / 2 + input.centerReveal / 2; // leaf-center offset from cabinet center
  return [
    {
      dims: { length: doorH, width: each, thickness: Td },
      pose: {
        translation: { x: input.cabinet.width / 2 - halfSpan, y: frontY, z: input.cabinet.height / 2 },
        quaternion,
      },
      doorSpec: { overlay: input.overlay, hingeSide: 'left', pair: 'pairLeft', hingeCount },
    },
    {
      dims: { length: doorH, width: each, thickness: Td },
      pose: {
        translation: { x: input.cabinet.width / 2 + halfSpan, y: frontY, z: input.cabinet.height / 2 },
        quaternion,
      },
      doorSpec: { overlay: input.overlay, hingeSide: 'right', pair: 'pairRight', hingeCount },
    },
  ];
}
