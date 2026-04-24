/**
 * HoleOps — low-level OCCT cutter geometry for hole features.
 *
 * Each exported function returns a raw OCCT TopoDS_Shape (no Result wrapper)
 * because callers (HoleAdapter, BooleanOps) always own error handling. The
 * shapes produced here are intended to be subtracted from a solid via
 * BRepAlgoAPI_Cut.
 *
 * Overload notes (verified against opencascade.full.d.ts):
 *   - `gp_Pnt_3(x, y, z)`          — 3-arg point constructor.
 *   - `gp_Dir_4(x, y, z)`          — direction from components.
 *   - `gp_Ax2_3(origin, direction)` — right-handed frame (N axis = direction).
 *   - `BRepPrimAPI_MakeCylinder_3(frame, radius, height)` — axis-based cylinder.
 *   - `BRepPrimAPI_MakeCone_3(frame, R1, R2, H)` — frustum; R1 at base, R2 at top.
 *   - `BRepAlgoAPI_Fuse_3(s1, s2, progressRange)` — requires progress range.
 *   - `Message_ProgressRange_1()` — default (no-op) progress range.
 */

export type SimpleCutterOpts = {
  diameter: number;
  cylinderLength: number;
  /**
   * null  = through hole (no drill tip appended).
   * number = blind hole — the full included drill-point angle in degrees
   *          (e.g. 118 for a standard twist drill). A cone is fused below
   *          the cylinder to represent the drill-point cavity.
   */
  drillTipAngleDeg: number | null;
};

/**
 * Build a simple-hole cutter shape: a cylinder optionally fused with a
 * drill-tip cone for blind holes.
 *
 * @param oc     - OpenCascade WASM instance.
 * @param origin - Top of the cutter (entry point at the workpiece surface).
 * @param axis   - Direction pointing INTO the material (the cylinder grows
 *                 along this direction from `origin`).
 * @param opts   - Diameter, depth, and optional drill-tip angle.
 * @returns      Raw TopoDS_Shape (compound or solid) to subtract from a solid.
 */
export function makeSimpleCutter(
  oc: any,
  origin: any,   // gp_Pnt at the cutter top
  axis: any,     // gp_Dir pointing INTO the material
  opts: SimpleCutterOpts,
): any {
  const radius = opts.diameter / 2;

  const frame = new oc.gp_Ax2_3(origin, axis);
  const cyl = new oc.BRepPrimAPI_MakeCylinder_3(frame, radius, opts.cylinderLength).Shape();

  if (opts.drillTipAngleDeg === null) {
    return cyl;
  }

  // Drill tip: cone whose base (R1 = radius) sits flush with the cylinder
  // bottom, and whose apex (R2 = 0) points further into the material.
  const halfAngleRad = (opts.drillTipAngleDeg / 2) * (Math.PI / 180);
  const tipHeight = radius / Math.tan(halfAngleRad);

  // Translate the cone origin to the bottom of the cylinder along `axis`.
  const tipOrigin = new oc.gp_Pnt_3(
    origin.X() + axis.X() * opts.cylinderLength,
    origin.Y() + axis.Y() * opts.cylinderLength,
    origin.Z() + axis.Z() * opts.cylinderLength,
  );
  const tipFrame = new oc.gp_Ax2_3(tipOrigin, axis);
  // BRepPrimAPI_MakeCone_3(frame, R1, R2, H): R1 at base, R2 at top (apex).
  const cone = new oc.BRepPrimAPI_MakeCone_3(tipFrame, radius, 0, tipHeight).Shape();

  const fuse = new oc.BRepAlgoAPI_Fuse_3(cyl, cone, new oc.Message_ProgressRange_1());
  fuse.Build(new oc.Message_ProgressRange_1());
  return fuse.Shape();
}

export type CountersinkCutterOpts = {
  diameter: number;
  cylinderLength: number;
  cskDiameter: number;
  /** full included angle, e.g. 82 (wood screw) */
  cskAngleDeg: number;
  drillTipAngleDeg: number | null;
};

export function makeCountersinkCutter(
  oc: any,
  origin: any,
  axis: any,
  opts: CountersinkCutterOpts,
): any {
  const topRadius = opts.cskDiameter / 2;
  const bottomRadius = opts.diameter / 2;
  const halfAngleRad = (opts.cskAngleDeg / 2) * (Math.PI / 180);
  // Frustum height: Δr / tan(halfAngle)
  const cskHeight = (topRadius - bottomRadius) / Math.tan(halfAngleRad);

  const cskFrame = new oc.gp_Ax2_3(origin, axis);
  const cskCone = new oc.BRepPrimAPI_MakeCone_3(cskFrame, topRadius, bottomRadius, cskHeight).Shape();

  const shankTop = new oc.gp_Pnt_3(
    origin.X() + axis.X() * cskHeight,
    origin.Y() + axis.Y() * cskHeight,
    origin.Z() + axis.Z() * cskHeight,
  );
  const shank = makeSimpleCutter(oc, shankTop, axis, {
    diameter: opts.diameter,
    cylinderLength: opts.cylinderLength,
    drillTipAngleDeg: opts.drillTipAngleDeg,
  });

  const fuse = new oc.BRepAlgoAPI_Fuse_3(cskCone, shank, new oc.Message_ProgressRange_1());
  fuse.Build(new oc.Message_ProgressRange_1());
  return fuse.Shape();
}

export type CounterboreCutterOpts = {
  diameter: number;
  cylinderLength: number;
  cboreDiameter: number;
  cboreDepth: number;
  drillTipAngleDeg: number | null;
};

export function makeCounterboreCutter(
  oc: any,
  origin: any,
  axis: any,
  opts: CounterboreCutterOpts,
): any {
  // CBORE sits at top, shank cylinder below.
  const cboreFrame = new oc.gp_Ax2_3(origin, axis);
  const cboreRadius = opts.cboreDiameter / 2;
  const cbore = new oc.BRepPrimAPI_MakeCylinder_3(cboreFrame, cboreRadius, opts.cboreDepth).Shape();

  const shankTop = new oc.gp_Pnt_3(
    origin.X() + axis.X() * opts.cboreDepth,
    origin.Y() + axis.Y() * opts.cboreDepth,
    origin.Z() + axis.Z() * opts.cboreDepth,
  );
  const shank = makeSimpleCutter(oc, shankTop, axis, {
    diameter: opts.diameter,
    cylinderLength: opts.cylinderLength,
    drillTipAngleDeg: opts.drillTipAngleDeg,
  });

  const fuse = new oc.BRepAlgoAPI_Fuse_3(cbore, shank, new oc.Message_ProgressRange_1());
  fuse.Build(new oc.Message_ProgressRange_1());
  return fuse.Shape();
}

export type AxisCrossing = {
  /** signed distance along axis from origin (always >= 0 in returned list) */
  distance: number;
  point: any;  // gp_Pnt
  face: any;   // TopoDS_Face
};

/**
 * Intersect the half-line {origin + t·axis : t >= 0} with every face on `body`.
 * Returns crossings sorted ascending by `distance`. Crossings behind the origin
 * (negative `t`) are filtered out.
 *
 * Uses `BRepIntCurveSurface_Inter` with an infinite line; we keep only forward hits.
 *
 * Overload notes:
 *   - `gp_Lin_3(origin, axis)` — line through a point with a direction (gp_Lin subclass).
 *   - `BRepIntCurveSurface_Inter.Init_2(shape, line: gp_Lin, tol)` — line-vs-shape init.
 */
export function axisSolidCrossings(
  oc: any,
  body: any,
  origin: any,
  axis: any,
): AxisCrossing[] {
  const line = new oc.gp_Lin_3(origin, axis);
  const intersector = new oc.BRepIntCurveSurface_Inter();
  intersector.Init_2(body, line, 1e-7);

  const out: AxisCrossing[] = [];
  for (; intersector.More(); intersector.Next()) {
    const w = intersector.W();
    if (w < -1e-6) continue;
    out.push({
      distance: w,
      point: intersector.Pnt(),
      face: intersector.Face(),
    });
  }
  out.sort((a, b) => a.distance - b.distance);
  return out;
}

export type ResolvedHoleProfile =
  | { kind: 'simple'; diameter: number }
  | { kind: 'counterbore'; diameter: number; cboreDiameter: number; cboreDepth: number }
  | { kind: 'countersink'; diameter: number; cskDiameter: number; cskAngleDeg: number };

export type ResolvedHoleTermination =
  | { kind: 'distance'; depth: number; blindTip: boolean }
  | { kind: 'throughAll' }
  | { kind: 'toNext' };
  // Note: toFace is resolved by the adapter into a `distance` with blindTip=false before
  // reaching makeHole — see HoleFeature.ts (Task 14).

export type HoleLocation = { origin: any; axis: any };

const DRILL_TIP_ANGLE_DEG = 118;

function boundingDiagonal(oc: any, body: any): number {
  const bnd = new oc.Bnd_Box_1();
  oc.BRepBndLib.Add(body, bnd, false);
  const lo = bnd.CornerMin();
  const hi = bnd.CornerMax();
  const dx = hi.X() - lo.X();
  const dy = hi.Y() - lo.Y();
  const dz = hi.Z() - lo.Z();
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function resolveLength(
  oc: any,
  body: any,
  loc: HoleLocation,
  termination: ResolvedHoleTermination,
): { length: number; blind: boolean } {
  if (termination.kind === 'distance') return { length: termination.depth, blind: termination.blindTip };
  if (termination.kind === 'throughAll') return { length: 2 * boundingDiagonal(oc, body), blind: false };
  // toNext
  const crossings = axisSolidCrossings(oc, body, loc.origin, loc.axis);
  if (crossings.length < 2) throw new Error('toNext: no next face found');
  return { length: crossings[1]!.distance, blind: false };
}

function buildCutter(
  oc: any,
  loc: HoleLocation,
  profile: ResolvedHoleProfile,
  length: number,
  blind: boolean,
): any {
  const tipAngle = blind ? DRILL_TIP_ANGLE_DEG : null;
  if (profile.kind === 'simple') {
    return makeSimpleCutter(oc, loc.origin, loc.axis, {
      diameter: profile.diameter,
      cylinderLength: length,
      drillTipAngleDeg: tipAngle,
    });
  }
  if (profile.kind === 'counterbore') {
    return makeCounterboreCutter(oc, loc.origin, loc.axis, {
      diameter: profile.diameter,
      cylinderLength: length,
      cboreDiameter: profile.cboreDiameter,
      cboreDepth: profile.cboreDepth,
      drillTipAngleDeg: tipAngle,
    });
  }
  return makeCountersinkCutter(oc, loc.origin, loc.axis, {
    diameter: profile.diameter,
    cylinderLength: length,
    cskDiameter: profile.cskDiameter,
    cskAngleDeg: profile.cskAngleDeg,
    drillTipAngleDeg: tipAngle,
  });
}

export function makeHole(
  oc: any,
  body: any,
  locations: HoleLocation[],
  profile: ResolvedHoleProfile,
  termination: ResolvedHoleTermination,
): any {
  if (locations.length === 0) return body;

  let compound: any | null = null;
  for (const loc of locations) {
    const { length, blind } = resolveLength(oc, body, loc, termination);
    const cutter = buildCutter(oc, loc, profile, length, blind);
    if (compound === null) {
      compound = cutter;
    } else {
      const fuse = new oc.BRepAlgoAPI_Fuse_3(compound, cutter, new oc.Message_ProgressRange_1());
      fuse.Build(new oc.Message_ProgressRange_1());
      compound = fuse.Shape();
    }
  }

  const cut = new oc.BRepAlgoAPI_Cut_3(body, compound, new oc.Message_ProgressRange_1());
  cut.Build(new oc.Message_ProgressRange_1());
  return cut.Shape();
}
