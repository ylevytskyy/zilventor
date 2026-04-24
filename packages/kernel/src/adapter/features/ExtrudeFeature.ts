import type { OcctInstance } from '../../occt/occtLoader';
import type { SketchResult } from './SketchFeature';
import type { OcctShape } from '../../occt/SolidOps';
import { type NamedShape, namedFace, attachName } from '../../occt/FaceNaming';
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
 * the caller is done with it. `named` carries the per-face role labels
 * (top/bottom/side[i]) so that downstream features can bind to stable
 * face identities across rebuilds.
 */
export type ExtrudeResult = { featureId: string; solid: OcctShape; named: NamedShape };

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

  // Enumerate faces of the resulting prism and assign names.
  //
  // Labeling strategy: for a +Z extrude, the face with the lowest-Z centroid
  // is 'bottom', the highest-Z is 'top', and the remaining faces are 'side'
  // instances sorted by atan2 around the solid's center so the instance
  // indexing is stable under rotation/edit-order changes.
  //
  // Overload notes:
  //   - `GProp_GProps_1()` — default-ctor accumulator (same as BooleanOps).
  //   - `BRepGProp.SurfaceProperties_1(S, props, SkipShared, UseTriangulation)`
  //     is the face/shell surface-property overload; for a TopoDS_Face the
  //     centroid is the area-weighted centroid of the face.
  const namedResult: NamedShape = {
    shape: { __brand: 'OcctShape', handle: shape },
    faceNames: []
  };
  const expl = new oc.TopExp_Explorer_2(
    shape as never,
    oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never
  );
  const faces: unknown[] = [];
  while (expl.More()) {
    faces.push(expl.Current());
    expl.Next();
  }
  expl.delete();

  const withCentroids = faces.map((f) => {
    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.SurfaceProperties_1(
      f as never,
      props,
      false as never,
      false as never
    );
    const c = props.CentreOfMass();
    const coord: [number, number, number] = [c.X(), c.Y(), c.Z()];
    c.delete();
    props.delete();
    return { face: f, c: coord };
  });

  // Sort by Z to identify top/bottom.
  withCentroids.sort((a, b) => a.c[2] - b.c[2]);
  const bottom = withCentroids[0]!;
  const top = withCentroids[withCentroids.length - 1]!;
  const sides = withCentroids.slice(1, withCentroids.length - 1);
  attachName(namedResult, bottom.face, namedFace(feature.id, 'bottom'));
  attachName(namedResult, top.face, namedFace(feature.id, 'top'));
  // Sort sides by atan2(cY - center, cX - center) for stable instance indexing.
  const cx = (top.c[0] + bottom.c[0]) / 2;
  const cy = (top.c[1] + bottom.c[1]) / 2;
  sides.sort(
    (a, b) =>
      Math.atan2(a.c[1] - cy, a.c[0] - cx) - Math.atan2(b.c[1] - cy, b.c[0] - cx)
  );
  sides.forEach((s, i) =>
    attachName(namedResult, s.face, namedFace(feature.id, 'side', i))
  );

  return ok({
    featureId: feature.id,
    solid: { __brand: 'OcctShape', handle: shape },
    named: namedResult
  });
}
