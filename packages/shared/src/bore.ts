import type { FaceName } from './types';

export type BoreRole =
  | 'confirmat-face' | 'confirmat-edge'
  | 'minifix-cam' | 'minifix-bolt' | 'minifix-cross'
  | 'dowel-face' | 'dowel-edge'
  | 'shelfPin-system32'   // Ø5 grid hole on a side INNER (Top/Bottom) face
  | 'hingeCup'            // Ø35 cup on a door INNER (Top/Bottom) face
  | 'hingePlate'          // Ø5 plate-mount hole on a side INNER face
  | 'drawerSlide-cabinet' // Ø5 Система-32 slide hole on a cabinet inner side
  | 'drawerSlide-box'    // Ø5 Система-32 slide hole on a drawer box side panel
  | 'handleScrew-face'  // Ø5 mounting hole on drawer front outward face
  | 'legLeveler';       // Ø4 baseplate screw hole on cabinet floor underside

export type BoreConnectorKind = 'confirmat' | 'minifix' | 'dowel' | 'shelfPin' | 'hinge' | 'drawerSlide' | 'handleScrew' | 'legLeveler';

/**
 * Hardware-boring op (присадка). One drill: a face, a panel-local (u,v) on that
 * face (mm, per face2DFrame), Ø, depth, role + connector grouping.
 * Panel faces use PanelOps roles: 'Top'|'Bottom'|'Front'|'Back'|'Left'|'Right'
 * with featureId:'panel', instance:0.
 */
export interface BoreOp {
  id: string;
  face: FaceName;          // { featureId:'panel', role: PanelFaceRole, instance:0 }
  u: number;
  v: number;
  diameter: number;
  depth: number | 'throughAll';
  role: BoreRole;
  connectorId: string;
  connectorKind: BoreConnectorKind;
  /** Set when a bore's geometry was manually changed; tells regeneration to preserve it.
   *  Absent-not-false contract (exactOptionalPropertyTypes). */
  edited?: boolean;
  /** World-space UNIT direction of the joint line, set by generateConfirmat/Minifix/Dowel
   *  as normalize(line.p1 − line.p0) from JointInput.line.
   *  Absent on hinge/shelf-pin bores and on legacy carcass bores.
   *  Absent-not-zero contract (exactOptionalPropertyTypes). */
  jointDir?: { x: number; y: number; z: number };
}

type Vec3 = { x: number; y: number; z: number };
export type PanelFaceRole = 'Top' | 'Bottom' | 'Front' | 'Back' | 'Left' | 'Right';

/**
 * Panel-local 2D coordinate frame for a face. Panel box (PanelOps.buildPanelBox):
 * [-L/2,-W/2,0]..[L/2,W/2,T], centered X/Y, bottom Z=0. Returns origin + orthonormal
 * uDir/vDir so P = origin + u*uDir + v*vDir; (uDir × vDir) points along the outward
 * face normal (Top=+Z, Bottom=-Z, Front=+Y, Back=-Y, Left=-X, Right=+X).
 *
 * Corrected cross-product table:
 *   Top:    u=+X, v=+Y  → (+X)×(+Y) = +Z ✓
 *   Bottom: u=+X, v=-Y  → (+X)×(-Y) = -Z ✓
 *   Front:  u=+Z, v=+X  → (+Z)×(+X) = +Y ✓  [note: (0,0,1)×(1,0,0) = (0·0−1·0, 1·1−0·0, 0·0−0·1) = (0,1,0)]
 *   Back:   u=+Z, v=-X  → (+Z)×(-X) = -Y ✓  [(0,0,1)×(-1,0,0) = (0,-1,0)]
 *   Left:   u=+Z, v=+Y  → (+Z)×(+Y) = -X ✓  [(0,0,1)×(0,1,0) = (-1,0,0)]
 *   Right:  u=+Z, v=-Y  → (+Z)×(-Y) = +X ✓  [(0,0,1)×(0,-1,0) = (1,0,0)]
 */
/**
 * The u/v extents (mm) of a panel face, derived from panelDims by role —
 * same role→dim mapping as face2DFrame.
 *   Top/Bottom:  uDir=+X (length),    vDir=±Y (width)  → uLen=length,    vLen=width
 *   Front/Back:  uDir=+Z (thickness), vDir=±X (length) → uLen=thickness, vLen=length
 *   Left/Right:  uDir=+Z (thickness), vDir=±Y (width)  → uLen=thickness, vLen=width
 */
export function faceExtents(
  panelDims: { length: number; width: number; thickness: number },
  role: PanelFaceRole,
): { uLen: number; vLen: number } {
  const { length: L, width: W, thickness: T } = panelDims;
  switch (role) {
    case 'Top':
    case 'Bottom':
      return { uLen: L, vLen: W };
    case 'Front':
    case 'Back':
      return { uLen: T, vLen: L };
    case 'Left':
    case 'Right':
      return { uLen: T, vLen: W };
  }
}

export function face2DFrame(
  panelDims: { length: number; width: number; thickness: number },
  faceName: PanelFaceRole,
): { origin: Vec3; uDir: Vec3; vDir: Vec3 } {
  const { length: L, width: W, thickness: T } = panelDims;
  const hL = L / 2, hW = W / 2;
  switch (faceName) {
    case 'Top':    // +Z plane; u along +X, v along +Y → normal +Z
      return { origin: { x: -hL, y: -hW, z: T }, uDir: { x: 1, y: 0, z: 0 }, vDir: { x: 0, y: 1, z: 0 } };
    case 'Bottom': // -Z plane; u along +X, v along -Y → normal -Z
      return { origin: { x: -hL, y: hW, z: 0 }, uDir: { x: 1, y: 0, z: 0 }, vDir: { x: 0, y: -1, z: 0 } };
    case 'Front':  // +Y plane; u along +Z, v along +X → normal +Y
      return { origin: { x: -hL, y: hW, z: 0 }, uDir: { x: 0, y: 0, z: 1 }, vDir: { x: 1, y: 0, z: 0 } };
    case 'Back':   // -Y plane; u along +Z, v along -X → normal -Y
      return { origin: { x: hL, y: -hW, z: 0 }, uDir: { x: 0, y: 0, z: 1 }, vDir: { x: -1, y: 0, z: 0 } };
    case 'Left':   // -X plane; u along +Z, v along +Y → normal -X
      return { origin: { x: -hL, y: -hW, z: 0 }, uDir: { x: 0, y: 0, z: 1 }, vDir: { x: 0, y: 1, z: 0 } };
    case 'Right':  // +X plane; u along +Z, v along -Y → normal +X
      return { origin: { x: hL, y: hW, z: 0 }, uDir: { x: 0, y: 0, z: 1 }, vDir: { x: 0, y: -1, z: 0 } };
  }
}
