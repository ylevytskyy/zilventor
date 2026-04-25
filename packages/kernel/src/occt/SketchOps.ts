import type { OcctInstance } from './occtLoader';

export type Vec3 = { x: number; y: number; z: number };

/**
 * 3D placement of a sketch's local 2D plane in world space. (x, y) sketch
 * coords map to world via `origin + x*u + y*v`. `n` is the plane normal
 * (used for circle/arc orientation and downstream extrude direction).
 * For the XY origin plane this is the identity frame.
 */
export type SketchFrame = {
  origin: Vec3;
  u: Vec3;
  v: Vec3;
  n: Vec3;
};

export const XY_FRAME: SketchFrame = {
  origin: { x: 0, y: 0, z: 0 },
  u: { x: 1, y: 0, z: 0 },
  v: { x: 0, y: 1, z: 0 },
  n: { x: 0, y: 0, z: 1 },
};

function frameTo3D(frame: SketchFrame, x: number, y: number): Vec3 {
  return {
    x: frame.origin.x + x * frame.u.x + y * frame.v.x,
    y: frame.origin.y + x * frame.u.y + y * frame.v.y,
    z: frame.origin.z + x * frame.u.z + y * frame.v.z,
  };
}


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
export function makeLineEdge(
  oc: OcctInstance,
  a: Point2,
  b: Point2,
  frame: SketchFrame = XY_FRAME,
): EdgeHandle {
  const a3 = frameTo3D(frame, a.x, a.y);
  const b3 = frameTo3D(frame, b.x, b.y);
  const p1 = new oc.gp_Pnt_3(a3.x, a3.y, a3.z);
  const p2 = new oc.gp_Pnt_3(b3.x, b3.y, b3.z);
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
export function makeArcEdge(
  oc: OcctInstance,
  a: ArcParams,
  frame: SketchFrame = XY_FRAME,
): EdgeHandle {
  const c3 = frameTo3D(frame, a.cx, a.cy);
  const center = new oc.gp_Pnt_3(c3.x, c3.y, c3.z);
  const axisDir = new oc.gp_Dir_4(frame.n.x, frame.n.y, frame.n.z);
  const xDir = new oc.gp_Dir_4(frame.u.x, frame.u.y, frame.u.z);
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

export type CircleParams = { cx: number; cy: number; r: number };
export type SplineParams = {
  controlPoints: ReadonlyArray<Point2>;
  degree: 2 | 3;
  closed: boolean;
};
export type RectangleParams = { x: number; y: number; w: number; h: number };

/**
 * Builds a closed circular edge in the XY plane (normal = +Z).
 *
 * Overload notes:
 *   - `BRepBuilderAPI_MakeEdge_8(gp_Circ)` — closed-circle single-arg form
 *     (verified in `opencascade.full.d.ts`).
 */
export function makeCircleEdge(
  oc: OcctInstance,
  c: CircleParams,
  frame: SketchFrame = XY_FRAME,
): EdgeHandle {
  const c3 = frameTo3D(frame, c.cx, c.cy);
  const center = new oc.gp_Pnt_3(c3.x, c3.y, c3.z);
  const axisDir = new oc.gp_Dir_4(frame.n.x, frame.n.y, frame.n.z);
  const xDir = new oc.gp_Dir_4(frame.u.x, frame.u.y, frame.u.z);
  const ax2 = new oc.gp_Ax2_2(center, axisDir, xDir);
  const circ = new oc.gp_Circ_2(ax2, c.r);
  const mk = new oc.BRepBuilderAPI_MakeEdge_8(circ);
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
 * Builds a BSpline edge approximating the given XY control points via
 * `GeomAPI_PointsToBSpline`. Degree is clamped to at most `nbPoles - 1`
 * so a 2-CP input doesn't exceed the algorithm's degree bound.
 *
 * The `closed` flag is currently informational — closed splines would
 * need post-processing (periodic knot structure), which is deferred.
 *
 * Overload notes:
 *   - `TColgp_Array1OfPnt_2(lower=1, upper=N)` — 1-based indexing.
 *   - `GeomAPI_PointsToBSpline_2(pts, degMin, degMax, continuity, tol3D)` —
 *     5-arg form picks a clamped uniform knot vector through the CPs.
 *   - `GeomAbs_Shape.GeomAbs_C2` — C2 continuity enum (module-level).
 *   - `BRepBuilderAPI_MakeEdge_24(Handle_Geom_Curve)` requires the base
 *     curve handle. `approx.Curve()` returns a `Handle_Geom_BSplineCurve`
 *     (a subtype), which embind will NOT auto-upcast — passing it yields
 *     `BindingError: Expected null or instance of Handle_Geom_Curve, got
 *     an instance of Handle_Geom_BSplineCurve`. We unwrap via `.get()`
 *     (yielding the raw `Geom_BSplineCurve*`, which is-a `Geom_Curve`)
 *     and rewrap as a `Handle_Geom_Curve_2(thePtr)`.
 */
export function makeSplineEdge(
  oc: OcctInstance,
  s: SplineParams,
  frame: SketchFrame = XY_FRAME,
): EdgeHandle {
  if (s.controlPoints.length < 2) {
    throw new Error(
      `spline requires at least 2 control points, got ${s.controlPoints.length}`
    );
  }
  const nbPoles = s.controlPoints.length;
  const poles = new oc.TColgp_Array1OfPnt_2(1, nbPoles);
  const allocated: unknown[] = [];
  for (let i = 0; i < nbPoles; i++) {
    const cp = s.controlPoints[i]!;
    const cp3 = frameTo3D(frame, cp.x, cp.y);
    const p = new oc.gp_Pnt_3(cp3.x, cp3.y, cp3.z);
    poles.SetValue(i + 1, p);
    allocated.push(p);
  }
  const degree = Math.min(s.degree, nbPoles - 1) as 2 | 3;
  const approx = new oc.GeomAPI_PointsToBSpline_2(
    poles,
    degree,
    degree,
    oc.GeomAbs_Shape.GeomAbs_C2 as never,
    1e-3
  );
  const bsplineHandle = approx.Curve();
  const curveHandle = new oc.Handle_Geom_Curve_2(bsplineHandle.get() as never);
  const mk = new oc.BRepBuilderAPI_MakeEdge_24(curveHandle);
  const edge = mk.Edge();
  mk.delete();
  curveHandle.delete();
  bsplineHandle.delete();
  approx.delete();
  poles.delete();
  allocated.forEach((p) => (p as { delete?: () => void }).delete?.());
  return { __brand: 'EdgeHandle', edge };
}

/**
 * Builds four connected line edges forming a closed rectangle loop on
 * Z = 0 in CCW order: BL -> BR -> TR -> TL -> BL. Each edge's end point
 * equals the next edge's start point, so the result can be fed directly
 * into a wire builder.
 *
 * Unlike `makeRectangleWireXY`, this returns the raw edges (not a wire)
 * so callers can mix them with other edges before constructing a wire.
 */
export function makeRectangleEdges(
  oc: OcctInstance,
  r: RectangleParams,
  frame: SketchFrame = XY_FRAME,
): EdgeHandle[] {
  const corners: Point2[] = [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h }
  ];
  return [
    makeLineEdge(oc, corners[0]!, corners[1]!, frame),
    makeLineEdge(oc, corners[1]!, corners[2]!, frame),
    makeLineEdge(oc, corners[2]!, corners[3]!, frame),
    makeLineEdge(oc, corners[3]!, corners[0]!, frame)
  ];
}

export const SKETCH_TOLERANCE_MM = 1e-3;

export type CombinerResult = {
  closedWires: WireHandle[];
  openChains: Array<{ edges: EdgeHandle[]; start: Point2; end: Point2 }>;
};

function endpointsMatch(a: Point2, b: Point2, eps = SKETCH_TOLERANCE_MM): boolean {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;
}

type OpenSeed = { edge: EdgeHandle; start: Point2; end: Point2 };

export function combineEdgesIntoWires(oc: OcctInstance, edges: EdgeHandle[]): CombinerResult {
  const openSeeds: OpenSeed[] = edges.map((e) => {
    const { start, end } = edgeEndpoints(oc, e);
    return { edge: e, start, end };
  });

  const chains: OpenSeed[][] = [];
  const remaining = [...openSeeds];
  while (remaining.length > 0) {
    const first = remaining.shift()!;
    const chain: OpenSeed[] = [first];
    let extended = true;
    while (extended) {
      extended = false;
      for (let i = 0; i < remaining.length; i++) {
        const cand = remaining[i]!;
        const tailEnd = chain[chain.length - 1]!.end;
        const headStart = chain[0]!.start;
        if (endpointsMatch(tailEnd, cand.start)) {
          chain.push(cand);
          remaining.splice(i, 1);
          extended = true;
          break;
        }
        if (endpointsMatch(tailEnd, cand.end)) {
          chain.push({ edge: cand.edge, start: cand.end, end: cand.start });
          remaining.splice(i, 1);
          extended = true;
          break;
        }
        if (endpointsMatch(headStart, cand.end)) {
          chain.unshift(cand);
          remaining.splice(i, 1);
          extended = true;
          break;
        }
        if (endpointsMatch(headStart, cand.start)) {
          chain.unshift({ edge: cand.edge, start: cand.end, end: cand.start });
          remaining.splice(i, 1);
          extended = true;
          break;
        }
      }
    }
    chains.push(chain);
  }

  const closedWires: WireHandle[] = [];
  const openChains: CombinerResult['openChains'] = [];
  for (const chain of chains) {
    const head = chain[0]!.start;
    const tail = chain[chain.length - 1]!.end;
    if (endpointsMatch(head, tail)) {
      const mkWire = new oc.BRepBuilderAPI_MakeWire_1();
      for (const seg of chain) {
        mkWire.Add_1(seg.edge.edge as never);
      }
      const wire = mkWire.Wire();
      mkWire.delete();
      closedWires.push({ __brand: 'WireHandle', wire });
    } else {
      openChains.push({ edges: chain.map((c) => c.edge), start: head, end: tail });
    }
  }
  return { closedWires, openChains };
}
