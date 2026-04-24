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
 * Symmetric constant-distance chamfer request. Mirrors `FilletRequest` but
 * without the variable/setback fields — `BRepFilletAPI_MakeChamfer.Add_2`
 * is the only overload we wire for the MVP. The asymmetric
 * two-distance / distance-angle overloads (`Add_3`, `AddDA`) can be
 * threaded in later without changing this surface.
 */
export type ChamferRequest = {
  edges: Array<{ edge: unknown; distance: number }>;
};

/**
 * Build a chamfered solid via `BRepFilletAPI_MakeChamfer`.
 *
 * Overload notes (verified against `opencascade.full.d.ts`):
 *   - Constructor `(TopoDS_Shape)` — single arg, no shape-type enum
 *     (unlike `MakeFillet` which needs `ChFi3d_FilletShape`).
 *   - `Add_2(Dis: Standard_Real, E: TopoDS_Edge)` — symmetric chamfer
 *     with a single distance on an edge. `Add_1(E)` exists for a
 *     default-distance variant we don't need.
 *   - `Build(Message_ProgressRange)` — same progress pattern as fillet
 *     and boolean ops.
 *
 * Lifecycle: `mkChamfer` and `range` are disposed on every path
 * (pre-build guard, not-done, success, thrown). Edge handles passed in
 * by the caller are not owned by this function.
 */
export function makeChamfer(
  oc: OcctInstance,
  solid: OcctShape,
  req: ChamferRequest
): Result<OcctShape, KernelError> {
  if (req.edges.length === 0) {
    return err({
      kind: 'invalidParameter',
      message: 'Chamfer has no edges; pick at least one',
      correlationId: newCorrelationId()
    });
  }
  for (const e of req.edges) {
    if (e.distance <= 0) {
      return err({
        kind: 'invalidParameter',
        message: `Chamfer distance must be > 0 (got ${e.distance})`,
        correlationId: newCorrelationId()
      });
    }
  }

  let mkChamfer: unknown = null;
  let range: unknown = null;
  try {
    mkChamfer = new oc.BRepFilletAPI_MakeChamfer(solid.handle as never);
    for (const e of req.edges) {
      (mkChamfer as { Add_2: (d: number, edge: unknown) => void }).Add_2(
        e.distance,
        e.edge as never
      );
    }
    range = new oc.Message_ProgressRange_1();
    (mkChamfer as { Build: (r: unknown) => void }).Build(range);
    const isDone = (mkChamfer as { IsDone: () => boolean }).IsDone();
    if (!isDone) {
      (mkChamfer as { delete: () => void }).delete();
      (range as { delete: () => void }).delete();
      return err({
        kind: 'filletFailed',
        message: 'Chamfer did not converge',
        correlationId: newCorrelationId()
      });
    }
    const shape = (mkChamfer as { Shape: () => unknown }).Shape();
    (mkChamfer as { delete: () => void }).delete();
    (range as { delete: () => void }).delete();
    return ok({ __brand: 'OcctShape', handle: shape });
  } catch (e) {
    (mkChamfer as { delete?: () => void } | null)?.delete?.();
    (range as { delete?: () => void } | null)?.delete?.();
    return err({
      kind: 'filletFailed',
      message: `Chamfer threw: ${(e as Error).message}`,
      correlationId: newCorrelationId()
    });
  }
}
