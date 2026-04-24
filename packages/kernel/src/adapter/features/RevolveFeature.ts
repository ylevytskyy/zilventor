import type { OcctInstance } from '../../occt/occtLoader';
import { makeRevolve, type OcctShape } from '../../occt/SolidOps';
import {
  combineEdgesIntoWires,
  disposeEdge,
  disposeWire,
  makeArcEdge,
  makeCircleEdge,
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
  type SketchPrimitive
} from '@zilventor/shared';

/**
 * The adapter-level result of executing a revolve feature. `solid`
 * owns the OCCT topology and must be released via `disposeShape` once
 * the caller is done with it.
 */
export type RevolveResult = { featureId: string; solid: OcctShape };

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
  if (sketchFeature.plane !== 'XY') {
    return err({
      kind: 'revolveFailed',
      message: `Revolve on ${sketchFeature.plane} plane not supported in 3a`,
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
  let openChainsLocal: ReturnType<typeof combineEdgesIntoWires>['openChains'] = [];
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
    openChainsLocal = combined.openChains;

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
    mkFace.delete();
    mkFace = null;
    closedWiresLocal.forEach(disposeWire);
    closedWiresLocal = [];
    openChainsLocal = [];
    edges.forEach(disposeEdge);

    if (!r.ok) return r;
    return ok({ featureId: feature.id, solid: r.value });
  } catch (e) {
    // Dispose anything we may have allocated before the throw.
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
  }
}
