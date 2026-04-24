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
 * Fillet request. Supports constant radius (T9), variable start/end radius
 * (T10), and per-vertex-per-edge setbacks (T11). The shape of `FilletRequest`
 * is stable so downstream callers (feature adapter, solver cascade) do not
 * churn across tasks.
 *
 * NOTE: setbacks are accepted in the request but currently have NO effect —
 * the opencascade.js 2.0.0-beta binding does not expose a per-vertex setback
 * method on `BRepFilletAPI_MakeFillet`. Setbacks are stored in the feature
 * data model so that when a future binding exposes it, wiring a single call
 * inside `makeFillet` activates them without touching callers.
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
 *     variable; `Add_4` is a law-function variant.)
 *   - `Add_5(UandR: TColgp_Array1OfPnt2d, E: TopoDS_Edge)` is the table-
 *     driven variable-radius overload used for T10. Each Pnt2d packs
 *     `(parameter ∈ [0..1], radius)`; a 2-entry table produces a linear
 *     radius transition along the edge.
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
  // Variable-radius scratch allocations held for the duration of one loop
  // iteration. Tracked at function scope so the catch block can dispose them
  // if `Add_5` throws mid-iteration.
  let arr: { delete: () => void } | null = null;
  let p0: { delete: () => void } | null = null;
  let p1: { delete: () => void } | null = null;
  try {
    mkFillet = new oc.BRepFilletAPI_MakeFillet(
      solid.handle as never,
      oc.ChFi3d_FilletShape.ChFi3d_Rational as never
    );
    for (const e of req.edges) {
      if (e.variable) {
        // Two-entry TColgp_Array1OfPnt2d: (parameter, radius) pairs at 0 and 1
        // give OCCT a linear radius law along the edge. `TColgp_Array1OfPnt2d_2`
        // is the `(lower, upper)` constructor; `gp_Pnt2d_3` is the `(x, y)`
        // constructor; `Add_5` is the `(TColgp_Array1OfPnt2d, TopoDS_Edge)`
        // overload — all verified against `opencascade.full.d.ts`.
        arr = new oc.TColgp_Array1OfPnt2d_2(1, 2);
        p0 = new oc.gp_Pnt2d_3(0, e.variable.startRadius);
        p1 = new oc.gp_Pnt2d_3(1, e.variable.endRadius);
        (arr as unknown as { SetValue: (i: number, v: unknown) => void }).SetValue(
          1,
          p0 as never
        );
        (arr as unknown as { SetValue: (i: number, v: unknown) => void }).SetValue(
          2,
          p1 as never
        );
        (mkFillet as { Add_5: (arr: unknown, edge: unknown) => void }).Add_5(
          arr as never,
          e.edge as never
        );
        // Dispose in reverse allocation order and clear the function-scope
        // refs so the catch block's cleanup is idempotent.
        p1.delete();
        p1 = null;
        p0.delete();
        p0 = null;
        arr.delete();
        arr = null;
      } else {
        (mkFillet as { Add_2: (r: number, edge: unknown) => void }).Add_2(
          e.radius,
          e.edge as never
        );
      }
    }
    // Per-vertex-per-edge setback. The opencascade.js 2.0.0-beta binding does
    // NOT expose a `SetSetback` (or equivalent) method on
    // `BRepFilletAPI_MakeFillet` — grep of `opencascade.full.d.ts` for
    // `SetSetback|Setback` returns zero hits on the MakeFillet class; only
    // `SetFilletShape` is exposed, which controls the global blend shape, not
    // vertex-local pullback. Until the binding catches up, the loop below is
    // a no-op guard: it probes for a future `SetSetback` method and, if
    // present, calls it per entry. The feature data model still carries
    // setbacks (T12) so UX, serialization, and solver cascade are unaffected
    // by the missing binding — flipping this conditional live once the
    // method appears is the only change needed to activate them.
    const setFn = (mkFillet as unknown as {
      SetSetback?: (edge: unknown, vertex: unknown, setback: number) => void;
    }).SetSetback;
    if (setFn) {
      for (const sb of req.setbacks) {
        setFn.call(mkFillet, sb.edge as never, sb.vertex as never, sb.setback);
      }
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
    p1?.delete?.();
    p0?.delete?.();
    arr?.delete?.();
    (mkFillet as { delete?: () => void } | null)?.delete?.();
    (range as { delete?: () => void } | null)?.delete?.();
    return err({
      kind: 'filletFailed',
      message: `Fillet threw: ${(e as Error).message}`,
      correlationId: newCorrelationId()
    });
  }
}
