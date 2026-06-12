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
 *
 * Memory discipline (B7 production-readiness fix):
 *   Every OCCT object allocated in this module is captured in a named local
 *   and `.delete()`d once it is no longer needed. This mirrors the pattern
 *   established in PanelOps.ts (lines 68-79).
 *
 *   Rules:
 *   - NEVER `.delete()` a shape that is RETURNED — the caller owns it.
 *   - NEVER `.delete()` the `body` or `origin`/`axis` parameters — callers own them.
 *   - Builders (MakeCylinder, MakeCone, Fuse, Cut), frames (gp_Ax2_3), points
 *     (gp_Pnt_3), and progress ranges (Message_ProgressRange_1) are all temporaries
 *     and MUST be deleted after use.
 *   - Intermediate compound shapes accumulated inside makeHole are deleted as
 *     soon as they are consumed by the next fuse operation.
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
 *               Caller owns this shape and must eventually delete it.
 */
export function makeSimpleCutter(
  oc: any,
  origin: any,   // gp_Pnt at the cutter top — caller-owned, NOT deleted here
  axis: any,     // gp_Dir pointing INTO the material — caller-owned, NOT deleted here
  opts: SimpleCutterOpts,
): any {
  const radius = opts.diameter / 2;

  // Build the cylinder — capture the builder so it can be deleted.
  const frame = new oc.gp_Ax2_3(origin, axis);
  const cylBuilder = new oc.BRepPrimAPI_MakeCylinder_3(frame, radius, opts.cylinderLength);
  const cyl = cylBuilder.Shape();
  cylBuilder.delete();
  frame.delete();

  if (opts.drillTipAngleDeg === null) {
    // Through-hole: return the cylinder directly. Do NOT delete cyl.
    return cyl;
  }

  // Blind hole: fuse cylinder with drill-tip cone.
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
  const coneBuilder = new oc.BRepPrimAPI_MakeCone_3(tipFrame, radius, 0, tipHeight);
  const cone = coneBuilder.Shape();
  coneBuilder.delete();
  tipFrame.delete();
  tipOrigin.delete();

  // Fuse cylinder + cone into a single cutter shape.
  const pr1 = new oc.Message_ProgressRange_1();
  const fuse = new oc.BRepAlgoAPI_Fuse_3(cyl, cone, pr1);
  const pr2 = new oc.Message_ProgressRange_1();
  fuse.Build(pr2);
  const result = fuse.Shape();
  pr2.delete();
  pr1.delete();
  fuse.delete();
  // cyl and cone are intermediate inputs — consumed by fuse; safe to delete.
  cyl.delete();
  cone.delete();

  // result is returned to caller — do NOT delete it.
  return result;
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
  origin: any,   // caller-owned gp_Pnt — NOT deleted here
  axis: any,     // caller-owned gp_Dir — NOT deleted here
  opts: CountersinkCutterOpts,
): any {
  const topRadius = opts.cskDiameter / 2;
  const bottomRadius = opts.diameter / 2;
  const halfAngleRad = (opts.cskAngleDeg / 2) * (Math.PI / 180);
  // Frustum height: Δr / tan(halfAngle)
  const cskHeight = (topRadius - bottomRadius) / Math.tan(halfAngleRad);

  // Build the countersink cone (frustum with R1 = topRadius at entry, R2 = bottomRadius at bottom).
  const cskFrame = new oc.gp_Ax2_3(origin, axis);
  const cskConeBuilder = new oc.BRepPrimAPI_MakeCone_3(cskFrame, topRadius, bottomRadius, cskHeight);
  const cskCone = cskConeBuilder.Shape();
  cskConeBuilder.delete();
  cskFrame.delete();

  // Build the shank cylinder starting at the bottom of the countersink.
  // shankTop is used briefly by makeSimpleCutter (accessed in origin.X()/Y()/Z() calls),
  // and can be deleted as soon as makeSimpleCutter returns.
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
  // makeSimpleCutter has finished with shankTop; safe to delete now.
  shankTop.delete();

  // Fuse countersink cone + shank.
  const pr1 = new oc.Message_ProgressRange_1();
  const fuse = new oc.BRepAlgoAPI_Fuse_3(cskCone, shank, pr1);
  const pr2 = new oc.Message_ProgressRange_1();
  fuse.Build(pr2);
  const result = fuse.Shape();
  pr2.delete();
  pr1.delete();
  fuse.delete();
  // cskCone and shank are consumed intermediates — safe to delete.
  cskCone.delete();
  shank.delete();

  return result;
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
  origin: any,   // caller-owned — NOT deleted here
  axis: any,     // caller-owned — NOT deleted here
  opts: CounterboreCutterOpts,
): any {
  // CBORE sits at top, shank cylinder below.
  const cboreFrame = new oc.gp_Ax2_3(origin, axis);
  const cboreRadius = opts.cboreDiameter / 2;
  const cboreBuilder = new oc.BRepPrimAPI_MakeCylinder_3(cboreFrame, cboreRadius, opts.cboreDepth);
  const cbore = cboreBuilder.Shape();
  cboreBuilder.delete();
  cboreFrame.delete();

  // Shank starts at the bottom of the counterbore pocket.
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
  shankTop.delete();

  // Fuse counterbore + shank.
  const pr1 = new oc.Message_ProgressRange_1();
  const fuse = new oc.BRepAlgoAPI_Fuse_3(cbore, shank, pr1);
  const pr2 = new oc.Message_ProgressRange_1();
  fuse.Build(pr2);
  const result = fuse.Shape();
  pr2.delete();
  pr1.delete();
  fuse.delete();
  cbore.delete();
  shank.delete();

  return result;
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
  body: any,    // caller-owned — NOT deleted here
  origin: any,  // caller-owned — NOT deleted here
  axis: any,    // caller-owned — NOT deleted here
): AxisCrossing[] {
  // gp_Lin_3 is a temporary; Init_2 copies the line data into the intersector.
  const line = new oc.gp_Lin_3(origin, axis);
  const intersector = new oc.BRepIntCurveSurface_Inter();
  intersector.Init_2(body, line, 1e-7);
  // line is no longer needed after Init_2.
  line.delete();

  const out: AxisCrossing[] = [];
  for (; intersector.More(); intersector.Next()) {
    const w = intersector.W();
    if (w < -1e-6) continue;
    out.push({
      distance: w,
      // intersector.Pnt() and .Face() return by-value handles that are independent
      // of the intersector's lifetime (gp_Pnt is a value type; TopoDS_Face is a
      // handle whose underlying topology is reference-counted by `body`).
      point: intersector.Pnt(),
      face: intersector.Face(),
    });
  }
  // intersector is done; the collected Pnt/Face values survive its deletion.
  intersector.delete();

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
  // lo and hi are gp_Pnt values returned by Bnd_Box — delete after use.
  lo.delete();
  hi.delete();
  bnd.delete();
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
  body: any,              // caller-owned — NOT deleted here
  locations: HoleLocation[],
  profile: ResolvedHoleProfile,
  termination: ResolvedHoleTermination,
): any {
  if (locations.length === 0) return body;

  // `compound` accumulates the union of all cutter shapes.
  // Ownership transfers on each fuse: the previous compound is consumed and
  // must be deleted after the fuse produces a new one.
  let compound: any = null;

  for (const loc of locations) {
    const { length, blind } = resolveLength(oc, body, loc, termination);
    const cutter = buildCutter(oc, loc, profile, length, blind);

    if (compound === null) {
      // First location: cutter IS the compound — no fuse yet.
      compound = cutter;
    } else {
      // Fuse existing compound with the new cutter.
      // After Build(), `compound` and `cutter` are consumed; the new compound
      // is a fresh shape produced by the fuse. Delete both inputs after.
      const prevCompound = compound;
      const pr1 = new oc.Message_ProgressRange_1();
      const fuse = new oc.BRepAlgoAPI_Fuse_3(prevCompound, cutter, pr1);
      const pr2 = new oc.Message_ProgressRange_1();
      fuse.Build(pr2);
      compound = fuse.Shape();
      pr2.delete();
      pr1.delete();
      fuse.delete();
      // prevCompound and cutter are now consumed intermediates — delete them.
      prevCompound.delete();
      cutter.delete();
    }
  }

  // Subtract the accumulated cutter compound from the body.
  // `compound` is a temporary — delete after cut.
  // `body` is caller-owned — do NOT delete.
  const pr1 = new oc.Message_ProgressRange_1();
  const cut = new oc.BRepAlgoAPI_Cut_3(body, compound, pr1);
  const pr2 = new oc.Message_ProgressRange_1();
  cut.Build(pr2);
  const result = cut.Shape();
  pr2.delete();
  pr1.delete();
  cut.delete();
  compound.delete();

  // result is the bored solid — return to caller; do NOT delete.
  return result;
}
