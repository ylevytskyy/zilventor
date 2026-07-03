import type { Vec3 } from './types';
import type { KeyholeSlotSpec } from './keyholeSlot';
import { face2DFrame } from './bore';

/** mm the cutters poke proud of the face so the boolean subtraction is clean
 *  (mirrors grooveMath.ts's/tenonMortiseMath.ts's OVERCUT rationale — avoids
 *  a coincident face, which OCCT can leave as a no-op sliver). */
const OVERCUT = 0.1;

type Dims = { length: number; width: number; thickness: number };

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

export interface KeyholeSlotCutter {
  /** Top of the entry-hole cylinder cutter: the hole center pushed OVERCUT
   *  proud of the face along the outward normal (mirrors HoleOps.makeSimpleCutter's
   *  `origin` contract — "top of the cutter at the workpiece surface"). Feed
   *  directly to `makeSimpleCutter` as `origin`. */
  cylinderOrigin: Vec3;
  /** Unit direction INTO the material (the negated face outward normal). Feed
   *  directly to `makeSimpleCutter` as `axis`. */
  cylinderAxis: Vec3;
  cylinderDiameter: number;
  /** OVERCUT (proud of the face) + `depth` (into the panel). */
  cylinderLength: number;
  /** The two opposite corners of the slot's axis-aligned cutter box, in
   *  panel-local coordinates (mirrors buildGrooveCutter's `{p1,p2}` box-corner
   *  convention — feed to `makeBoxFromCorners`). The box's near edge sits
   *  exactly at the hole center along the run axis, guaranteeing it overlaps
   *  the entry-hole cylinder. */
  slotBox: { p1: Vec3; p2: Vec3 };
}

/**
 * Computes the cylinder + slot-box cutter geometry for a `KeyholeSlotSpec`,
 * in panel-local coordinates (the panel solid spans [-L/2,-W/2,0]..[L/2,W/2,T]).
 *
 * The entry-hole cylinder is centered at `(spec.u, spec.v)` on `spec.faceRole`
 * (via `face2DFrame`), `entryDiameter` wide, cut `depth` deep. The slot box
 * is anchored at that SAME hole center: along the run axis (`spec.axis`) it
 * starts AT the center and extends `slotLength` mm outward in `spec.direction`
 * (NOT centered on the hole — "from the hole CENTER outward" per spec); across
 * the cross axis it is `slotWidth` mm wide, centered on the hole's cross
 * coordinate. Anchoring the box's near edge exactly at the hole center
 * guarantees the box overlaps the cylinder (their footprints share the near
 * half of the entry-hole disk), so the fused cutter forms one connected
 * keyhole pocket rather than two disjoint cuts.
 */
export function buildKeyholeSlotCutter(panelDims: Dims, spec: KeyholeSlotSpec): KeyholeSlotCutter {
  const { origin, uDir, vDir } = face2DFrame(panelDims, spec.faceRole);
  const normal = cross(uDir, vDir); // outward unit normal of the face

  const cylinderOrigin = corner(origin, uDir, vDir, normal, spec.u, spec.v, OVERCUT);
  const cylinderAxis: Vec3 = { x: -normal.x, y: -normal.y, z: -normal.z };

  const runCoord = spec.axis === 'u' ? spec.u : spec.v;
  const crossCoord = spec.axis === 'u' ? spec.v : spec.u;
  const runA = runCoord;
  const runB = runCoord + spec.direction * spec.slotLength;
  const halfWidth = spec.slotWidth / 2;
  const crossA = crossCoord - halfWidth;
  const crossB = crossCoord + halfWidth;

  let uA: number, uB: number, vA: number, vB: number;
  if (spec.axis === 'u') {
    uA = runA; uB = runB;
    vA = crossA; vB = crossB;
  } else {
    vA = runA; vB = runB;
    uA = crossA; uB = crossB;
  }

  const p1 = corner(origin, uDir, vDir, normal, uA, vA, OVERCUT);
  const p2 = corner(origin, uDir, vDir, normal, uB, vB, -spec.depth);

  return {
    cylinderOrigin,
    cylinderAxis,
    cylinderDiameter: spec.entryDiameter,
    cylinderLength: spec.depth + OVERCUT,
    slotBox: { p1, p2 },
  };
}
