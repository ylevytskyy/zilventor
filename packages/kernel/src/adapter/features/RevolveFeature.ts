import type { OcctInstance } from '../../occt/occtLoader';
import { makeRevolve, type OcctShape } from '../../occt/SolidOps';
import { type NamedShape, namedFace, attachName } from '../../occt/FaceNaming';
import {
  combineEdgesIntoWires,
  disposeEdge,
  disposeWire,
  makeArcEdge,
  makeCircleEdge,
  makeEllipseEdge,
  makeLineEdge,
  makeRectangleEdges,
  makeSplineEdge,
  type EdgeHandle
} from '../../occt/SketchOps';
import {
  ok,
  err,
  type Result,
  type KernelError,
  newCorrelationId,
  type Feature,
  type SketchPrimitive,
  originPlaneLiteralOf
} from '@zilventor/shared';

/**
 * The adapter-level result of executing a revolve feature. `solid`
 * owns the OCCT topology and must be released via `disposeShape` once
 * the caller is done with it. `named` carries the per-face role labels
 * (lateral[/i], cap_start, cap_end) so downstream features can bind to
 * stable face identities across rebuilds.
 */
export type RevolveResult = { featureId: string; solid: OcctShape; named: NamedShape };

/**
 * Revolves a profile sketch (minus its axis primitive) around an
 * in-sketch line to produce a revolved solid.
 *
 * Signature note (deviation from T6 plan draft): the plan's draft
 * included a `sketch: SketchResult` parameter, but the plan body never
 * reads it — and a revolve sketch that contains BOTH a closed profile
 * AND a disconnected axis line is rejected by `executeSketchFeature`
 * as a "valid loop plus disconnected line(s)" degenerate sketch. So
 * this adapter takes the raw `sketchFeature` directly and builds its
 * own edges/wires internally, excluding the axis primitive. The
 * sub-project 3a plan context explicitly flagged this deviation as
 * the recommended resolution.
 *
 * Sub-project 3a contract:
 *   - `sketchFeature.plane` must be `XY`.
 *   - `axisPrimitiveId` must name a `line` primitive in the sketch.
 *   - The remaining (non-axis) primitives, after stitching, must yield
 *     at least one closed wire; the first closed wire becomes the face
 *     boundary.
 *   - `direction: 'flipped'` negates the angle.
 *   - `direction: 'symmetric'` pre-rotates the profile face by `-angle/2`
 *     around the revolve axis, then revolves by `+angle` — so the sweep
 *     is centered on the profile's original angular position.
 *
 * Memory discipline: every OCCT object created here is released on
 * every exit path (5 error paths + happy + caught throw). The returned
 * `solid` is the sole surviving handle.
 */
export function executeRevolveFeature(
  oc: OcctInstance,
  sketchFeature: Extract<Feature, { kind: 'sketch' }>,
  feature: Extract<Feature, { kind: 'revolve' }>,
  angleRad: number
): Result<RevolveResult, KernelError> {
  // 1. Plane must be XY in 3a.
  const planeLit = originPlaneLiteralOf(sketchFeature.plane);
  if (planeLit === null) {
    return err({
      kind: 'invalidGeometry',
      message: `RevolveFeature: only origin work planes supported until WorkFeatureOps lands. Got ${JSON.stringify(sketchFeature.plane)}`,
      correlationId: newCorrelationId(),
      featureId: feature.id
    });
  }
  if (planeLit !== 'XY') {
    return err({
      kind: 'revolveFailed',
      message: `Revolve on ${planeLit} plane not supported in 3a`,
      correlationId: newCorrelationId(),
      featureId: feature.id
    });
  }

  // 2. Find the axis primitive and extract origin + direction.
  const axisPrim = sketchFeature.primitives.find(
    (p) => p.id === feature.axisPrimitiveId
  );
  if (!axisPrim || axisPrim.kind !== 'line') {
    return err({
      kind: 'revolveFailed',
      message: `Axis primitive '${feature.axisPrimitiveId}' not found or not a line`,
      correlationId: newCorrelationId(),
      featureId: feature.id
    });
  }
  if (axisPrim.x1 === axisPrim.x2 && axisPrim.y1 === axisPrim.y2) {
    return err({
      kind: 'revolveFailed',
      message: `Axis line ${feature.axisPrimitiveId} has zero length`,
      correlationId: newCorrelationId(),
      featureId: feature.id
    });
  }
  const axisOrigin: [number, number, number] = [axisPrim.x1, axisPrim.y1, 0];
  const axisDir: [number, number, number] = [
    axisPrim.x2 - axisPrim.x1,
    axisPrim.y2 - axisPrim.y1,
    0
  ];

  // 3. Build edges from all non-axis primitives.
  const profilePrims = sketchFeature.primitives.filter(
    (p) => p.id !== feature.axisPrimitiveId
  );

  const edges: EdgeHandle[] = [];
  let closedWiresLocal: ReturnType<typeof combineEdgesIntoWires>['closedWires'] = [];
  let _openChainsLocal: ReturnType<typeof combineEdgesIntoWires>['openChains'] = [];
  let face: unknown = null;
  let mkFace: { delete: () => void } | null = null;
  let preRotatedFace: unknown = null;

  try {
    for (const p of profilePrims) {
      const built = buildEdgesFor(oc, p);
      for (const e of built) edges.push(e);
    }

    const combined = combineEdgesIntoWires(oc, edges);
    closedWiresLocal = combined.closedWires;
    _openChainsLocal = combined.openChains;

    if (closedWiresLocal.length === 0) {
      edges.forEach(disposeEdge);
      return err({
        kind: 'revolveFailed',
        message: 'No closed profile found in sketch (excluding axis)',
        correlationId: newCorrelationId(),
        featureId: feature.id
      });
    }

    // First closed wire becomes the face boundary (hole support deferred).
    mkFace = new oc.BRepBuilderAPI_MakeFace_15(
      closedWiresLocal[0]!.wire as never,
      true as never
    ) as unknown as { delete: () => void };
    face = (mkFace as unknown as { Face: () => unknown }).Face();

    // 4. Resolve direction. 'symmetric' pre-rotates the profile by -angle/2
    //    around the axis so the subsequent +angle revolve is centered on the
    //    profile's original angular position.
    if (feature.direction === 'symmetric') {
      preRotatedFace = rotateShape(oc, face, axisOrigin, axisDir, -angleRad / 2);
      (face as { delete?: () => void }).delete?.();
      face = preRotatedFace;
    }
    const signedAngle = feature.direction === 'flipped' ? -angleRad : angleRad;

    // 5. Revolve.
    const r = makeRevolve(oc, {
      profile: { __brand: 'OcctShape', handle: face },
      axisOrigin,
      axisDir,
      angleRad: signedAngle
    });

    // 6. Cleanup (face + wires + edges); `solid` on success is kept.
    (face as { delete?: () => void }).delete?.();
    face = null;
    mkFace.delete();
    mkFace = null;
    closedWiresLocal.forEach(disposeWire);
    closedWiresLocal = [];
    _openChainsLocal = [];
    edges.forEach(disposeEdge);
    edges.length = 0;

    if (!r.ok) return r;

    // 7. Label output faces. MakeRevol produces:
    //     - For 360 deg: only swept (lateral) faces — the sweep closes on
    //       itself so no start/end planar trims exist. All faces are
    //       `lateral/{i}`, instance-ordered by ascending centroid distance
    //       from the axis origin for stability.
    //     - For partial (< 360 deg): swept laterals PLUS two planar cap
    //       faces at angle=0 (cap_start) and angle=signedAngle (cap_end).
    //       A cap is classified as planar AND its plane normal
    //       perpendicular to the axis direction (the cap plane CONTAINS
    //       the axis). Note: a lateral face generated by an edge
    //       perpendicular to the axis (e.g. the top/bottom edges of an
    //       XY rectangle around the Y axis) is ALSO planar but its
    //       normal is parallel to the axis — that is the discriminator.
    const namedResult = classifyRevolveFaces(oc, r.value, axisDir, feature.id, isFullRevolve(angleRad));

    return ok({ featureId: feature.id, solid: r.value, named: namedResult });
  } catch (e) {
    // Dispose anything we may have allocated before the throw. `face` is
    // nulled out on the success path after line 164's dispose, so this
    // only fires when the throw happened BEFORE the profile face was
    // handed to MakeRevol.
    (face as { delete?: () => void } | null)?.delete?.();
    mkFace?.delete();
    closedWiresLocal.forEach(disposeWire);
    edges.forEach(disposeEdge);
    return err({
      kind: 'revolveFailed',
      message: `Revolve threw: ${(e as Error).message}`,
      correlationId: newCorrelationId(),
      featureId: feature.id
    });
  }
}

/**
 * Rotates a shape by `angleRad` around the axis `(axisOrigin, axisDir)`.
 * Disposes every OCCT intermediate (gp_Pnt, gp_Dir, gp_Ax1, gp_Trsf, and
 * the BRepBuilderAPI_Transform builder) before returning. The returned
 * shape handle is owned by the caller.
 */
function rotateShape(
  oc: OcctInstance,
  shape: unknown,
  axisOrigin: [number, number, number],
  axisDir: [number, number, number],
  angleRad: number
): unknown {
  const origin = new oc.gp_Pnt_3(axisOrigin[0], axisOrigin[1], axisOrigin[2]);
  const [dx, dy, dz] = axisDir;
  const mag = Math.hypot(dx, dy, dz);
  const dir = new oc.gp_Dir_4(dx / mag, dy / mag, dz / mag);
  const ax = new oc.gp_Ax1_2(origin, dir);
  const trsf = new oc.gp_Trsf_1();
  trsf.SetRotation_1(ax as never, angleRad);
  const builder = new oc.BRepBuilderAPI_Transform_2(
    shape as never,
    trsf as never,
    false as never
  );
  const rotated = (builder as unknown as { Shape: () => unknown }).Shape();
  (builder as unknown as { delete: () => void }).delete();
  trsf.delete();
  ax.delete();
  dir.delete();
  origin.delete();
  return rotated;
}

/**
 * Converts a single sketch primitive into its constituent edges. A
 * rectangle yields four edges; every other primitive yields exactly one.
 */
function buildEdgesFor(oc: OcctInstance, p: SketchPrimitive): EdgeHandle[] {
  switch (p.kind) {
    case 'line':
      return [makeLineEdge(oc, { x: p.x1, y: p.y1 }, { x: p.x2, y: p.y2 })];
    case 'circle':
      return [makeCircleEdge(oc, p)];
    case 'arc':
      return [makeArcEdge(oc, p)];
    case 'rectangle':
      return makeRectangleEdges(oc, p);
    case 'spline':
      return [makeSplineEdge(oc, p)];
    case 'ellipse':
      return [makeEllipseEdge(oc, p)];
  }
}

/**
 * Returns true when `angleRad` is effectively a full revolution. MakeRevol
 * on a 2*PI angle closes the sweep on itself and emits no cap faces, so the
 * caller uses this to skip cap classification.
 */
function isFullRevolve(angleRad: number): boolean {
  return Math.abs(Math.abs(angleRad) - 2 * Math.PI) < 1e-6;
}

/**
 * Enumerates faces of the revolved shape, classifies each as a cap or a
 * lateral (swept) face, and returns a NamedShape with role labels.
 *
 * Classifier: a face is a CAP iff (a) its supporting surface is a plane AND
 * (b) the plane normal is perpendicular to the revolve axis direction (i.e.
 * the cap plane CONTAINS the axis, which is the defining property of the
 * start/end trim plane of MakeRevol). Everything else (cylinder, cone,
 * BSpline, or a planar swept disk whose normal is parallel to the axis) is
 * labelled `lateral/{i}`.
 *
 * For the (rare) partial revolve where more than two candidate cap faces
 * pass the test — e.g. a self-intersecting profile — the first cap in
 * TopExp_Explorer order is cap_start, the second is cap_end, and any
 * remainder falls back to lateral. The integration tests cover the
 * well-formed case (exactly 2 caps).
 *
 * Memory: every OCCT object allocated here (TopExp_Explorer,
 * BRepAdaptor_Surface, GProp_GProps, gp_Pnt, gp_Pln, gp_Ax1, gp_Dir) is
 * disposed before return.
 */
function classifyRevolveFaces(
  oc: OcctInstance,
  solid: OcctShape,
  axisDir: [number, number, number],
  featureId: string,
  isFull: boolean
): NamedShape {
  const [dx, dy, dz] = axisDir;
  const mag = Math.hypot(dx, dy, dz);
  const axisUnit: [number, number, number] = [dx / mag, dy / mag, dz / mag];

  const named: NamedShape = { shape: solid, faceNames: [] };

  const expl = new oc.TopExp_Explorer_2(
    solid.handle as never,
    oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never
  );
  // `expl.Current()` returns a generic TopoDS_Shape. `BRepAdaptor_Surface_2`
  // (used by `isCapFace` below) refuses a bare Shape and demands a Face —
  // downcast via `TopoDS.Face_1` mirrors the pattern in `Tessellator.ts`.
  const faces: unknown[] = [];
  while (expl.More()) {
    faces.push(oc.TopoDS.Face_1(expl.Current() as never));
    expl.Next();
  }
  expl.delete();

  // Precompute centroids so we can instance-order laterals by distance to
  // the axis origin (stable across small numerical perturbations).
  const meta = faces.map((f) => {
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
    return { face: f, centroid: coord };
  });

  // Classify each face.
  const capIndices: number[] = [];
  const lateralIndices: number[] = [];
  for (let i = 0; i < meta.length; i++) {
    const isCap = !isFull && isCapFace(oc, meta[i]!.face, axisUnit);
    if (isCap) capIndices.push(i);
    else lateralIndices.push(i);
  }

  // Laterals: sort by radial distance from axis-origin-aligned centroid
  // (approximate — we use absolute centroid magnitude as a cheap proxy).
  // This yields stable `lateral/{i}` instance numbering for the common
  // axis-at-origin case; downstream we can refine if needed.
  lateralIndices.sort((a, b) => {
    const ma = Math.hypot(meta[a]!.centroid[0], meta[a]!.centroid[1], meta[a]!.centroid[2]);
    const mb = Math.hypot(meta[b]!.centroid[0], meta[b]!.centroid[1], meta[b]!.centroid[2]);
    return ma - mb;
  });
  lateralIndices.forEach((fi, idx) =>
    attachName(named, meta[fi]!.face, namedFace(featureId, 'lateral', idx))
  );

  // Caps: the plan specifies cap_start is "the one at the start angle" and
  // cap_end is the one at the signedAngle. For MVP we treat TopExp iteration
  // order as the tie-break: first cap encountered = cap_start, second =
  // cap_end. Any further caps (degenerate profile) fall back to lateral.
  capIndices.forEach((fi, idx) => {
    if (idx === 0) attachName(named, meta[fi]!.face, namedFace(featureId, 'cap_start'));
    else if (idx === 1) attachName(named, meta[fi]!.face, namedFace(featureId, 'cap_end'));
    else attachName(named, meta[fi]!.face, namedFace(featureId, 'lateral', lateralIndices.length + idx - 2));
  });

  return named;
}

/**
 * True when the face's supporting surface is a plane AND the plane normal
 * is perpendicular to the axis direction (|dot| < tolerance). This
 * identifies the start/end trim plane of a partial revolve.
 */
function isCapFace(
  oc: OcctInstance,
  face: unknown,
  axisUnit: [number, number, number]
): boolean {
  const adaptor = new oc.BRepAdaptor_Surface_2(face as never, true as never);
  try {
    const surfType = adaptor.GetType();
    // The type object's identity doesn't round-trip through the JS side as
    // a primitive enum, but `oc.GeomAbs_SurfaceType.GeomAbs_Plane` is the
    // canonical plane sentinel; strict-equal against the adaptor's report.
    if (surfType !== oc.GeomAbs_SurfaceType.GeomAbs_Plane) return false;
    // `Plane()`, `Axis()`, and `Direction()` return OCCT value types whose
    // OCJ wrappers share lifetime with the adaptor (or are already reaped
    // synthetic proxies). Calling `.delete()` on them throws "instance
    // already deleted" — we let the adaptor's disposal release the memory.
    const pln = adaptor.Plane();
    const ax = pln.Axis();
    const n = ax.Direction();
    const dot = n.X() * axisUnit[0] + n.Y() * axisUnit[1] + n.Z() * axisUnit[2];
    return Math.abs(dot) < 1e-4;
  } finally {
    (adaptor as unknown as { delete?: () => void }).delete?.();
  }
}

