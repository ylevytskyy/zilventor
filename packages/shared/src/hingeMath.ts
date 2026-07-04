import type { BoreOp, BoreRole, PanelFaceRole } from './bore';

// ─── Hinge geometry constants (spec §7b; shop-tunable, lead review deferred §15) ───
export const CUP_DIAMETER = 35;
export const CUP_DEPTH = 12;        // blind; < Td(18)
export const CUP_SETBACK = { full: 21, half: 28, inset: 37 } as const; // mm from hinge edge, per overlay
export const PLATE_DIAMETER = 5;
export const PLATE_DEPTH = 13;      // blind
export const PLATE_PAIR_SPACING = 32; // two plate holes per hinge, along u
export const HINGE_END_INSET = 100; // top/bottom hinge ~100mm from door ends

/** Hinge count from door height (spec §7b): ≤900→2, ≤1500→3, ≤2000→4, ≤2400→5, else 5. */
export function hingeCountForHeight(doorH: number): number {
  if (doorH <= 900) return 2;
  if (doorH <= 1500) return 3;
  if (doorH <= 2000) return 4;
  return 5; // ≤2400 and >2400 both clamp to 5 (contract default)
}

/**
 * Hinge Z centers along the door height (the part-local u axis = +X = doorH on
 * the broad cup face). Ends sit ~HINGE_END_INSET from the door ends; interior
 * hinges are spaced evenly between them. count=1 degenerates to mid-height.
 */
export function hingePositions(doorH: number, count: number): number[] {
  if (count <= 1) return [doorH / 2];
  const first = HINGE_END_INSET;
  const last = doorH - HINGE_END_INSET;
  const step = (last - first) / (count - 1);
  return Array.from({ length: count }, (_, i) => first + i * step);
}

/**
 * Ø35 hinge cups on the door's carcass-facing broad face (Top/Bottom, from
 * Phase-0 DOOR_CUP_FACE imported by the caller). u = +X = along doorH (the shared
 * hinge positions); v = ∓Y = along doorW, set back from the hinge-side edge:
 *   hingeSide='left'  → edge at v=0     → v = CUP_SETBACK[overlay]
 *   hingeSide='right' → edge at v=doorW → v = doorW − CUP_SETBACK[overlay]
 */
export function hingeCupBores(
  doorDims: { length: number; width: number; thickness: number }, // length=doorH, width=doorW, thickness=Td
  cupFace: 'Top' | 'Bottom',   // caller passes DOOR_CUP_FACE from prisadkaFaceConventions
  hingeSide: 'left' | 'right',
  overlay: 'full' | 'half' | 'inset',
  uPositions: number[],
  sku?: string, // caller-resolved hardware-catalog id (CatalogEntry.id), stamped onto every cup
): BoreOp[] {
  const setback = CUP_SETBACK[overlay];
  const v = hingeSide === 'left' ? setback : doorDims.width - setback;
  return uPositions.map((u, i) => ({
    id: `hinge-${i}-cup`,
    face: { featureId: 'panel', role: cupFace as PanelFaceRole, instance: 0 },
    u,
    v,
    diameter: CUP_DIAMETER,
    depth: CUP_DEPTH,
    role: 'hingeCup' as BoreRole,
    connectorId: `hinge-${i}`,
    connectorKind: 'hinge',
    ...(sku ? { sku } : {}),
  }));
}

/**
 * Ø5 plate-mount holes on the side panel's broad inner face (Top/Bottom, from
 * Phase-0 *_INNER_FACE imported by the caller). Per hinge: 2 holes PLATE_PAIR_SPACING
 * apart along the panel height (u), centered on the SHARED hinge u (so plate Z == cup Z
 * by construction), at the front column setback (v = frontSetback).
 */
export function hingePlateBores(
  sideDims: { length: number; width: number; thickness: number }, // UNSWAPPED native: length=H, width=D, thickness=Tc
  innerFace: 'Top' | 'Bottom',  // caller passes LEFT/RIGHT_SIDE_INNER_FACE from prisadkaFaceConventions
  uPositions: number[],
  frontSetback: number,
  params?: { diameter?: number; depth?: number; pairSpacing?: number },
  sku?: string, // caller-resolved hardware-catalog id (CatalogEntry.id), stamped onto every plate hole
): BoreOp[] {
  const diameter = params?.diameter ?? PLATE_DIAMETER;
  const depth = params?.depth ?? PLATE_DEPTH;
  const spacing = params?.pairSpacing ?? PLATE_PAIR_SPACING;
  const half = spacing / 2;
  const bores: BoreOp[] = [];
  uPositions.forEach((u, i) => {
    for (const [n, du] of [[0, -half], [1, +half]] as const) {
      bores.push({
        id: `hinge-${i}-plate-${n}`,
        face: { featureId: 'panel', role: innerFace as PanelFaceRole, instance: 0 },
        u: u + du,
        v: frontSetback,
        diameter,
        depth,
        role: 'hingePlate' as BoreRole,
        connectorId: `hinge-${i}`,
        connectorKind: 'hinge',
        ...(sku ? { sku } : {}),
      });
    }
  });
  return bores;
}

