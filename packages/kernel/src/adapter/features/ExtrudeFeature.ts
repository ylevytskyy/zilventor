import type { OcctInstance } from '../../occt/occtLoader';
import type { SketchResult } from './SketchFeature';
import type { OcctShape } from '../../occt/SolidOps';
import {
  ok,
  err,
  type Result,
  type KernelError,
  newCorrelationId,
  type Feature
} from '@zilventor/shared';

/**
 * The adapter-level result of executing an extrude feature. `solid`
 * owns the OCCT topology and must be released via `disposeShape` once
 * the caller is done with it.
 */
export type ExtrudeResult = { featureId: string; solid: OcctShape };

/**
 * Extrudes a closed sketch wire along +Z into a prismatic solid.
 *
 * API adaptation notes (vs. textbook OCCT):
 *   - `BRepBuilderAPI_MakeFace_15(TopoDS_Wire, Standard_Boolean OnlyPlane)`
 *     is the wire-only face builder we want. The d.ts has ~22 overloads
 *     (numbered suffixes) for every possible surface + wire combo; _15
 *     is the "let OCCT infer the support plane from the wire" form and
 *     matches the precedent set in `SketchOps.ts`.
 *   - `gp_Vec_4(x, y, z)` is the three-real constructor; other suffixes
 *     take a gp_Dir, gp_XYZ, or two gp_Pnts.
 *   - `BRepPrimAPI_MakePrism_1(shape, vec, Copy, Canonize)` is the
 *     finite-length prism. `Copy=false` is the default/efficient choice
 *     (we own the input face and are about to drop it); `Canonize=true`
 *     lets OCCT downgrade the result to a more specific shape type when
 *     possible (e.g. a BSpline face of a box extrude becomes planar).
 *
 * Scope: the 'symmetric' direction variant is treated identically to
 * 'forward' in the Shell MVP. Proper centered (±distance/2) extrusion
 * lands in Sub-project 3.
 *
 * Memory discipline: `face`, `dir`, `mkFace`, and `mkPrism` are all
 * disposed here; the sole surviving handle is the returned `solid`.
 * The input `sketch.wire` is NOT disposed — the caller (FeatureTree)
 * owns its lifecycle, since a single sketch may drive multiple
 * downstream features in the future.
 */
export function executeExtrudeFeature(
  oc: OcctInstance,
  sketch: SketchResult,
  feature: Extract<Feature, { kind: 'extrude' }>,
  distance: number
): Result<ExtrudeResult, KernelError> {
  if (!Number.isFinite(distance) || distance <= 0) {
    return err({
      kind: 'invalidParameter',
      message: `Extrude distance must be positive, got ${distance}`,
      correlationId: newCorrelationId(),
      featureId: feature.id
    });
  }

  const mkFace = new oc.BRepBuilderAPI_MakeFace_15(
    sketch.wire.wire as never,
    true as never
  );
  const face = mkFace.Face();

  const dir = new oc.gp_Vec_4(0, 0, distance);

  const mkPrism = new oc.BRepPrimAPI_MakePrism_1(
    face as never,
    dir as never,
    false as never,
    true as never
  );
  const shape = mkPrism.Shape();

  mkPrism.delete();
  (face as { delete?: () => void }).delete?.();
  mkFace.delete();
  dir.delete();

  return ok({ featureId: feature.id, solid: { __brand: 'OcctShape', handle: shape } });
}
