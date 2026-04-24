import type { OcctInstance } from './occtLoader';
import type { OcctShape } from './SolidOps';
import {
  ok,
  err,
  type Result,
  type KernelError,
  newCorrelationId
} from '@zilventor/shared';

/**
 * Unions two shapes via `BRepAlgoAPI_Fuse`. Each boolean requires its own
 * `Message_ProgressRange_1` instance — one for the constructor and one for
 * `Build()` — so we allocate both and dispose them alongside the fuser.
 *
 * Overload notes:
 *   - `BRepAlgoAPI_Fuse_3(S1, S2, theRange)` — two-shape + progress variant,
 *     verified against `opencascade.full.d.ts`.
 */
export function fuseShapes(
  oc: OcctInstance,
  a: OcctShape,
  b: OcctShape
): Result<OcctShape, KernelError> {
  const rangeCtor = new oc.Message_ProgressRange_1();
  const rangeBuild = new oc.Message_ProgressRange_1();
  try {
    const fuse = new oc.BRepAlgoAPI_Fuse_3(
      a.handle as never,
      b.handle as never,
      rangeCtor
    );
    fuse.Build(rangeBuild);
    if (!fuse.IsDone()) {
      fuse.delete();
      rangeCtor.delete();
      rangeBuild.delete();
      return err({
        kind: 'booleanFailed',
        message: 'Fuse did not converge',
        correlationId: newCorrelationId()
      });
    }
    const shape = fuse.Shape();
    fuse.delete();
    rangeCtor.delete();
    rangeBuild.delete();
    return ok({ __brand: 'OcctShape', handle: shape });
  } catch (e) {
    (rangeCtor as { delete?: () => void }).delete?.();
    (rangeBuild as { delete?: () => void }).delete?.();
    return err({
      kind: 'booleanFailed',
      message: `Fuse threw: ${(e as Error).message}`,
      correlationId: newCorrelationId()
    });
  }
}

/**
 * Computes the volume of a shape via `BRepGProp.VolumeProperties_1`.
 * Returns 0 if the shape contains no closed solids.
 *
 * Overload notes:
 *   - `GProp_GProps_1()` is the default-ctor accumulator.
 *   - `BRepGProp.VolumeProperties_1(S, props, OnlyClosed, SkipShared,
 *     UseTriangulation)` — static; `OnlyClosed=true` restricts to closed
 *     solids, exactly what we want for a boolean result.
 */
function shapeVolume(oc: OcctInstance, shape: unknown): number {
  const props = new oc.GProp_GProps_1();
  try {
    oc.BRepGProp.VolumeProperties_1(
      shape as never,
      props,
      true as never,
      false as never,
      false as never
    );
    return props.Mass();
  } finally {
    props.delete();
  }
}

/**
 * Subtracts `b` from `a` via `BRepAlgoAPI_Cut`. Returns `err` when the
 * result is effectively empty:
 *   1. The embind `IsNull()` check fires, OR
 *   2. The result shape contains no solids (no-overlap cut can produce
 *      a non-null but empty compound in opencascade.js), OR
 *   3. The result's volume equals the input `a`'s volume within a small
 *      tolerance — meaning no material was removed. This catches the
 *      case where a disjoint `b` leaves `a` untouched; semantically the
 *      user intended to remove material and nothing was removed, so we
 *      surface that as a failure rather than silently succeeding.
 *
 * Overload notes:
 *   - `BRepAlgoAPI_Cut_3(S1, S2, theRange)` — two-shape + progress variant.
 */
export function cutShapes(
  oc: OcctInstance,
  a: OcctShape,
  b: OcctShape
): Result<OcctShape, KernelError> {
  const rangeCtor = new oc.Message_ProgressRange_1();
  const rangeBuild = new oc.Message_ProgressRange_1();
  try {
    const cut = new oc.BRepAlgoAPI_Cut_3(
      a.handle as never,
      b.handle as never,
      rangeCtor
    );
    cut.Build(rangeBuild);
    if (!cut.IsDone()) {
      cut.delete();
      rangeCtor.delete();
      rangeBuild.delete();
      return err({
        kind: 'booleanFailed',
        message: 'Cut did not converge',
        correlationId: newCorrelationId()
      });
    }
    const shape = cut.Shape();
    const isNull =
      (shape as { IsNull?: () => boolean }).IsNull?.() ?? false;
    let hasSolid = false;
    if (!isNull) {
      const explorer = new oc.TopExp_Explorer_2(
        shape as never,
        oc.TopAbs_ShapeEnum.TopAbs_SOLID as never,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never
      );
      hasSolid = explorer.More();
      explorer.delete();
    }
    if (isNull || !hasSolid) {
      cut.delete();
      rangeCtor.delete();
      rangeBuild.delete();
      (shape as { delete?: () => void }).delete?.();
      return err({
        kind: 'booleanFailed',
        message: 'Cut produced empty result',
        correlationId: newCorrelationId()
      });
    }
    // No-op detection: if the cut removed no material the result has the
    // same volume as `a`. Treat that as a failed operation.
    const volBefore = shapeVolume(oc, a.handle);
    const volAfter = shapeVolume(oc, shape);
    cut.delete();
    rangeCtor.delete();
    rangeBuild.delete();
    const eps = Math.max(volBefore, 1) * 1e-6;
    if (volBefore > 0 && Math.abs(volAfter - volBefore) < eps) {
      (shape as { delete?: () => void }).delete?.();
      return err({
        kind: 'booleanFailed',
        message: 'Cut removed no material (shapes do not overlap)',
        correlationId: newCorrelationId()
      });
    }
    return ok({ __brand: 'OcctShape', handle: shape });
  } catch (e) {
    (rangeCtor as { delete?: () => void }).delete?.();
    (rangeBuild as { delete?: () => void }).delete?.();
    return err({
      kind: 'booleanFailed',
      message: `Cut threw: ${(e as Error).message}`,
      correlationId: newCorrelationId()
    });
  }
}
