import type { OcctInstance } from '../../occt/occtLoader';
import type { OcctShape } from '../../occt/SolidOps';
import {
  type NamedShape,
  attachName,
  tagHoleFaces,
  faceNamesEqual,
  resolveEdge,
  mergeFaceNames,
} from '../../occt/FaceNaming';
import {
  makeHole,
  axisSolidCrossings,
  type HoleLocation,
  type ResolvedHoleProfile,
  type ResolvedHoleTermination,
} from '../../occt/HoleOps';
import type {
  Feature,
  HoleFeature,
  HolePlacement,
  HoleProfile,
  HoleTermination,
  ParamOrLiteral,
  FaceName,
} from '@zilventor/shared';
import { originPlaneLiteralOf, face2DFrame } from '@zilventor/shared';

type Vec3 = { x: number; y: number; z: number };

function scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}
function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function neg(v: Vec3): Vec3 {
  return { x: -v.x, y: -v.y, z: -v.z };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function normalize(v: Vec3): Vec3 {
  const L = Math.sqrt(dot(v, v));
  return { x: v.x / L, y: v.y / L, z: v.z / L };
}

function findFaceByName(runningBody: NamedShape, name: FaceName): unknown | null {
  return runningBody.faceNames.find((e) => faceNamesEqual(e.name, name))?.face ?? null;
}

function facePlaneNormal(oc: OcctInstance, face: unknown): { origin: Vec3; normal: Vec3 } {
  const typedFace = (oc as any).TopoDS.Face_1(face);
  const adaptor = new (oc as any).BRepAdaptor_Surface_2(typedFace, true);
  const pln = adaptor.Plane();
  const loc = pln.Location();
  const dir = pln.Axis().Direction();
  const result = {
    origin: { x: loc.X(), y: loc.Y(), z: loc.Z() },
    normal: { x: dir.X(), y: dir.Y(), z: dir.Z() },
  };
  adaptor.delete?.();
  return result;
}

function edgeLine(oc: OcctInstance, edge: unknown): { origin: Vec3; direction: Vec3 } {
  const typedEdge = (oc as any).TopoDS.Edge_1(edge);
  const adaptor = new (oc as any).BRepAdaptor_Curve_2(typedEdge);
  const t0 = adaptor.FirstParameter();
  const t1 = adaptor.LastParameter();
  const p0 = adaptor.Value(t0);
  const p1 = adaptor.Value(t1);
  const result = {
    origin: { x: p0.X(), y: p0.Y(), z: p0.Z() },
    direction: normalize({ x: p1.X() - p0.X(), y: p1.Y() - p0.Y(), z: p1.Z() - p0.Z() }),
  };
  adaptor.delete?.();
  return result;
}

function resolveLinearLocation(
  oc: OcctInstance,
  runningBody: NamedShape,
  placement: Extract<HolePlacement, { kind: 'linear' }>,
  offset1: number,
  offset2: number,
  flipAxis: boolean,
): HoleLocation {
  const faceRaw = findFaceByName(runningBody, placement.faceName);
  if (!faceRaw) throw new Error(`linear: face ${placement.faceName.role} not found`);
  const face = (oc as any).TopoDS.Face_1(faceRaw);
  const e1 = resolveEdge(oc, runningBody, placement.refEdge1);
  const e2 = resolveEdge(oc, runningBody, placement.refEdge2);
  if (!e1 || !e2) throw new Error('linear: reference edge not found');

  const { normal } = facePlaneNormal(oc, face);
  const l1 = edgeLine(oc, e1);
  const l2 = edgeLine(oc, e2);

  // Compute face centroid — used to orient perp vectors toward the interior.
  const faceProps = new (oc as any).GProp_GProps_1();
  (oc as any).BRepGProp.SurfaceProperties_1(face, faceProps, 1e-7, false);
  const centroid = faceProps.CentreOfMass();
  const faceCentroid: Vec3 = { x: centroid.X(), y: centroid.Y(), z: centroid.Z() };

  // Perpendicular within face plane to each edge.
  // Orient each perp so it points from the edge toward the face centroid (interior).
  function orientedPerp(edgeLine: { origin: Vec3; direction: Vec3 }): Vec3 {
    const raw = normalize(cross(edgeLine.direction, normal));
    const toCenter: Vec3 = {
      x: faceCentroid.x - edgeLine.origin.x,
      y: faceCentroid.y - edgeLine.origin.y,
      z: faceCentroid.z - edgeLine.origin.z,
    };
    return dot(raw, toCenter) >= 0 ? raw : neg(raw);
  }

  const perp1 = orientedPerp(l1);
  const perp2 = orientedPerp(l2);

  // Solve for P on l1's line offset by offset1 along perp1, and at distance
  // offset2 from l2 along perp2:
  //   P = l1.origin + offset1 * perp1 + t * l1.direction
  //   (P - l2.origin) · perp2 = offset2
  const u = l1.direction;
  const baseP: Vec3 = add(l1.origin, scale(perp1, offset1));
  const fromL2: Vec3 = { x: baseP.x - l2.origin.x, y: baseP.y - l2.origin.y, z: baseP.z - l2.origin.z };
  const denom = dot(u, perp2);
  if (Math.abs(denom) < 1e-9) throw new Error('linear: reference edges are parallel');
  const t = (offset2 - dot(fromL2, perp2)) / denom;
  const P = add(baseP, scale(u, t));

  const origin = new (oc as any).gp_Pnt_3(P.x, P.y, P.z);
  // Face normal points outward; negate so axis points INTO the material.
  // flipAxis=true reverses (drill from inside out).
  const axisVec = flipAxis ? normal : neg(normal);
  const axis = new (oc as any).gp_Dir_4(axisVec.x, axisVec.y, axisVec.z);
  return { origin, axis };
}

function sketchPlaneFrame(plane: 'XY' | 'XZ' | 'YZ'): { u: Vec3; v: Vec3; n: Vec3 } {
  if (plane === 'XY') return { u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 1, z: 0 }, n: { x: 0, y: 0, z: 1 } };
  if (plane === 'XZ') return { u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 0, z: 1 }, n: { x: 0, y: 1, z: 0 } };
  return { u: { x: 0, y: 1, z: 0 }, v: { x: 0, y: 0, z: 1 }, n: { x: 1, y: 0, z: 0 } };
}

function resolveProfile(p: HoleProfile, resolve: (v: ParamOrLiteral) => number): ResolvedHoleProfile {
  if (p.kind === 'simple') return { kind: 'simple', diameter: resolve(p.diameter) };
  if (p.kind === 'counterbore') return {
    kind: 'counterbore',
    diameter: resolve(p.diameter),
    cboreDiameter: resolve(p.cboreDiameter),
    cboreDepth: resolve(p.cboreDepth),
  };
  return {
    kind: 'countersink',
    diameter: resolve(p.diameter),
    cskDiameter: resolve(p.cskDiameter),
    cskAngleDeg: resolve(p.cskAngle),
  };
}

/**
 * Walk axis-ray crossings against the body and return the distance to the first crossing
 * on a face that matches the target FaceName. Throws if no matching crossing exists.
 *
 * Exported for kernel-level testing of the toFace termination path.
 */
export function resolveToFaceLength(
  oc: OcctInstance,
  body: unknown,
  faceNames: Array<{ name: FaceName; face: unknown }>,
  targetFaceName: FaceName,
  origin: unknown,
  axis: unknown,
): number {
  const crossings = axisSolidCrossings(oc as any, body as any, origin as any, axis as any);
  for (const crossing of crossings) {
    for (const entry of faceNames) {
      const isSame = (entry.face as { IsSame?: (o: unknown) => boolean }).IsSame?.(crossing.face);
      if (!isSame) continue;
      if (faceNamesEqual(entry.name, targetFaceName)) {
        return crossing.distance;
      }
    }
  }
  throw new Error(`toFace: target face ${targetFaceName.role} not reached by axis`);
}

function resolveTermination(
  oc: OcctInstance,
  body: unknown,
  faceNames: Array<{ name: FaceName; face: unknown }>,
  t: HoleTermination,
  loc: HoleLocation,
  resolve: (v: ParamOrLiteral) => number,
): ResolvedHoleTermination {
  if (t.kind === 'distance') return { kind: 'distance', depth: resolve(t.depth), blindTip: true };
  if (t.kind === 'throughAll') return { kind: 'throughAll' };
  if (t.kind === 'toNext') return { kind: 'toNext' };
  // toFace: translate to a distance with no drill tip
  const length = resolveToFaceLength(oc, body, faceNames, t.targetFaceName, loc.origin, loc.axis);
  return { kind: 'distance', depth: length, blindTip: false };
}

function resolveFromSketchLocations(
  oc: OcctInstance,
  sketch: Extract<Feature, { kind: 'sketch' }>,
  flipAxis: boolean,
): HoleLocation[] {
  const planeLit = originPlaneLiteralOf(sketch.plane);
  if (planeLit === null) {
    throw new Error(`Hole on non-origin plane not yet supported: ${JSON.stringify(sketch.plane)}`);
  }
  const frame = sketchPlaneFrame(planeLit);
  const axisVec = flipAxis ? neg(frame.n) : frame.n;
  const locations: HoleLocation[] = [];
  for (const prim of sketch.primitives) {
    if ((prim as { kind: string }).kind !== 'circle') continue;
    const c = prim as unknown as { cx: number; cy: number };
    const p3 = add(scale(frame.u, c.cx), scale(frame.v, c.cy));
    const origin = new (oc as any).gp_Pnt_3(p3.x, p3.y, p3.z);
    const axis = new (oc as any).gp_Dir_4(axisVec.x, axisVec.y, axisVec.z);
    locations.push({ origin, axis });
  }
  return locations;
}

function resolveConcentricLocation(
  oc: OcctInstance,
  runningBody: NamedShape,
  placement: Extract<HolePlacement, { kind: 'concentric' }>,
  flipAxis: boolean,
): HoleLocation {
  const face = findFaceByName(runningBody, placement.faceName);
  if (!face) throw new Error('concentric: face not found');
  const rawEdge = resolveEdge(oc, runningBody, placement.circularEdgeName);
  if (!rawEdge) throw new Error('concentric: circular edge not found');
  const edge = (oc as any).TopoDS.Edge_1(rawEdge);

  const adaptor = new (oc as any).BRepAdaptor_Curve_2(edge);
  const curveType = adaptor.GetType();
  // oc.GeomAbs_CurveType is an object with enum-value properties, matching the pattern
  // used elsewhere (GeomAbs_JoinType, GeomAbs_SurfaceType, GeomAbs_Shape).
  const expectedCircle = (oc as any).GeomAbs_CurveType.GeomAbs_Circle;
  if (curveType !== expectedCircle) {
    adaptor.delete?.();
    throw new Error('concentric: picked edge is not a circle');
  }
  const circle = adaptor.Circle();
  const center = circle.Location();
  const circleAxis = circle.Axis().Direction();
  adaptor.delete?.();

  // Use the face normal (outward) to pin the circle-axis sign, then negate to point inward.
  // flipAxis inverts again (drill from inside out).
  const { normal: faceNormal } = facePlaneNormal(oc, face);
  const circleVec: Vec3 = { x: circleAxis.X(), y: circleAxis.Y(), z: circleAxis.Z() };
  // Align circleVec with faceNormal for a deterministic sign, then negate to point inward.
  const aligned = dot(circleVec, faceNormal) >= 0 ? circleVec : neg(circleVec);
  const inward = neg(aligned);
  const axisVec = flipAxis ? neg(inward) : inward;

  const origin = new (oc as any).gp_Pnt_3(center.X(), center.Y(), center.Z());
  const axis = new (oc as any).gp_Dir_4(axisVec.x, axisVec.y, axisVec.z);
  return { origin, axis };
}

/**
 * Map each (u,v) on a named panel face to a HoleLocation using the face's plane
 * normal (outward) + the panel-local 2D frame from face2DFrame (shared). The axis
 * points INTO the material (negated outward normal), matching resolveLinearLocation.
 * The (u,v)→3D point uses face2DFrame so the kernel and the marker/DXF code agree.
 */
export function resolveAtFaceLocations(
  oc: OcctInstance,
  runningBody: NamedShape,
  placement: Extract<HolePlacement, { kind: 'atFace' }>,
  panelDims: { length: number; width: number; thickness: number },
  flipAxis: boolean,
): HoleLocation[] {
  const faceRaw = findFaceByName(runningBody, placement.faceName);
  if (!faceRaw) throw new Error(`atFace: face ${placement.faceName.role} not found`);
  const { normal } = facePlaneNormal(oc, faceRaw);
  // Outward face normal → negate so the drill axis points INTO the material.
  // flipAxis reverses (drill from inside out), matching resolveLinearLocation.
  const axisVec = flipAxis ? normal : neg(normal);

  // (u,v) → panel-local 3D point via the SAME frame the markers/DXF use.
  const role = placement.faceName.role as 'Top' | 'Bottom' | 'Front' | 'Back' | 'Left' | 'Right';
  const frame = face2DFrame(panelDims, role);

  const locations: HoleLocation[] = [];
  for (const { u, v } of placement.points) {
    const P: Vec3 = add(frame.origin, add(scale(frame.uDir, u), scale(frame.vDir, v)));
    const origin = new (oc as any).gp_Pnt_3(P.x, P.y, P.z);
    const axis = new (oc as any).gp_Dir_4(axisVec.x, axisVec.y, axisVec.z);
    locations.push({ origin, axis });
  }
  return locations;
}

function panelDimsFromBody(oc: OcctInstance, body: unknown): { length: number; width: number; thickness: number } {
  const bnd = new (oc as any).Bnd_Box_1();
  (oc as any).BRepBndLib.Add(body, bnd, false);
  const lo = bnd.CornerMin();
  const hi = bnd.CornerMax();
  return {
    length: hi.X() - lo.X(),
    width: hi.Y() - lo.Y(),
    thickness: hi.Z() - lo.Z(),
  };
}

/**
 * Execute a hole feature against a running body.
 *
 * Task 10 scope: fromSketch placement + simple/cbore/csk profiles + distance/throughAll/toNext
 * terminations. linear (Task 12), concentric (Task 13), and toFace (Task 14) throw.
 *
 * Caller (FeatureTree.executeTree, Task 17) wraps in try/catch for soft-fail.
 */
export function executeHoleFeature(
  oc: OcctInstance,
  runningBody: NamedShape,
  feature: HoleFeature,
  resolveParam: (p: ParamOrLiteral) => number,
  sketchById: Map<string, Feature>,
): NamedShape {
  let locations: HoleLocation[];
  if (feature.placement.kind === 'fromSketch') {
    const sketch = sketchById.get(feature.placement.sketchId);
    if (!sketch || sketch.kind !== 'sketch') {
      throw new Error(`hole: sketch ${feature.placement.sketchId} not found`);
    }
    locations = resolveFromSketchLocations(oc, sketch, feature.flipAxis);
  } else if (feature.placement.kind === 'linear') {
    locations = [resolveLinearLocation(
      oc, runningBody, feature.placement,
      resolveParam(feature.placement.offset1),
      resolveParam(feature.placement.offset2),
      feature.flipAxis,
    )];
  } else if (feature.placement.kind === 'concentric') {
    locations = [resolveConcentricLocation(oc, runningBody, feature.placement, feature.flipAxis)];
  } else if (feature.placement.kind === 'atFace') {
    const dims = panelDimsFromBody(oc, runningBody.shape);
    locations = resolveAtFaceLocations(oc, runningBody, feature.placement, dims, feature.flipAxis);
  } else {
    throw new Error(`hole: placement ${(feature.placement as { kind: string }).kind} not implemented`);
  }

  const profile = resolveProfile(feature.profile, resolveParam);

  // Per-location loop: each location resolves its own termination (required for toFace,
  // which can yield a different depth per location depending on origin).
  let runningShape: unknown = runningBody.shape;
  const newNamesAccum = new Map<unknown, FaceName>();
  for (let i = 0; i < locations.length; i++) {
    const loc = locations[i]!;
    const term = resolveTermination(
      oc, runningShape, runningBody.faceNames,
      feature.termination, loc, resolveParam,
    );
    runningShape = makeHole(oc as any, runningShape as any, [loc], profile, term);
    const blind = term.kind === 'distance' && term.blindTip;
    const tagged = tagHoleFaces(oc, runningShape as any, feature.id, i, feature.profile.kind, blind);
    for (const [face, name] of tagged) newNamesAccum.set(face, name);
  }

  // Refresh face handles: BRepAlgoAPI_Cut inside makeHole() produces a new
  // shape whose surviving planar faces (e.g. box top/bottom) get fresh OCCT
  // topology handles that no longer IsSame-match the pre-cut handles stored in
  // runningBody.faceNames.  mergeFaceNames walks the result shape, re-matches
  // each face against the pre-hole body via IsSame, and assigns a fallback
  // name to unmatched (new-hole) faces.  We then override those fallback
  // entries with the more-specific names assigned by tagHoleFaces.
  //
  // Note: runningShape is a raw OCCT handle — FeatureTree.ts unwraps the
  // OcctShape wrapper before calling executeHoleFeature (lines ~657-661) and
  // rewraps the returned .shape afterwards (line ~677-679).  We must wrap the
  // raw handle temporarily so mergeFaceNames can call TopExp.MapShapes_1, then
  // restore the raw handle in the returned NamedShape so FeatureTree's rewrap
  // step remains correct.
  const tempOcctShape: OcctShape = { __brand: 'OcctShape', handle: runningShape };
  const named = mergeFaceNames(oc, tempOcctShape, runningBody, null, feature.id);
  // Restore the raw handle (FeatureTree.ts rewraps it into OcctShape).
  named.shape = runningShape as any;
  // tagHoleFaces entries take priority over any opResult/N fallback names.
  for (const [face, name] of newNamesAccum) {
    const existingIdx = named.faceNames.findIndex((e) =>
      (face as { IsSame?: (o: unknown) => boolean }).IsSame?.(e.face as never)
    );
    if (existingIdx >= 0) {
      named.faceNames[existingIdx] = { face, name };
    } else {
      attachName(named, face, name);
    }
  }
  return named;
}
