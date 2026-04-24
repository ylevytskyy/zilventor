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
 * Constant-radius fillet request. Variable-radius (`variable`) and per-vertex
 * setbacks are reserved for T10 / T11 — this file only wires the constant
 * case, but keeps the shape of `FilletRequest` stable so downstream callers
 * (feature adapter, solver cascade) do not churn when the later tasks land.
 */
export type FilletRequest = {
  edges: Array<{
    edge: unknown;
    radius: number;
    variable?: { startRadius: number; endRadius: number };
  }>;
  setbacks: Array<{ vertex: unknown; edge: unknown; setback: number }>;
};

/**
 * Build a filleted solid via `BRepFilletAPI_MakeFillet`.
 *
 * Overload notes (verified against `opencascade.full.d.ts`):
 *   - `BRepFilletAPI_MakeFillet` is exposed with a single constructor
 *     `(TopoDS_Shape, ChFi3d_FilletShape)` — no numbered suffix, unlike most
 *     OCCT builders in this binding.
 *   - `Add_2(Radius: Standard_Real, E: TopoDS_Edge)` registers an edge with
 *     a constant radius. (`Add_1` is edge-only; `Add_3` is two-radius
 *     variable; `Add_4`/`_5` are law-function / table variants for T10.)
 *   - `Build(Message_ProgressRange)` requires an explicit progress range —
 *     same pattern as `BooleanOps.ts`.
 *   - `ChFi3d_FilletShape.ChFi3d_Rational` is the default for rounded
 *     constant-radius fillets. `ChFi3d_QuasiAngular` / `ChFi3d_Polynomial`
 *     exist but are uncommon in CAD UX.
 *
 * Lifecycle: `mkFillet` and `range` are disposed on every path (pre-build
 * guard, not-done, success, thrown). Edge handles passed in by the caller
 * are not owned by this function.
 */
export function makeFillet(
  oc: OcctInstance,
  solid: OcctShape,
  req: FilletRequest
): Result<OcctShape, KernelError> {
  if (req.edges.length === 0) {
    return err({
      kind: 'invalidParameter',
      message: 'Fillet has no edges; pick at least one',
      correlationId: newCorrelationId()
    });
  }
  for (const e of req.edges) {
    if (!e.variable && e.radius <= 0) {
      return err({
        kind: 'invalidParameter',
        message: `Fillet radius must be > 0 (got ${e.radius})`,
        correlationId: newCorrelationId()
      });
    }
  }

  let mkFillet: unknown = null;
  let range: unknown = null;
  try {
    mkFillet = new oc.BRepFilletAPI_MakeFillet(
      solid.handle as never,
      oc.ChFi3d_FilletShape.ChFi3d_Rational as never
    );
    for (const e of req.edges) {
      (mkFillet as { Add_2: (r: number, edge: unknown) => void }).Add_2(
        e.radius,
        e.edge as never
      );
    }
    range = new oc.Message_ProgressRange_1();
    (mkFillet as { Build: (r: unknown) => void }).Build(range);
    const isDone = (mkFillet as { IsDone: () => boolean }).IsDone();
    if (!isDone) {
      (mkFillet as { delete: () => void }).delete();
      (range as { delete: () => void }).delete();
      return err({
        kind: 'filletFailed',
        message: 'Fillet did not converge',
        correlationId: newCorrelationId()
      });
    }
    const shape = (mkFillet as { Shape: () => unknown }).Shape();
    (mkFillet as { delete: () => void }).delete();
    (range as { delete: () => void }).delete();
    return ok({ __brand: 'OcctShape', handle: shape });
  } catch (e) {
    (mkFillet as { delete?: () => void } | null)?.delete?.();
    (range as { delete?: () => void } | null)?.delete?.();
    return err({
      kind: 'filletFailed',
      message: `Fillet threw: ${(e as Error).message}`,
      correlationId: newCorrelationId()
    });
  }
}
