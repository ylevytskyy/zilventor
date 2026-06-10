import type { BoreOp, BoreRole, BoreConnectorKind, PanelFaceRole } from './bore';
import type { Vec3, FaceName } from './types';
import type { Pose } from './jointMath';
// NOTE: Pose is declared once in jointMath.ts. connectorCatalog imports it rather than
// re-exporting, to avoid a duplicate export conflict in the barrel when both modules
// are star-exported.

export interface JointInput {
  line: { p0: Vec3; p1: Vec3 };
  panelA: { dims: { length: number; width: number; thickness: number }; pose: Pose };
  panelB: { dims: { length: number; width: number; thickness: number }; pose: Pose };
  faceA: PanelFaceRole;
  endB: PanelFaceRole;
  /**
   * Real board thickness of panel A (mm). Must be supplied when panelA.dims may have
   * been swapped for AABB purposes (e.g. side panels in GenerateCarcassBoresCommand).
   * Falls back to panelA.dims.thickness if absent (backward-compatible for tests that
   * construct JointInput with unswapped dims).
   */
  boardThicknessA?: number;
  /**
   * Real board thickness of panel B (mm). Likewise for the end-drilled panel.
   */
  boardThicknessB?: number;
}

export interface BoringParams {
  endSetback: number;
  maxSpacing: number;
  minCount: number;
}

export const DEFAULT_BORING_PARAMS: BoringParams = {
  endSetback: 60, maxSpacing: 250, minCount: 2,
};

function jointLength(j: JointInput): number {
  const { p0, p1 } = j.line;
  return Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z);
}

/** Evenly-spaced along-joint distances (mm) between the two setbacks. */
function spacingDistances(len: number, p: BoringParams): number[] {
  const usable = len - 2 * p.endSetback;
  const count = Math.max(p.minCount, usable > 0 ? Math.ceil(usable / p.maxSpacing) + 1 : p.minCount);
  if (count <= 1) return [len / 2];
  const start = p.endSetback;
  const span = len - 2 * p.endSetback;
  const step = span / (count - 1);
  return Array.from({ length: count }, (_, i) => start + i * step);
}

const FACE_OF = (j: JointInput, which: 'A' | 'B'): FaceName => ({
  featureId: 'panel',
  role: which === 'A' ? j.faceA : j.endB,
  instance: 0,
});

// `v` = the cross-joint coordinate on the face; the centerline of the mating
// panel's thickness. For slice 1 it is the half-thickness of the OTHER panel
// (placeholder — frame placement is refined in jointMath/Generate command);
// the unit tests pin `u` (along-joint) + role/Ø/depth/pairing only.
function crossCoord(boardThickness: number): number {
  return boardThickness / 2;
}

/**
 * Whether the end face's face2DFrame places uDir along the board's THICKNESS axis (+Z).
 * For Left/Right/Front/Back: uDir=+Z → u is the thickness-centerline coord, v is along-joint.
 * For Top/Bottom: uDir=+X → u is along-joint, v is the thickness-centerline coord.
 * This controls the u↔v swap for boresB so the bore lands inside the panel face.
 */
function endFaceUsesZforU(endFace: PanelFaceRole): boolean {
  return endFace === 'Left' || endFace === 'Right' || endFace === 'Front' || endFace === 'Back';
}

interface BoreSpec {
  diameter: number;
  depth: number | 'throughAll';
  role: BoreRole;
}

function makeBores(
  j: JointInput, p: BoringParams, kind: BoreConnectorKind,
  side: 'A' | 'B', specs: (cid: string) => BoreSpec[],
): { bores: BoreOp[]; ids: string[] } {
  const dists = spacingDistances(jointLength(j), p);
  const bores: BoreOp[] = [];
  const ids: string[] = [];
  // Use boardThicknessA/B if provided (avoids reading from swapped dims.thickness).
  // Fall back to dims.thickness for callers that construct JointInput with unswapped dims.
  const otherBoardT = side === 'A'
    ? (j.boardThicknessB ?? j.panelB.dims.thickness)
    : (j.boardThicknessA ?? j.panelA.dims.thickness);
  // For the B end face, determine whether the face frame puts uDir along Z (thickness axis).
  // If so, the bore's u = thickness-centerline coord and v = along-joint spacing.
  const bSwapUV = side === 'B' && endFaceUsesZforU(j.endB);
  dists.forEach((dist, i) => {
    const cid = `${kind}-${i}`;
    if (i === 0 || ids[ids.length - 1] !== cid) ids.push(cid);
    const cross = crossCoord(otherBoardT);
    // For B side on Left/Right/Front/Back faces: u=cross (thickness-center), v=dist (along-joint).
    // For A side and B side on Top/Bottom faces: u=dist (along-joint), v=cross.
    const boreU = bSwapUV ? cross : dist;
    const boreV = bSwapUV ? dist : cross;
    for (const s of specs(cid)) {
      bores.push({
        id: `${cid}-${side}-${bores.length}`,
        face: FACE_OF(j, side),
        u: boreU, v: boreV,
        diameter: s.diameter, depth: s.depth, role: s.role,
        connectorId: cid, connectorKind: kind,
      });
    }
  });
  return { bores, ids };
}

export function generateConfirmat(j: JointInput, p: BoringParams): { boresA: BoreOp[]; boresB: BoreOp[] } {
  // boardThicknessA is the REAL board thickness of panel A (the face-drilled side panel).
  // Falls back to dims.thickness for callers that supply unswapped dims.
  const tA = j.boardThicknessA ?? j.panelA.dims.thickness;
  const a = makeBores(j, p, 'confirmat', 'A', () => [{ diameter: 7, depth: 'throughAll', role: 'confirmat-face' }]);
  // Confirmat screw length 50mm; depth into end-panel = screw length - A's real board thickness.
  const b = makeBores(j, p, 'confirmat', 'B', () => [{ diameter: 5, depth: 50 - tA, role: 'confirmat-edge' }]);
  return { boresA: a.bores, boresB: b.bores };
}

// ─── Minifix parametric constants ────────────────────────────────────────────
/** Cam housing: nominal blind depth. Fits an 18mm board (12.5 < 18). */
const MINIFIX_CAM_DEPTH = 12.5;
/**
 * Cross bore: horizontal bore from panel A's face into the cam body.
 * Nominal furniture value is ~34mm, but the bore must stay within the board face
 * (depth ≤ boardThicknessA). Clamped to `boardThicknessA - 1` so the bore
 * is blind and doesn't exit the opposite face.
 * NOTE: For thick stock (e.g. 38mm+) the nominal 34mm applies; for 18mm board
 * this gives 17mm, which is geometrically valid. Exact offset is a tunable
 * follow-up (spec §6).
 */
const MINIFIX_CROSS_NOMINAL = 34;
/**
 * Bolt bore: Ø8 into panel B's end. Nominal 34mm; clamped to `boardThicknessB - 1`
 * so the bore stays inside the board end.
 */
const MINIFIX_BOLT_NOMINAL = 34;

// ─── Dowel parametric constants ───────────────────────────────────────────────
/** Face bore into panel A: standard Ø8 × 12mm socket (half of 25mm pin). */
const DOWEL_FACE_DEPTH = 12;
/**
 * End bore into panel B: standard Ø8 × 13mm socket (slightly deeper end side).
 * Clamped to `boardThicknessB - 1` for thin stock below 14mm.
 */
const DOWEL_END_NOMINAL = 13;

export function generateMinifix(j: JointInput, p: BoringParams): { boresA: BoreOp[]; boresB: BoreOp[] } {
  const tA = j.boardThicknessA ?? j.panelA.dims.thickness;
  const tB = j.boardThicknessB ?? j.panelB.dims.thickness;
  // Cross bore and bolt bore are clamped to fit within the real board thickness.
  const crossDepth = Math.min(MINIFIX_CROSS_NOMINAL, tA - 1);
  const boltDepth = Math.min(MINIFIX_BOLT_NOMINAL, tB - 1);
  // Cam depth is already 12.5mm — fits standard 18mm board. Clamp for thin stock.
  const camDepth = Math.min(MINIFIX_CAM_DEPTH, tA - 1);
  const a = makeBores(j, p, 'minifix', 'A', () => [
    { diameter: 15, depth: camDepth, role: 'minifix-cam' },
    { diameter: 8, depth: crossDepth, role: 'minifix-cross' },
  ]);
  const b = makeBores(j, p, 'minifix', 'B', () => [{ diameter: 8, depth: boltDepth, role: 'minifix-bolt' }]);
  return { boresA: a.bores, boresB: b.bores };
}

export function generateDowel(j: JointInput, p: BoringParams): { boresA: BoreOp[]; boresB: BoreOp[] } {
  const tB = j.boardThicknessB ?? j.panelB.dims.thickness;
  // End bore clamped to fit within the real board thickness (for thin stock < 14mm).
  const endDepth = Math.min(DOWEL_END_NOMINAL, tB - 1);
  const a = makeBores(j, p, 'dowel', 'A', () => [{ diameter: 8, depth: DOWEL_FACE_DEPTH, role: 'dowel-face' }]);
  const b = makeBores(j, p, 'dowel', 'B', () => [{ diameter: 8, depth: endDepth, role: 'dowel-edge' }]);
  return { boresA: a.bores, boresB: b.bores };
}
