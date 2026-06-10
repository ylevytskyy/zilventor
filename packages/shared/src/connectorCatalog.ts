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
function crossCoord(otherThickness: number): number {
  return otherThickness / 2;
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
  const otherT = side === 'A' ? j.panelB.dims.thickness : j.panelA.dims.thickness;
  dists.forEach((u, i) => {
    const cid = `${kind}-${i}`;
    if (i === 0 || ids[ids.length - 1] !== cid) ids.push(cid);
    for (const s of specs(cid)) {
      bores.push({
        id: `${cid}-${side}-${bores.length}`,
        face: FACE_OF(j, side),
        u, v: crossCoord(otherT),
        diameter: s.diameter, depth: s.depth, role: s.role,
        connectorId: cid, connectorKind: kind,
      });
    }
  });
  return { bores, ids };
}

export function generateConfirmat(j: JointInput, p: BoringParams): { boresA: BoreOp[]; boresB: BoreOp[] } {
  const a = makeBores(j, p, 'confirmat', 'A', () => [{ diameter: 7, depth: 'throughAll', role: 'confirmat-face' }]);
  const b = makeBores(j, p, 'confirmat', 'B', () => [{ diameter: 5, depth: 50 - j.panelA.dims.thickness, role: 'confirmat-edge' }]);
  return { boresA: a.bores, boresB: b.bores };
}

export function generateMinifix(j: JointInput, p: BoringParams): { boresA: BoreOp[]; boresB: BoreOp[] } {
  const a = makeBores(j, p, 'minifix', 'A', () => [
    { diameter: 15, depth: 12.5, role: 'minifix-cam' },
    { diameter: 8, depth: 34, role: 'minifix-cross' },
  ]);
  const b = makeBores(j, p, 'minifix', 'B', () => [{ diameter: 8, depth: 34, role: 'minifix-bolt' }]);
  return { boresA: a.bores, boresB: b.bores };
}

export function generateDowel(j: JointInput, p: BoringParams): { boresA: BoreOp[]; boresB: BoreOp[] } {
  const a = makeBores(j, p, 'dowel', 'A', () => [{ diameter: 8, depth: 12, role: 'dowel-face' }]);
  const b = makeBores(j, p, 'dowel', 'B', () => [{ diameter: 8, depth: 20, role: 'dowel-edge' }]);
  return { boresA: a.bores, boresB: b.bores };
}
