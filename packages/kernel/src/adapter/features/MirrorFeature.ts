import type { OcctInstance } from '../../occt/occtLoader';
import type { NamedShape } from '../../occt/FaceNaming';
import { mirrorShape } from '../../occt/TransformOps';
import { fuseShapes, cutShapes } from '../../occt/BooleanOps';
import { disposeShape, type OcctShape } from '../../occt/SolidOps';
import {
  ok,
  err,
  type Result,
  type KernelError,
  newCorrelationId,
  type BooleanOperation,
  type MirrorPlane
} from '@zilventor/shared';

export type MirrorRequest = {
  runningBody: NamedShape;
  /** Standalone source shape (output of the source extrude/revolve). Not
   *  consumed — caller disposes after this returns.
   */
  sourceShape: OcctShape;
  /** Same op the source feature uses. `new` is rejected (same rationale
   *  as LinearPattern: mirror of a `new` has no meaning on an accumulator).
   */
  operation: BooleanOperation;
  plane: MirrorPlane;
  featureId: string;
};

/**
 * Reflect `sourceShape` across a world coordinate plane and boolean-op
 * the mirrored copy into `runningBody`. The original source has already
 * been fused by its own feature branch; only the mirrored copy is
 * applied here.
 *
 * Memory: the mirrored copy handle is disposed before return. The
 * running-body input is consumed when the boolean op succeeds; caller
 * should clear its reference.
 */
export function executeMirrorFeature(
  oc: OcctInstance,
  req: MirrorRequest
): Result<NamedShape, KernelError> {
  if (req.operation === 'new') {
    return err({
      kind: 'invalidParameter',
      message: 'Mirror source must use join or cut, not new',
      correlationId: newCorrelationId(),
      featureId: req.featureId
    });
  }

  const mirrored = mirrorShape(oc, req.sourceShape, req.plane);
  const combined = req.operation === 'join'
    ? fuseShapes(oc, req.runningBody.shape, mirrored)
    : cutShapes(oc, req.runningBody.shape, mirrored);
  if (!combined.ok) {
    disposeShape(mirrored);
    return err({ ...combined.error, featureId: req.featureId });
  }
  disposeShape(mirrored);

  const named: NamedShape = { shape: combined.value, faceNames: [] };
  const map = new oc.TopTools_IndexedMapOfShape_1();
  oc.TopExp.MapShapes_1(
    combined.value.handle as never,
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
