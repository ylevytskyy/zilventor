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

/**
 * Opaque branded handle around an OCCT TopoDS_Edge. Mirrors the shape
 * of `WireHandle`: the underlying edge is `unknown` so callers route
 * operations through this module.
 */
export type EdgeHandle = { __brand: 'EdgeHandle'; edge: unknown };

export type Point2 = { x: number; y: number };
export type ArcParams = {
  cx: number;
  cy: number;
  r: number;
  startAngle: number;
  endAngle: number;
};

/**
 * Builds a straight-line edge between two XY points on Z = 0.
 *
 * Overload notes:
 *   - `BRepBuilderAPI_MakeEdge_3(gp_Pnt, gp_Pnt)` — verified against
 *     `opencascade.full.d.ts` (two-point ctor, same one `makeRectangleWireXY`
 *     uses).
 */
export function makeLineEdge(oc: OcctInstance, a: Point2, b: Point2): EdgeHandle {
  const p1 = new oc.gp_Pnt_3(a.x, a.y, 0);
  const p2 = new oc.gp_Pnt_3(b.x, b.y, 0);
  const mk = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2);
  const edge = mk.Edge();
  mk.delete();
  p1.delete();
  p2.delete();
  return { __brand: 'EdgeHandle', edge };
}

/**
 * Builds a circular arc edge in the XY plane (normal = +Z, X axis = +X).
 * `startAngle` and `endAngle` are trim parameters on the underlying circle,
 * measured CCW from the +X direction.
 *
 * Overload notes:
 *   - `gp_Dir_4(x, y, z)` — three-real direction ctor.
 *   - `gp_Ax2_2(gp_Pnt, gp_Dir N, gp_Dir Vx)` — origin + normal + X.
 *   - `gp_Circ_2(gp_Ax2, radius)` — axis + radius.
 *   - `BRepBuilderAPI_MakeEdge_9(gp_Circ, p1, p2)` — trim-by-parameter arc.
 */
export function makeArcEdge(oc: OcctInstance, a: ArcParams): EdgeHandle {
  const center = new oc.gp_Pnt_3(a.cx, a.cy, 0);
  const axisDir = new oc.gp_Dir_4(0, 0, 1);
  const xDir = new oc.gp_Dir_4(1, 0, 0);
  const ax2 = new oc.gp_Ax2_2(center, axisDir, xDir);
  const circ = new oc.gp_Circ_2(ax2, a.r);
  const mk = new oc.BRepBuilderAPI_MakeEdge_9(circ, a.startAngle, a.endAngle);
  const edge = mk.Edge();
  mk.delete();
  circ.delete();
  ax2.delete();
  xDir.delete();
  axisDir.delete();
  center.delete();
  return { __brand: 'EdgeHandle', edge };
}

/**
 * Extracts the first and last vertex positions of an edge.
 *
 * Overload notes:
 *   - `TopoDS.Edge_1(shape)` — downcasts a `TopoDS_Shape` to `TopoDS_Edge`.
 *     The handle's underlying value is already a `TopoDS_Edge`, but this
 *     is a no-op cast and keeps the signature honest.
 *   - `TopExp.FirstVertex` / `TopExp.LastVertex` — plain static methods
 *     (no `_N` overload suffix in opencascade.js 2.0.0-beta). The second
 *     argument is `CumOri` ("cumulate orientation"); `false` gives the
 *     vertices in the edge's natural direction.
 *   - `BRep_Tool.Pnt(vertex)` — static, returns a fresh `gp_Pnt`.
 */
export function edgeEndpoints(oc: OcctInstance, e: EdgeHandle): { start: Point2; end: Point2 } {
  const tds = oc.TopoDS.Edge_1(e.edge as never);
  const v1 = oc.TopExp.FirstVertex(tds, false);
  const v2 = oc.TopExp.LastVertex(tds, false);
  const p1 = oc.BRep_Tool.Pnt(v1);
  const p2 = oc.BRep_Tool.Pnt(v2);
  const result = {
    start: { x: p1.X(), y: p1.Y() },
    end: { x: p2.X(), y: p2.Y() }
  };
  p1.delete();
  p2.delete();
  v1.delete();
  v2.delete();
  return result;
}

/**
 * Frees the underlying OCCT edge. Undefined behavior if called twice.
 */
export function disposeEdge(e: EdgeHandle): void {
  (e.edge as { delete?: () => void }).delete?.();
}
