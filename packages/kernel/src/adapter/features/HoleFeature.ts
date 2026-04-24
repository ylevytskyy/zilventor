import type { OcctInstance } from '../../occt/occtLoader';
import {
  type NamedShape,
  attachName,
  tagHoleFaces,
  faceNamesEqual,
  resolveEdge,
} from '../../occt/FaceNaming';
import {
  makeHole,
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

function resolveTermination(
  t: HoleTermination,
  resolve: (v: ParamOrLiteral) => number,
): ResolvedHoleTermination | null {
  if (t.kind === 'distance') return { kind: 'distance', depth: resolve(t.depth), blindTip: true };
  if (t.kind === 'throughAll') return { kind: 'throughAll' };
  if (t.kind === 'toNext') return { kind: 'toNext' };
  return null;  // toFace — implemented in Task 14
}

function resolveFromSketchLocations(
  oc: OcctInstance,
  sketch: Extract<Feature, { kind: 'sketch' }>,
  flipAxis: boolean,
): HoleLocation[] {
  const frame = sketchPlaneFrame(sketch.plane as 'XY' | 'XZ' | 'YZ');
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
  } else {
    throw new Error(`hole: placement ${(feature.placement as { kind: string }).kind} not implemented`);
  }

  const profile = resolveProfile(feature.profile, resolveParam);
  const termination = resolveTermination(feature.termination, resolveParam);
  if (termination === null) throw new Error('hole: toFace termination not yet implemented');

  const cutShape = makeHole(oc as any, runningBody.shape as any, locations, profile, termination);

  const blind = termination.kind === 'distance';
  const newNames = tagHoleFaces(oc, cutShape, feature.id, 0, feature.profile.kind, blind);

  const named: NamedShape = { shape: cutShape as any, faceNames: [...runningBody.faceNames] };
  for (const [face, name] of newNames) {
    attachName(named, face, name);
  }
  return named;
}
