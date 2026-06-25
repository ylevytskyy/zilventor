import type { BoreOp, BoreRole } from './bore';
import {
  BOX_VERT_CLEARANCE,
  DRAWER_SLIDE_FRONT_SETBACK,
  DRAWER_SLIDE_HOLE_DEPTH,
  DRAWER_SLIDE_HOLE_DIAMETER,
  DRAWER_SLIDE_MIN_HOLES,
  SLIDE_GRID_PITCH,
} from './drawerConventions';
import {
  LEFT_SIDE_INNER_FACE,
  RIGHT_SIDE_INNER_FACE,
} from './prisadkaFaceConventions';

export interface DrawerSlideCtx {
  drawerIndex: number;
  openBottomZ: number;
  slotH: number;
  bh: number; // box height = slotH − 2·BOX_VERT_CLEARANCE
  cabinet: { H: number; D: number; Tc: number };
  box: { bd: number; bw?: number };
  slideLength: number;
}

/**
 * Emits Ø5 BoreOps for one drawer's slide rail:
 *  - cabinet-side: on the cabinet's left (inner face='Top') + right (inner face='Bottom') side panels
 *  - box-side: mirrored on the drawer-box's two side panels (role='drawerSlide-box')
 *
 * World-Z alignment (§14.4):
 *   slideWorldZ = openBottomZ + i·slotH + BOX_VERT_CLEARANCE + bh/2
 *
 * Panel-local u mapping:
 *   Cabinet side panel (length=H, panel bottom at world-Z=0):
 *     world-Z = u  →  u_cabinet = slideWorldZ
 *   Box side panel (length=bh, box bottom at world-Z = openBottomZ + i·slotH + BOX_VERT_CLEARANCE):
 *     world-Z = boxOriginZ + u  →  u_box = slideWorldZ − boxOriginZ = bh/2
 *
 * V positions: Система-32 grid starting at DRAWER_SLIDE_FRONT_SETBACK, pitch=32mm, ≥2 holes.
 */
export function drawerSlideMath(ctx: DrawerSlideCtx): {
  cabinetBores: BoreOp[];
  boxBores: BoreOp[];
} {
  const { drawerIndex: i, openBottomZ, slotH, bh, slideLength } = ctx;

  // Rail center in world space — the independent oracle target (§14.4)
  const slideWorldZ = openBottomZ + i * slotH + BOX_VERT_CLEARANCE + bh / 2;

  // Cabinet side panel: length=H, bottom at world-Z=0, so u = slideWorldZ
  const uCabinet = slideWorldZ;

  // Box side panel: length=bh, box bottom at openBottomZ + i*slotH + BOX_VERT_CLEARANCE
  // u = slideWorldZ − boxOriginZ = bh/2 (always the box mid-height)
  const uBox = bh / 2;

  // Система-32 grid: ≥2 holes spanning slideLength
  const holeCount = Math.max(
    DRAWER_SLIDE_MIN_HOLES,
    Math.floor((slideLength - DRAWER_SLIDE_FRONT_SETBACK) / SLIDE_GRID_PITCH) + 1,
  );
  const vPositions = Array.from(
    { length: holeCount },
    (_, k) => DRAWER_SLIDE_FRONT_SETBACK + k * SLIDE_GRID_PITCH,
  );

  const sides = [
    { side: 'L' as const, face: LEFT_SIDE_INNER_FACE },
    { side: 'R' as const, face: RIGHT_SIDE_INNER_FACE },
  ];

  const cabinetBores: BoreOp[] = [];
  const boxBores: BoreOp[] = [];

  for (const { side, face } of sides) {
    const connectorId = `drawerSlide-${i}-${side}`;

    vPositions.forEach((v, k) => {
      cabinetBores.push({
        id: `drawerSlide-${i}-${side}-cab-${k}`,
        face: { featureId: 'panel', role: face, instance: 0 },
        u: uCabinet,
        v,
        diameter: DRAWER_SLIDE_HOLE_DIAMETER,
        depth: DRAWER_SLIDE_HOLE_DEPTH,
        role: 'drawerSlide-cabinet' as BoreRole,
        connectorId,
        connectorKind: 'drawerSlide',
      });
      boxBores.push({
        id: `drawerSlide-${i}-${side}-box-${k}`,
        face: { featureId: 'panel', role: face, instance: 0 },
        u: uBox,
        v,
        diameter: DRAWER_SLIDE_HOLE_DIAMETER,
        depth: DRAWER_SLIDE_HOLE_DEPTH,
        role: 'drawerSlide-box' as BoreRole,
        connectorId,
        connectorKind: 'drawerSlide',
      });
    });
  }

  return { cabinetBores, boxBores };
}
