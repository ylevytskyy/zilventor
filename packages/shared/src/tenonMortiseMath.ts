import type { Vec3 } from './types';
import type { TenonMortiseSpec, TenonMortiseFeature } from './tenonMortise';
import { face2DFrame, faceExtents } from './bore';
import { crossCoord, endFaceUsesZforU, type JointInput } from './connectorCatalog';

/** mm the mortise cutter pokes proud of the face so the boolean cut is clean
 *  (mirrors grooveMath.ts's OVERCUT rationale — avoids a coincident face, which
 *  OCCT can leave as a no-op sliver). Not applied to tenons: a tenon fuse box
 *  starts exactly at the face plane (n=0), it has nothing to be "proud" of. */
const OVERCUT = 0.1;

type Dims = { length: number; width: number; thickness: number };

// Small pure geometry helpers, duplicated from grooveMath.ts (read-only reference
// per P6 W1 brief — not exported there, and not worth a shared-helper extraction
// for two three-line functions).
function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function corner(
  origin: Vec3,
  uDir: Vec3,
  vDir: Vec3,
  normal: Vec3,
  u: number,
  v: number,
  n: number,
): Vec3 {
  return {
    x: origin.x + u * uDir.x + v * vDir.x + n * normal.x,
    y: origin.y + u * uDir.y + v * vDir.y + n * normal.y,
    z: origin.z + u * uDir.z + v * vDir.z + n * normal.z,
  };
}

/**
 * The `count` axis-aligned cutter/fuser boxes for `spec`, in panel-local
 * coordinates (the panel solid spans [-L/2,-W/2,0]..[L/2,W/2,T]).
 *
 * Generalizes buildGrooveCutter's single continuous [0,uLen]×[position±width/2]
 * span into `count` discrete boxes: along `spec.axis` (the run axis), each box
 * is `width` mm wide, centred at `position + (i - (count-1)/2)*spacing` for
 * i in [0,count).
 *
 * Across the OTHER (cross) axis: when `spec.crossPosition`/`spec.crossSpan`
 * are BOTH present, each box is bounded to `crossPosition ± (crossSpan/2 +
 * fitClearance-for-mortise)` — this is how a mortise pocket is confined to the
 * mating (tenon-host) panel's end footprint instead of cutting a through-dado
 * across the whole host face. When either is absent, the box spans that
 * axis's FULL extent (0..len) — for a tenon's end face (Left/Right/Front/Back)
 * this literally equals the panel's own thickness (faceExtents reports the
 * thickness axis's length there), giving the "full-thickness protrusion"
 * box-joint MVP (P6 D6/S2); a tenon never sets crossPosition/crossSpan since
 * its own full thickness IS that full extent.
 *
 * role==='tenon': no overcut: n spans 0 (face plane) .. +depth (protrudes
 * outward, boolean fuse).
 * role==='mortise': OVERCUT proud of the face outward, -(depth+fitClearance)
 * into the panel (boolean cut); the run-axis half-width AND the bounded
 * cross-axis half-span are both widened by fitClearance so the mating tenon
 * fits.
 */
export function buildTenonMortiseCutters(
  panelDims: Dims,
  spec: TenonMortiseSpec,
): Array<{ p1: Vec3; p2: Vec3 }> {
  const { origin, uDir, vDir } = face2DFrame(panelDims, spec.faceRole);
  const { uLen, vLen } = faceExtents(panelDims, spec.faceRole);
  const normal = cross(uDir, vDir);
  const crossLen = spec.axis === 'u' ? vLen : uLen;
  const isMortise = spec.role === 'mortise';
  const halfW = spec.width / 2 + (isMortise ? spec.fitClearance : 0);
  const count = Math.max(1, Math.floor(spec.count));
  const centerOffset = (count - 1) / 2;

  const nA = isMortise ? OVERCUT : 0;
  const nB = isMortise ? -(spec.depth + spec.fitClearance) : spec.depth;

  const hasBoundedCross = spec.crossPosition !== undefined && spec.crossSpan !== undefined;
  let crossA: number, crossB: number;
  if (hasBoundedCross) {
    const crossHalf = spec.crossSpan! / 2 + (isMortise ? spec.fitClearance : 0);
    crossA = spec.crossPosition! - crossHalf;
    crossB = spec.crossPosition! + crossHalf;
  } else {
    crossA = 0;
    crossB = crossLen;
  }

  const boxes: Array<{ p1: Vec3; p2: Vec3 }> = [];
  for (let i = 0; i < count; i++) {
    const runCenter = spec.position + (i - centerOffset) * spec.spacing;
    const runA = runCenter - halfW;
    const runB = runCenter + halfW;

    let uA: number, uB: number, vA: number, vB: number;
    if (spec.axis === 'u') {
      uA = runA; uB = runB;
      vA = crossA; vB = crossB;
    } else {
      vA = runA; vB = runB;
      uA = crossA; uB = crossB;
    }

    boxes.push({
      p1: corner(origin, uDir, vDir, normal, uA, vA, nA),
      p2: corner(origin, uDir, vDir, normal, uB, vB, nB),
    });
  }
  return boxes;
}

export interface TenonMortiseParams {
  width: number;
  depth: number;
  count: number;
  spacing: number;
  fitClearance: number;
  /** Along-joint centre of the tab/pocket group. Defaults to half the joint
   *  length when omitted. */
  position?: number;
}

/**
 * `AddTenonMortiseCommand`'s accepted input (P11): either literal `count`/
 * `spacing` (today's manual path, unchanged) or an auto-layout descriptor
 * that the command resolves to literals via `layoutTenonsAlongJoint` before
 * constructing the pair (P11 D1) — the persisted `TenonMortiseFeature` shape
 * never changes either way.
 */
export type TenonMortiseCreateInput =
  | TenonMortiseParams
  | (Omit<TenonMortiseParams, 'count' | 'spacing'> & {
      layout: { mode: 'count' | 'pitch'; value: number; minEndMargin?: number };
    });

export interface TenonMortiseIds {
  tenonId: string;
  mortiseId: string;
  pairId: string;
}

/** mirrors connectorCatalog.ts's private one-liner (not exported — trivial to
 *  reimplement rather than widen that module's surface for one expression). */
function jointLength(j: JointInput): number {
  const { p0, p1 } = j.line;
  return Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z);
}

export interface TenonLayoutOptions {
  mode: 'count' | 'pitch';
  value: number;
  width: number;
  /** Space between the outermost tenon's edge and the panel edge, per side.
   *  Defaults to `width` (P11 D3) when omitted. */
  minEndMargin?: number;
}

export interface TenonLayoutResult {
  count: number;
  spacing: number;
  /** true when the requested count/pitch didn't fit within the joint's usable
   *  span and was clamped down to the largest feasible count (min 1). */
  clamped: boolean;
}

/**
 * Derives an evenly-distributed, centered tenon `count`/`spacing` from a
 * joint's real edge length (P11) — the auto-layout counterpart to hand-
 * entering `count`/`spacing` literals in `TenonMortiseParams`.
 *
 * `mode: 'count'` targets exactly N tenons; `mode: 'pitch'` targets a ~P mm
 * spacing, with count derived (nearest whole gap count) and spacing then
 * recalculated so the tenons land evenly across the usable span.
 *
 * Never throws: when the requested count/pitch doesn't fit within the usable
 * span (`jointLen - 2*margin`), clamps to the largest feasible count (minimum
 * 1, still centered) and reports `clamped: true` so the caller can warn.
 */
export function layoutTenonsAlongJoint(
  jointLen: number,
  opts: TenonLayoutOptions,
): TenonLayoutResult {
  const margin = opts.minEndMargin ?? opts.width;
  const usableSpan = Math.max(0, jointLen - 2 * margin);
  const maxCount = Math.floor(usableSpan / opts.width) + 1;

  const requestedCount =
    opts.mode === 'count'
      ? Math.max(1, Math.floor(opts.value))
      : Math.max(1, Math.round((opts.value > 0 ? usableSpan / opts.value : 0)) + 1);

  const count = Math.min(requestedCount, maxCount);
  const clamped = count < requestedCount;
  const spacing = count > 1 ? usableSpan / (count - 1) : 0;

  return { count, spacing, clamped };
}

/**
 * Generate a matched tenon/mortise pair from an inferred butt joint. The tenon
 * is hosted on `joint.endB` (the male/end panel); the mortise on `joint.faceA`
 * (the female/face panel) — mirrors `generateConfirmat`'s A/B convention.
 *
 * Per-face axis mapping (the one real correctness risk — mirrors
 * connectorCatalog.ts's `makeBores` exactly, does NOT assume the tenon's
 * axis/position transfer 1:1 to the mortise's frame):
 *   - `position` (the along-joint coordinate) is the SAME shared numeric value
 *     on both features — `makeBores` also shares one `dist` value across both
 *     sides of a bore pair, never transforming it.
 *   - What DOES differ per side is which of u/v that shared value lands on.
 *     The mortise host (side A) always carries it on 'u' (`makeBores` never
 *     swaps for side A). The tenon host (side B, an end face) carries it on
 *     'v' when `endFaceUsesZforU(endB)` is true (Left/Right/Front/Back — u is
 *     the thickness axis there per `faceExtents`), else on 'u'.
 *   - The mortise's CROSS axis (v) is bounded, not full-extent: `crossPosition`
 *     = `crossCoord(matingPanelThickness)` — the exact coordinate `makeBores`
 *     lands a side-A bore's cross coordinate on, i.e. the centerline of the
 *     mating (tenon-host) panel's end footprint — and `crossSpan` = that same
 *     mating panel's thickness, so `buildTenonMortiseCutters` confines the
 *     pocket to the tenon's actual footprint instead of cutting a
 *     through-dado across the whole host face. Mating thickness is read from
 *     `joint.boardThicknessB`, falling back to `joint.panelB.dims.thickness`
 *     — the identical fallback `makeBores` uses for `otherBoardT` on side A.
 */
export function generateTenonMortisePair(
  joint: JointInput,
  params: TenonMortiseParams,
  ids: TenonMortiseIds,
): { tenon: TenonMortiseFeature; mortise: TenonMortiseFeature } {
  const position = params.position ?? jointLength(joint) / 2;
  const tenonAxis: 'u' | 'v' = endFaceUsesZforU(joint.endB) ? 'v' : 'u';
  const mortiseAxis: 'u' | 'v' = 'u';
  const matingThickness = joint.boardThicknessB ?? joint.panelB.dims.thickness;

  const tenon: TenonMortiseFeature = {
    kind: 'tenonMortise',
    id: ids.tenonId,
    pairId: ids.pairId,
    role: 'tenon',
    faceRole: joint.endB,
    axis: tenonAxis,
    position,
    width: params.width,
    depth: params.depth,
    count: params.count,
    spacing: params.spacing,
    fitClearance: params.fitClearance,
  };

  const mortise: TenonMortiseFeature = {
    kind: 'tenonMortise',
    id: ids.mortiseId,
    pairId: ids.pairId,
    role: 'mortise',
    faceRole: joint.faceA,
    axis: mortiseAxis,
    position,
    width: params.width,
    depth: params.depth,
    count: params.count,
    spacing: params.spacing,
    fitClearance: params.fitClearance,
    crossPosition: crossCoord(matingThickness),
    crossSpan: matingThickness,
  };

  return { tenon, mortise };
}
