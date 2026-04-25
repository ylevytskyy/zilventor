import type { OcctInstance } from '../../occt/occtLoader';
import {
  ok,
  err,
  type Result,
  type KernelError,
  newCorrelationId,
  type Feature,
  type WorkFeatureValue,
  type Vec3,
} from '@zilventor/shared';
import {
  makeLineEdge,
  makeArcEdge,
  makeCircleEdge,
  makeSplineEdge,
  makeRectangleEdges,
  combineEdgesIntoWires,
  disposeEdge,
  type EdgeHandle,
  type WireHandle,
  type SketchFrame,
} from '../../occt/SketchOps';
import { resolveWorkPlaneRef, normalize, cross } from '../../occt/WorkFeatureOps';
import type { NamedShape } from '../../occt/FaceNaming';

/**
 * The adapter-level result of executing a sketch feature. `wire` owns
 * the OCCT topology; callers must hand it to `disposeSketchResult` once
 * the downstream consumer (e.g. ExtrudeFeature) is done with it.
 *
 * `plane` carries the full 3D placement of the sketch's local frame
 * (origin + normal + xDir) so downstream features (extrude, revolve)
 * can build prisms / axes in the correct world-space direction.
 */
export type SketchResult = {
  sketchId: string;
  wire: WireHandle;
  plane: { origin: Vec3; normal: Vec3; xDir: Vec3 };
  closed: boolean;
  /** Placeholder NamedShape that downstream features (extrude/revolve) will
   *  attach faces to. Sketches themselves produce only edges/wires; the
   *  naming becomes meaningful once a solid is generated. `shape` here is
   *  a degenerate wrapper — downstream code should read `named.faceNames`,
   *  not `named.shape`. */
  named: NamedShape;
};

/**
 * Translates a domain `sketch` feature into a single closed OCCT wire
 * placed on the resolved work plane.
 *
 * The `workFeatures` cache must contain an entry for any work plane
 * referenced by `feature.plane.featureId` (origin work planes are seeded
 * by `newPart()` and migration; derived planes populate as `executeTree`
 * iterates the feature tree). Sketches that target a plane source not
 * yet implemented (e.g. a face — Plan T14) return `notImplemented`.
 */
export function executeSketchFeature(
  oc: OcctInstance,
  feature: Extract<Feature, { kind: 'sketch' }>,
  workFeatures: Map<string, WorkFeatureValue> = new Map(),
): Result<SketchResult, KernelError> {
  const cache = ensureOriginPlanes(workFeatures);
  const planeRes = resolveWorkPlaneRef(feature.plane, oc, null, cache);
  if (!planeRes.ok) {
    return err({
      kind: planeRes.error.kind,
      message: `SketchFeature: ${planeRes.error.message}`,
      correlationId: newCorrelationId(),
      featureId: feature.id,
    });
  }
  if (feature.primitives.length === 0) {
    return err({
      kind: 'degenerateSketch',
      message: 'Sketch is empty — cannot extrude. Draw a closed profile first.',
      correlationId: newCorrelationId(),
      featureId: feature.id,
    });
  }

  const { origin, normal: rawNormal } = planeRes.value;
  const normal = normalize(rawNormal);
  // Pick xDir as the in-plane projection of the global vector that's least
  // parallel to the normal. This keeps origin XY/YZ/XZ frames identical to
  // the legacy SweepOps.sketchPlaneFrame mapping for backward compatibility.
  const xCandidate: Vec3 =
    Math.abs(normal.x) > 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const xProj = sub(xCandidate, scale(normal, dotV(xCandidate, normal)));
  const u = normalize(xProj);
  const v = cross(normal, u);
  const frame: SketchFrame = { origin, u, v, n: normal };

  const edges: EdgeHandle[] = [];
  try {
    for (const p of feature.primitives) {
      switch (p.kind) {
        case 'line':
          edges.push(makeLineEdge(oc, { x: p.x1, y: p.y1 }, { x: p.x2, y: p.y2 }, frame));
          break;
        case 'rectangle':
          edges.push(...makeRectangleEdges(oc, p, frame));
          break;
        case 'circle':
          edges.push(makeCircleEdge(oc, p, frame));
          break;
        case 'arc':
          edges.push(makeArcEdge(oc, p, frame));
          break;
        case 'spline':
          edges.push(makeSplineEdge(oc, p, frame));
          break;
      }
    }

    const { closedWires, openChains } = combineEdgesIntoWires(oc, edges);

    if (closedWires.length === 1 && openChains.length === 0) {
      return ok({
        sketchId: feature.id,
        wire: closedWires[0]!,
        plane: { origin, normal, xDir: u },
        closed: true,
        named: { shape: { __brand: 'OcctShape', handle: null }, faceNames: [] },
      });
    }

    closedWires.forEach((w) => (w.wire as { delete?: () => void }).delete?.());

    let message: string;
    if (closedWires.length === 0 && openChains.length >= 1) {
      message = 'Sketch is not closed — cannot extrude. Check that all endpoints connect.';
    } else if (closedWires.length === 0 && openChains.length === 0) {
      message = 'Sketch is empty — cannot extrude. Draw a closed profile first.';
    } else if (closedWires.length >= 2 && openChains.length === 0) {
      message =
        'Sketch has multiple closed loops — cannot extrude. Merge or delete loops so exactly one remains. (Hole support comes in Sub-project 3.)';
    } else {
      message =
        'Sketch has a valid loop plus disconnected line(s). Delete the stray lines or connect them.';
    }
    return err({
      kind: 'degenerateSketch',
      message,
      correlationId: newCorrelationId(),
      featureId: feature.id,
    });
  } finally {
    edges.forEach(disposeEdge);
  }
}

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (v: Vec3, s: number): Vec3 => ({ x: v.x * s, y: v.y * s, z: v.z * s });
const dotV = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

const ORIGIN_PLANE_VALUES: ReadonlyArray<WorkFeatureValue> = [
  { featureId: 'origin.XY', kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } },
  { featureId: 'origin.YZ', kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } },
  { featureId: 'origin.XZ', kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } },
];

/**
 * Ensures the workFeature cache has entries for the three origin work
 * planes. Lets unit tests call `executeSketchFeature` with an empty cache
 * and still resolve `origin.XY/YZ/XZ` references; in production execution
 * `executeTree` populates these entries from the feature tree before any
 * sketch is processed.
 */
function ensureOriginPlanes(cache: Map<string, WorkFeatureValue>): Map<string, WorkFeatureValue> {
  if (cache.has('origin.XY') && cache.has('origin.YZ') && cache.has('origin.XZ')) return cache;
  const next = new Map(cache);
  for (const v of ORIGIN_PLANE_VALUES) {
    if (!next.has(v.featureId)) next.set(v.featureId, v);
  }
  return next;
}


/**
 * Releases the OCCT topology owned by a SketchResult. Safe to call
 * once; double-dispose is undefined.
 */
export function disposeSketchResult(_oc: OcctInstance, result: SketchResult): void {
  (result.wire.wire as { delete?: () => void }).delete?.();
}
