import type { OcctInstance } from './occtLoader';

/**
 * Opaque branded handle around an OCCT TopoDS_Wire. The underlying
 * `wire` is kept as `unknown` so callers cannot invoke OCCT methods on
 * it without going through this module (or a downstream op that takes
 * a WireHandle).
 */
export type WireHandle = { __brand: 'WireHandle'; wire: unknown };

/**
 * Builds a closed rectangular wire on the XY plane (Z = 0) spanning
 * [x, x+w] x [y, y+h].
 *
 * API adaptation notes (vs. textbook OCCT):
 *   - `gp_Pnt_3(x, y, z)` is the three-real constructor; `gp_Pnt_1` is
 *     the default ctor and `gp_Pnt_2` takes a `gp_XYZ`.
 *   - `BRepBuilderAPI_MakeEdge_3(gp_Pnt, gp_Pnt)` is the two-point
 *     constructor we want; the d.ts lists 30+ overloads for curves,
 *     vertices, etc.
 *   - `BRepBuilderAPI_MakeWire_1()` is the default ctor; we could use
 *     `_5` to pass all four edges at construction time, but calling
 *     `Add_1(TopoDS_Edge)` four times keeps the pattern uniform and
 *     easier to extend to n-edge wires later.
 *
 * Memory management:
 *   - Each `BRepBuilderAPI_MakeEdge_3` / `MakeWire_1` is a builder;
 *     its internal topology is copied into the returned `TopoDS_Edge`
 *     / `TopoDS_Wire`. We delete the builders immediately.
 *   - `Edge()` returns a fresh `TopoDS_Edge` (a `TopoDS_Shape` subclass)
 *     in opencascade.js — it has its own JS proxy and `.delete()`. The
 *     Tessellator precedent (`face.delete()`, `faceShape.delete()`)
 *     treats these as owning values, so we dispose `e1..e4` too once
 *     MakeWire has consumed them into the final wire.
 *   - The returned `TopoDS_Wire` is the only live handle; callers free
 *     it via `disposeWire`.
 */
export function makeRectangleWireXY(
  oc: OcctInstance,
  x: number,
  y: number,
  w: number,
  h: number
): WireHandle {
  const p1 = new oc.gp_Pnt_3(x, y, 0);
  const p2 = new oc.gp_Pnt_3(x + w, y, 0);
  const p3 = new oc.gp_Pnt_3(x + w, y + h, 0);
  const p4 = new oc.gp_Pnt_3(x, y + h, 0);

  const mkE1 = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2);
  const mkE2 = new oc.BRepBuilderAPI_MakeEdge_3(p2, p3);
  const mkE3 = new oc.BRepBuilderAPI_MakeEdge_3(p3, p4);
  const mkE4 = new oc.BRepBuilderAPI_MakeEdge_3(p4, p1);

  const e1 = mkE1.Edge();
  const e2 = mkE2.Edge();
  const e3 = mkE3.Edge();
  const e4 = mkE4.Edge();

  const mkWire = new oc.BRepBuilderAPI_MakeWire_1();
  mkWire.Add_1(e1);
  mkWire.Add_1(e2);
  mkWire.Add_1(e3);
  mkWire.Add_1(e4);
  const wire = mkWire.Wire();

  mkWire.delete();
  mkE1.delete();
  mkE2.delete();
  mkE3.delete();
  mkE4.delete();
  e1.delete();
  e2.delete();
  e3.delete();
  e4.delete();
  p1.delete();
  p2.delete();
  p3.delete();
  p4.delete();

  return { __brand: 'WireHandle', wire };
}

/**
 * Frees the underlying OCCT wire. Undefined behavior if called twice;
 * the caller must null out their reference after disposal.
 */
export function disposeWire(wire: WireHandle): void {
  (wire.wire as { delete?: () => void }).delete?.();
}
