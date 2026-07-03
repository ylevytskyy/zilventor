import type { OcctInstance } from '../../occt/occtLoader';
import { makeBoxFromCorners, disposeShape, type OcctShape } from '../../occt/SolidOps';
import { makeSimpleCutter } from '../../occt/HoleOps';
import { fuseShapes, cutShapes } from '../../occt/BooleanOps';
import { buildKeyholeSlotCutter } from '@zilventor/shared';
import type { KeyholeSlotFeature, Result, KernelError } from '@zilventor/shared';

type Dims = { length: number; width: number; thickness: number };

/**
 * Cuts a keyhole-slot pocket (entry-hole cylinder ∪ slot box) out of
 * `runningBody`. Geometry comes from the pure-math `buildKeyholeSlotCutter`
 * (shared, no OCCT); this module only turns that geometry into real OCCT
 * primitives and booleans:
 *   1. cylinder via `makeSimpleCutter` (drillTipAngleDeg:null — a plain
 *      through-shaped cylinder, no drill-tip cone), wrapped as an `OcctShape`.
 *   2. box via `makeBoxFromCorners`.
 *   3. `fuseShapes` the two into one cutter, then `cutShapes` it from
 *      `runningBody`.
 *
 * Memory discipline mirrors HoleOps.ts: every OCCT temporary (`gp_Pnt_3`,
 * `gp_Dir_4`, the two cutter shapes, the fused cutter) is disposed once
 * consumed; `runningBody` is caller-owned and never disposed here. The
 * returned shape (on success) is a new shape the caller owns.
 */
export function executeKeyholeSlotFeature(
  oc: OcctInstance,
  runningBody: OcctShape,
  feature: KeyholeSlotFeature,
  panelDims: Dims,
): Result<OcctShape, KernelError> {
  const cutter = buildKeyholeSlotCutter(panelDims, feature);

  const ocAny = oc as unknown as {
    gp_Pnt_3: new (x: number, y: number, z: number) => { delete: () => void };
    gp_Dir_4: new (x: number, y: number, z: number) => { delete: () => void };
  };
  const origin = new ocAny.gp_Pnt_3(
    cutter.cylinderOrigin.x,
    cutter.cylinderOrigin.y,
    cutter.cylinderOrigin.z,
  );
  const axis = new ocAny.gp_Dir_4(
    cutter.cylinderAxis.x,
    cutter.cylinderAxis.y,
    cutter.cylinderAxis.z,
  );
  const cylRaw = makeSimpleCutter(oc, origin, axis, {
    diameter: cutter.cylinderDiameter,
    cylinderLength: cutter.cylinderLength,
    drillTipAngleDeg: null,
  });
  axis.delete();
  origin.delete();
  const cylShape: OcctShape = { __brand: 'OcctShape', handle: cylRaw };

  const boxShape = makeBoxFromCorners(oc, cutter.slotBox.p1, cutter.slotBox.p2);

  const fused = fuseShapes(oc, cylShape, boxShape);
  disposeShape(cylShape);
  disposeShape(boxShape);
  if (!fused.ok) return fused;

  const cut = cutShapes(oc, runningBody, fused.value);
  disposeShape(fused.value);
  return cut;
}
