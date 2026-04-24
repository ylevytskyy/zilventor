import type { OcctInstance } from '../../occt/occtLoader';
import type { NamedShape } from '../../occt/FaceNaming';
import { translateShape } from '../../occt/TransformOps';
import { fuseShapes, cutShapes } from '../../occt/BooleanOps';
import { disposeShape, type OcctShape } from '../../occt/SolidOps';
import {
  ok,
  err,
  type Result,
  type KernelError,
  newCorrelationId,
  type BooleanOperation,
  type PatternAxis
} from '@zilventor/shared';

export type LinearPatternRequest = {
  /** The running body to pattern into. Consumed on success (caller
   *  should clear its reference once this returns ok).
   */
  runningBody: NamedShape;
  /** Standalone source shape (output of the source extrude/revolve,
   *  NOT already boolean'd with the running body). Not consumed — the
   *  caller still owns it and disposes after this returns.
   */
  sourceShape: OcctShape;
  /** Boolean op used when fusing each copy into the running body. Must
   *  match the source feature's operation (`join` for studs, `cut` for
   *  holes). `new` is rejected — pattern of a `new` has no meaning.
   */
  operation: BooleanOperation;
  direction: PatternAxis;
  spacing: number;
  /** Total copies including the source (>= 1). count=1 is a no-op. */
  count: number;
  /** Feature id used for error reporting + synthetic face names. */
  featureId: string;
};

/**
 * Boolean-op count-1 translated copies of `sourceShape` into
 * `runningBody`. The original `sourceShape` is NOT applied again — the
 * caller has already fused it into the body via the source feature's
 * own executeTree branch.
 *
 * On success, returns a fresh NamedShape with empty faceNames for newly
 * introduced copies (patterned copies don't carry FaceName metadata in
 * the MVP — downstream features addressing them would need a follow-up
 * that threads face-name pattern through the boolean op).
 */
export function executeLinearPatternFeature(
  oc: OcctInstance,
  req: LinearPatternRequest
): Result<NamedShape, KernelError> {
  if (req.operation === 'new') {
    return err({
      kind: 'invalidParameter',
      message: 'Linear pattern source must use join or cut, not new',
      correlationId: newCorrelationId(),
      featureId: req.featureId
    });
  }
  if (req.count < 1) {
    return err({
      kind: 'invalidParameter',
      message: `Linear pattern count must be >= 1 (got ${req.count})`,
      correlationId: newCorrelationId(),
      featureId: req.featureId
    });
  }
  if (req.count === 1) {
    // No replication — return the running body unchanged.
    return ok(req.runningBody);
  }
  if (!isFinite(req.spacing) || req.spacing === 0) {
    return err({
      kind: 'invalidParameter',
      message: `Linear pattern spacing must be non-zero (got ${req.spacing})`,
      correlationId: newCorrelationId(),
      featureId: req.featureId
    });
  }

  let currentBody: OcctShape = req.runningBody.shape;
  let ownCurrent = false; // only true after first fuse/cut produces a fresh handle

  for (let i = 1; i < req.count; i++) {
    const dx = req.direction === 'x' ? i * req.spacing : 0;
    const dy = req.direction === 'y' ? i * req.spacing : 0;
    const dz = req.direction === 'z' ? i * req.spacing : 0;
    const copy = translateShape(oc, req.sourceShape, dx, dy, dz);
    const combined = req.operation === 'join'
      ? fuseShapes(oc, currentBody, copy)
      : cutShapes(oc, currentBody, copy);
    if (!combined.ok) {
      disposeShape(copy);
      if (ownCurrent) disposeShape(currentBody);
      return err({ ...combined.error, featureId: req.featureId });
    }
    // The boolean op consumed both operands' topology. Dispose `copy` and the\n    // previous `currentBody` (if we own it) before moving to the new result.\n    disposeShape(copy);
    if (ownCurrent) disposeShape(currentBody);
    currentBody = combined.value;
    ownCurrent = true;
  }

  // Face names for the patterned body: keep original running-body names where\n  // IsSame matches; new copy faces are unnamed in the MVP.
  const named: NamedShape = { shape: currentBody, faceNames: [] };
  const map = new oc.TopTools_IndexedMapOfShape_1();
  oc.TopExp.MapShapes_1(
    currentBody.handle as never,
    oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
    map as never
  );
  const extent = (map as { Extent: () => number }).Extent();
  for (let i = 1; i <= extent; i++) {
    const faceShape = (map as { FindKey: (i: number) => unknown }).FindKey(i);
    const face = (oc.TopoDS as { Face_1: (s: unknown) => unknown }).Face_1(
      faceShape as never
    );
    const surviving = req.runningBody.faceNames.find((f) =>
      (face as { IsSame?: (o: unknown) => boolean }).IsSame?.(f.face as never)
    );
    if (surviving) {
      named.faceNames.push({ name: surviving.name, face });
    }
  }
  map.delete();
  return ok(named);
}
