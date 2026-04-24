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
 * Shell request: hollow out `solid` by removing `facesToRemove` and
 * thickening the remaining shell uniformly.
 *
 *   thickness > 0  → grow outward (thicken the wall outside the body)
 *   thickness < 0  → hollow inward (carve a cavity — typical use)
 */
export type ShellRequest = {
  facesToRemove: unknown[]; // TopoDS_Face handles belonging to `solid`
  thickness: number;
  /** Tolerance passed to OCCT. Default 1e-3 mm is fine for furniture. */
  tolerance?: number;
};

/**
 * Build a thick-shelled solid via `BRepOffsetAPI_MakeThickSolid` +
 * `MakeThickSolidByJoin`.
 *
 * Overload notes (verified against `opencascade.full.d.ts`):
 *   - Constructor is `()` (nullary); the shape + offset arguments are
 *     passed to `MakeThickSolidByJoin`, not the constructor.
 *   - `MakeThickSolidByJoin(S, closingFaces, Offset, Tol, Mode,
 *     Intersection, SelfInter, Join, RemoveIntEdges, ProgressRange)`
 *     needs the closing faces as `TopTools_ListOfShape`.
 *   - Mode: `BRepOffset_Mode.BRepOffset_Skin` (value 0) is the default
 *     join-skin mode appropriate for solid hollow-out.
 *   - Join: `GeomAbs_JoinType.GeomAbs_Intersection` (value 2) gives
 *     sharp internal corners — cleanest result for furniture cavities.
 *   - After the join call, `Build(progressRange)` finalizes. `IsDone()`
 *     reports success.
 *
 * Lifecycle: all OCCT scratch handles (mkShell, range, faces-list) are
 * disposed on every path. The returned shape handle is owned by the
 * caller.
 */
export function makeShell(
  oc: OcctInstance,
  solid: OcctShape,
  req: ShellRequest
): Result<OcctShape, KernelError> {
  if (req.facesToRemove.length === 0) {
    return err({
      kind: 'invalidParameter',
      message: 'Shell needs at least one face to remove',
      correlationId: newCorrelationId()
    });
  }
  if (req.thickness === 0) {
    return err({
      kind: 'invalidParameter',
      message: 'Shell thickness must be non-zero',
      correlationId: newCorrelationId()
    });
  }

  const tol = req.tolerance ?? 1e-3;
  let mkShell: unknown = null;
  let range: unknown = null;
  let facesList: { delete: () => void } | null = null;

  try {
    mkShell = new oc.BRepOffsetAPI_MakeThickSolid();
    facesList = new oc.TopTools_ListOfShape_1();
    for (const f of req.facesToRemove) {
      (facesList as unknown as {
        Append_1: (s: unknown) => unknown;
      }).Append_1(f as never);
    }
    range = new oc.Message_ProgressRange_1();
    (mkShell as {
      MakeThickSolidByJoin: (
        s: unknown,
        closingFaces: unknown,
        offset: number,
        tol: number,
        mode: unknown,
        intersection: unknown,
        selfInter: unknown,
        join: unknown,
        removeIntEdges: unknown,
        progressRange: unknown
      ) => void;
    }).MakeThickSolidByJoin(
      solid.handle as never,
      facesList as never,
      req.thickness,
      tol,
      oc.BRepOffset_Mode.BRepOffset_Skin as never,
      false as never,
      false as never,
      oc.GeomAbs_JoinType.GeomAbs_Intersection as never,
      false as never,
      range as never
    );
    const isDone = (mkShell as { IsDone: () => boolean }).IsDone();
    if (!isDone) {
      (mkShell as { delete: () => void }).delete();
      (range as { delete: () => void }).delete();
      facesList.delete();
      return err({
        kind: 'filletFailed',
        message: 'Shell did not converge',
        correlationId: newCorrelationId()
      });
    }
    const shape = (mkShell as { Shape: () => unknown }).Shape();
    (mkShell as { delete: () => void }).delete();
    (range as { delete: () => void }).delete();
    facesList.delete();
    return ok({ __brand: 'OcctShape', handle: shape });
  } catch (e) {
    facesList?.delete?.();
    (mkShell as { delete?: () => void } | null)?.delete?.();
    (range as { delete?: () => void } | null)?.delete?.();
    return err({
      kind: 'filletFailed',
      message: `Shell threw: ${(e as Error).message}`,
      correlationId: newCorrelationId()
    });
  }
}
