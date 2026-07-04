import type { ComponentInstance, Vec3 } from '../types';
import { rolePose, type Quat } from './rolePose';

type Dims = { length: number; width: number; thickness: number };
type Pose = { translation: Vec3; quaternion: Quat };

/**
 * Translation-offset families keyed by fileNameSuffix in {@link SUFFIX_TABLE}.
 * Each reproduces one of the additive-pose formulas hand-derived (and locked
 * by AABB) across baseCabinet.ts / cornerCabinet.ts / blindCornerCabinet.ts /
 * diagonalCornerCabinet.ts. Letters mirror no particular doc — they just
 * group suffixes that share an identical (translation, rotation) formula.
 */
type Family = (position: Vec3, dims: Dims) => Vec3;

// Side panels whose thickness runs along world X, width along Y, length along Z
// (baseCabinet Left/Right Side, cornerCabinet Leg 1 End/Corner Post, blindCorner
// Left/Right Side/Blind Filler, diagonalCorner Return Side 1). Rotation ry=90.
const familyA: Family = (p, d) => ({ x: p.x, y: p.y + d.width / 2, z: p.z + d.length / 2 });

// Side panels with the permuted axis mapping (leg/wall running along Y instead
// of X): width along world X, length along Z (cornerCabinet Leg 2 End,
// diagonalCorner Return Side 2). Rotation rx=-90,ry=0,rz=-90.
const familyB: Family = (p, d) => ({ x: p.x + d.width / 2, y: p.y, z: p.z + d.length / 2 });

// Horizontal, translation-only panels (bottom/top/shelf across all four
// templates). Rotation identity.
const familyC: Family = (p, d) => ({ x: p.x + d.length / 2, y: p.y + d.width / 2, z: p.z });

// Back panels running along world X, thickness along Y (baseCabinet Back,
// cornerCabinet Back 1, blindCorner Back, diagonalCorner Back 1). Rotation rx=90.
const familyD: Family = (p, d) => ({ x: p.x + d.length / 2, y: p.y + d.thickness, z: p.z + d.width / 2 });

// Back/toekick panels with the permuted axis mapping (running along world Y
// instead of X): length along Y (cornerCabinet Back 2, diagonalCorner Back 2 /
// Toekick 2). Rotation rx=0,ry=90,rz=90.
const familyE: Family = (p, d) => ({ x: p.x, y: p.y + d.length / 2, z: p.z + d.width / 2 });

// Toekick / hanging-rail panels running along world X, width along Z
// (baseCabinet Toekick/Hanging Rail, blindCorner Toekick, diagonalCorner
// Toekick 1). Rotation rx=-90.
const familyF: Family = (p, d) => ({ x: p.x + d.length / 2, y: p.y, z: p.z + d.width / 2 });

interface TableEntry {
  readonly role: string;
  readonly translate: Family;
  readonly rotationDeg: { rx: number; ry: number; rz: number };
}

/**
 * Keyed by fileNameSuffix (per cabinet-pose-fix repair plan): role alone is
 * ambiguous (e.g. cornerCabinet's "Leg 2 End" and baseCabinet's "Left Side"
 * both carry role leftSide but use different formulas/rotations — familyB vs
 * familyA). `role` is still stored per entry as a sanity check: a suffix hit
 * whose actual role doesn't match is treated as unrecognized (null), since
 * that combination doesn't correspond to any known template output.
 *
 * Suffixes intentionally EXCLUDED (computeExpectedPose returns null for them):
 *
 * - 'Door': fileNameSuffix 'Door' + role 'door' is emitted by BOTH
 *   blindCornerCabinet.ts (position IS the pose.translation; quaternion is the
 *   fixed Shepperd-derived DOOR_POSE constant — in isolation recoverable) AND
 *   diagonalCornerCabinet.ts (position is also the panel center, but rotation
 *   is `uprightRot`, an Euler triple whose ry = arcsin(dY)*180/π depends on
 *   the pentagon's four leg dimensions — not present in (position, dims) —
 *   and the template attaches no `pose` field to it at all, relying on
 *   componentLocalPose's Euler-rotation fallback). The two are NOT
 *   distinguishable from (role, fileNameSuffix, position, dims) alone, and
 *   guessing the blindCorner formula would silently corrupt a correctly-posed
 *   diagonal door (or vice-versa) — worse than doing nothing. Null is safe.
 *
 * - 'Front Stile 1' / 'Front Stile 2' (diagonalCornerCabinet only): rotation's
 *   ry angle depends on the same unrecoverable pentagon leg geometry as the
 *   diagonal Door above, and — per diagonalCornerCabinetPose.spec.ts's second
 *   describe block — the template deliberately emits no `pose` for these
 *   roles at all (they already reach the correct world placement via
 *   componentLocalPose's Euler fallback: position is the center, rotation is
 *   the full `uprightRot`). Not in the table → falls through to null.
 */
const SUFFIX_TABLE: Record<string, TableEntry> = {
  'Left Side': { role: 'leftSide', translate: familyA, rotationDeg: { rx: 0, ry: 90, rz: 0 } },
  'Right Side': { role: 'rightSide', translate: familyA, rotationDeg: { rx: 0, ry: 90, rz: 0 } },
  Bottom: { role: 'bottom', translate: familyC, rotationDeg: { rx: 0, ry: 0, rz: 0 } },
  Top: { role: 'top', translate: familyC, rotationDeg: { rx: 0, ry: 0, rz: 0 } },
  Back: { role: 'back', translate: familyD, rotationDeg: { rx: 90, ry: 0, rz: 0 } },
  Toekick: { role: 'toekick', translate: familyF, rotationDeg: { rx: -90, ry: 0, rz: 0 } },
  'Hanging Rail': { role: 'hangingRail', translate: familyF, rotationDeg: { rx: -90, ry: 0, rz: 0 } },
  'Leg 1 End': { role: 'rightSide', translate: familyA, rotationDeg: { rx: 0, ry: 90, rz: 0 } },
  'Leg 2 End': { role: 'leftSide', translate: familyB, rotationDeg: { rx: -90, ry: 0, rz: -90 } },
  'Back 1': { role: 'back', translate: familyD, rotationDeg: { rx: 90, ry: 0, rz: 0 } },
  'Back 2': { role: 'back', translate: familyE, rotationDeg: { rx: 0, ry: 90, rz: 90 } },
  'Bottom 1': { role: 'bottom', translate: familyC, rotationDeg: { rx: 0, ry: 0, rz: 0 } },
  'Bottom 2': { role: 'bottom', translate: familyC, rotationDeg: { rx: 0, ry: 0, rz: 0 } },
  'Top 1': { role: 'top', translate: familyC, rotationDeg: { rx: 0, ry: 0, rz: 0 } },
  'Top 2': { role: 'top', translate: familyC, rotationDeg: { rx: 0, ry: 0, rz: 0 } },
  'Corner Post': { role: 'cornerPost', translate: familyA, rotationDeg: { rx: 0, ry: 90, rz: 0 } },
  'Blind Filler': { role: 'blindFiller', translate: familyA, rotationDeg: { rx: 0, ry: 90, rz: 0 } },
  'Return Side 1': { role: 'leftSide', translate: familyA, rotationDeg: { rx: 0, ry: 90, rz: 0 } },
  'Return Side 2': { role: 'rightSide', translate: familyB, rotationDeg: { rx: -90, ry: 0, rz: -90 } },
  'Toekick 1': { role: 'toekick', translate: familyF, rotationDeg: { rx: -90, ry: 0, rz: 0 } },
  'Toekick 2': { role: 'toekick', translate: familyE, rotationDeg: { rx: 0, ry: 90, rz: 90 } },
};

const SHELF_SUFFIX_RE = /^Shelf \d+$/;

/**
 * Recomputes the pose the CURRENT patched cabinet templates would emit for a
 * legacy component, from that component's own (role, fileNameSuffix, position,
 * dims) — no sibling/cabinet-level data. Returns null when the suffix is
 * unrecognized, when its role doesn't match the expected role for that
 * suffix (sanity check), or when the suffix is recognized but its pose is not
 * recoverable from this input shape alone (see the `SUFFIX_TABLE` doc comment
 * for 'Door' / 'Front Stile 1' / 'Front Stile 2').
 */
export function computeExpectedPose(input: {
  role: string;
  fileNameSuffix: string;
  position: Vec3;
  dims: Dims;
}): Pose | null {
  const { role, fileNameSuffix, position, dims } = input;

  if (SHELF_SUFFIX_RE.test(fileNameSuffix)) {
    if (role !== 'shelf') return null;
    return rolePose(familyC(position, dims), { rx: 0, ry: 0, rz: 0 });
  }

  const entry = SUFFIX_TABLE[fileNameSuffix];
  if (!entry || entry.role !== role) return null;
  return rolePose(entry.translate(position, dims), entry.rotationDeg);
}

/**
 * True when `component`'s existing pose diverges from `expected` by more than
 * `epsilonMm` in any translation axis or quaternion component. Always false
 * when `expected` is null (a foreign/unrecoverable component is never
 * flagged). A component with no `pose` at all is treated as needing repair
 * whenever a pose IS expected — legacy documents backfill `pose` with an
 * identity quaternion rather than leaving it absent, but this guards the
 * absent case too for robustness.
 */
export function needsPoseRepair(
  component: ComponentInstance,
  expected: Pose | null,
  epsilonMm = 1e-3,
): boolean {
  if (expected === null) return false;
  const actual = component.pose;
  if (!actual) return true;

  const translationDiff = Math.max(
    Math.abs(actual.translation.x - expected.translation.x),
    Math.abs(actual.translation.y - expected.translation.y),
    Math.abs(actual.translation.z - expected.translation.z),
  );
  const quaternionDiff = Math.max(
    Math.abs(actual.quaternion[0] - expected.quaternion[0]),
    Math.abs(actual.quaternion[1] - expected.quaternion[1]),
    Math.abs(actual.quaternion[2] - expected.quaternion[2]),
    Math.abs(actual.quaternion[3] - expected.quaternion[3]),
  );

  return translationDiff > epsilonMm || quaternionDiff > epsilonMm;
}
