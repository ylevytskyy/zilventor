import type { OcctInstance } from '../occt/occtLoader';
import type { Plane } from './cutBySectionPlane';
import type { Vec3 } from '@zilventor/shared';

const PARALLEL_TOL = 1e-4; // mm
const POINT_ON_PLANE_TOL = 1e-4; // mm

/**
 * Hash a face by its surface centroid rounded to 1e-3 mm.
 * Cheap deterministic key — not cryptographic, but collision-free for
 * non-coincident faces in normal CAD geometry.
 */
export function hashFace(oc: OcctInstance, face: unknown): string {
  const props = new oc.GProp_GProps_1();
  try {
    oc.BRepGProp.SurfaceProperties_1(face as never, props, false as never, false as never);
    const c = props.CentreOfMass();
    const x = Math.round(c.X() * 1e3) / 1e3;
    const y = Math.round(c.Y() * 1e3) / 1e3;
    const z = Math.round(c.Z() * 1e3) / 1e3;
    return `${x}:${y}:${z}`;
  } catch {
    return 'unknown';
  } finally {
    (props as unknown as { delete(): void }).delete();
  }
}

/**
 * Classify a face as 'cut-face' if it is planar AND lies on the section plane
 * (normal parallel within PARALLEL_TOL and a sample point within POINT_ON_PLANE_TOL).
 * Otherwise 'original-face'.
 */
export function classifyFace(
  oc: OcctInstance,
  face: unknown,
  sectionPlane: Plane
): 'cut-face' | 'original-face' {
  // TopExp_Explorer.Current() returns TopoDS_Shape; BRepAdaptor_Surface_2 needs TopoDS_Face.
  // Downcast via oc.TopoDS.Face_1(shape).
  const faceTyped = oc.TopoDS.Face_1(face as never);
  const adaptor = new oc.BRepAdaptor_Surface_2(faceTyped as never, false as never);
  // GetType() returns a GeomAbs_SurfaceType embind enum object with a .value property.
  // GeomAbs_Plane = 0 in C++ OCCT enum.
  const geomType = (adaptor as unknown as { GetType(): { value: number } }).GetType();
  if (geomType.value !== 0) {
    (adaptor as unknown as { delete(): void }).delete();
    return 'original-face';
  }
  const gplnHandle = (adaptor as unknown as { Plane(): unknown }).Plane();
  const gpln = (gplnHandle as unknown as { Axis(): unknown }).Axis();
  const dir  = (gpln as unknown as { Direction(): unknown }).Direction();
  const faceNx = (dir as unknown as { X(): number }).X();
  const faceNy = (dir as unknown as { Y(): number }).Y();
  const faceNz = (dir as unknown as { Z(): number }).Z();
  (adaptor as unknown as { delete(): void }).delete();

  const { normal: sn, origin: so } = sectionPlane;
  const len = Math.sqrt(sn.x * sn.x + sn.y * sn.y + sn.z * sn.z) || 1;
  const dot = Math.abs(faceNx * (sn.x / len) + faceNy * (sn.y / len) + faceNz * (sn.z / len));
  if (Math.abs(dot - 1) > PARALLEL_TOL) return 'original-face';

  // point-on-plane: signed distance from sectionPlane
  const locPt = (gpln as unknown as { Location(): unknown }).Location();
  const lx = (locPt as unknown as { X(): number }).X();
  const ly = (locPt as unknown as { Y(): number }).Y();
  const lz = (locPt as unknown as { Z(): number }).Z();
  const d = (lx - so.x) * (sn.x / len) + (ly - so.y) * (sn.y / len) + (lz - so.z) * (sn.z / len);
  if (Math.abs(d) > POINT_ON_PLANE_TOL) return 'original-face';
  return 'cut-face';
}

/**
 * Extract the outer wire boundary of a planar face as an ordered list of 3D
 * vertices. Returns one point per edge-vertex so polygon.length === edgeCount.
 *
 * Uses BRepTools_WireExplorer_2 (wire-only ctor) which walks edges in order
 * and exposes CurrentVertex() for the start vertex of each edge.
 */
export function extractFaceBoundary3D(oc: OcctInstance, face: unknown): Vec3[] {
  const faceTyped = oc.TopoDS.Face_1(face as never);

  // Find the first (outer) wire via TopExp_Explorer
  const wireExp = new oc.TopExp_Explorer_2(
    faceTyped as never,
    oc.TopAbs_ShapeEnum.TopAbs_WIRE as never,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never
  );
  if (!wireExp.More()) {
    wireExp.delete();
    return [];
  }
  const wireShape = wireExp.Current();
  wireExp.delete();

  const wire = oc.TopoDS.Wire_1(wireShape as never);
  const points: Vec3[] = [];

  // BRepTools_WireExplorer_2(wire) walks edges in order
  const wexp = new (oc as unknown as { BRepTools_WireExplorer_2: new (w: unknown) => {
    More(): boolean; Next(): void; CurrentVertex(): unknown; delete(): void;
  } }).BRepTools_WireExplorer_2(wire as never);

  while (wexp.More()) {
    const vertex = wexp.CurrentVertex();
    const pnt = oc.BRep_Tool.Pnt(vertex as never);
    points.push({ x: pnt.X(), y: pnt.Y(), z: pnt.Z() });
    (pnt as unknown as { delete(): void }).delete();
    (vertex as unknown as { delete(): void }).delete();
    wexp.Next();
  }
  wexp.delete();

  return points;
}

export function mergeFaceTags(
  maps: import('./cutBySectionPlane').FaceTagMap[]
): import('./cutBySectionPlane').FaceTagMap {
  const out: import('./cutBySectionPlane').FaceTagMap = new Map();
  for (const m of maps) for (const [k, v] of m) out.set(k, v);
  return out;
}
