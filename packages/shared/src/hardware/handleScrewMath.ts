/**
 * handleScrewMath — pure bore-UV computation for a handle screw pair.
 *
 * Computes the two Ø5 BoreOps for a bar pull's mounting screws on the
 * outward `'Top'` face of a drawer front panel.
 *
 * Axes per bore.ts face2DFrame ('Top'):
 *   origin = (-L/2, -W/2, T)
 *   uDir = +X  → length = front.height    (vertical in the door)
 *   vDir = +Y  → width  = front.width     (horizontal in the door)
 *
 * Placement (§13.1, Plan Corrections PC-1 — AUTHORITATIVE):
 *   u = frontHeight / 2  — constant (vertical center) for BOTH screws
 *   v = frontWidth  / 2 ± cc / 2  — screws split along WIDTH (v-axis)
 *
 * Width guard (§13.1-B5, PC-1):
 *   cc + boreDiameter >= frontWidth  →  throws
 *
 * Depth (PC-3):
 *   depth = 'throughAll'  (screw passes through the front into the pull)
 */

import type { BoreOp } from '../bore';
import type { FaceName } from '../types';

export interface HandleBoreInput {
  /** Panel dimension: length = front height (mm). */
  frontHeight: number;
  /** Panel dimension: width = front width (mm). */
  frontWidth: number;
  /** Center-to-center distance between the two screws (mm). Typical: 96 | 128 | 160. */
  cc: number;
  /**
   * Optional stable prefix for generated IDs (default 'hdl').
   * The caller MUST supply DISTINCT prefixes across multiple fronts so
   * connectorIds don't collide across drawer fronts.
   */
  idPrefix?: string;
}

const BORE_DIAMETER = 5;
const BORE_FACE: FaceName = { featureId: 'panel', role: 'Top', instance: 0 };

/**
 * Returns a pair of `BoreOp` values for handle-screw bores on the Top face
 * of a drawer front panel.
 *
 * IDs are derived deterministically from `idPrefix` — the caller should pass
 * a unique prefix per front (e.g. incorporating the componentId) to ensure
 * uniqueness in an assembly with multiple drawers.
 *
 * Each bore gets a DISTINCT `connectorId` (§13.4) so the BOM counts 2 screws per pull.
 */
export function handleBoreUV(input: HandleBoreInput): [BoreOp, BoreOp] {
  const { frontHeight, frontWidth, cc, idPrefix = 'hdl' } = input;

  // §13.1-B5 / PC-1 width guard: bores span v = width/2 ± cc/2;
  // outermost bore edge at v = width/2 + cc/2 + diameter/2 = (cc + diameter)/2 + width/2
  // The guard checks the bore *centers* fit within the panel:
  // v0 = width/2 - cc/2 must be > diameter/2  (some clearance from edge)
  // Expressed as the plan spec: cc + boreDiameter >= frontWidth → reject
  if (cc + BORE_DIAMETER >= frontWidth) {
    throw new Error(
      `handleBoreUV: cc=${cc} + Ø${BORE_DIAMETER} = ${cc + BORE_DIAMETER} >= front.width=${frontWidth} — handle screws won't fit`,
    );
  }

  // Bore centers (PC-1):
  //   u = frontHeight / 2  (vertical center — same for both)
  //   v0 = frontWidth / 2 - cc / 2
  //   v1 = frontWidth / 2 + cc / 2
  const uCenter = frontHeight / 2;
  const vCenter = frontWidth / 2;
  const halfCc = cc / 2;

  // §13.4 / PC-1: DISTINCT connectorId per bore so BOM counts 2 screws per pull (2N total).
  // Format: `${idPrefix}-screw-0` / `${idPrefix}-screw-1`.
  // The caller MUST supply a unique `idPrefix` per front to avoid cross-front id collisions.
  const connectorId0 = `${idPrefix}-screw-0`;
  const connectorId1 = `${idPrefix}-screw-1`;

  const bore0: BoreOp = {
    id: `${idPrefix}-s0`,
    face: BORE_FACE,
    u: uCenter,
    v: vCenter - halfCc,
    diameter: BORE_DIAMETER,
    depth: 'throughAll',
    role: 'handleScrew-face',
    connectorId: connectorId0,
    connectorKind: 'handleScrew',
  };

  const bore1: BoreOp = {
    id: `${idPrefix}-s1`,
    face: BORE_FACE,
    u: uCenter,
    v: vCenter + halfCc,
    diameter: BORE_DIAMETER,
    depth: 'throughAll',
    role: 'handleScrew-face',
    connectorId: connectorId1,
    connectorKind: 'handleScrew',
  };

  return [bore0, bore1];
}
