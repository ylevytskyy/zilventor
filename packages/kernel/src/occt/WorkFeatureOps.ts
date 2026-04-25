import type {
  WorkAxisFeature,
  WorkPlaneFeature,
  WorkPointFeature,
  WorkAxisRef,
  WorkPlaneRef,
  WorkPointRef,
  WorkFeatureValue,
  Vec3,
} from '@zilventor/shared';
import type { ParamOrLiteral, SketchParameter } from '@zilventor/shared';

import type { Result } from '@zilventor/shared';
import { type KernelError, newCorrelationId } from '@zilventor/shared';
import type { OcctInstance } from './occtLoader';
import { faceNamesEqual, resolveEdge as resolveEdgeByName, type NamedShape } from './FaceNaming';
import type { EdgeName, FaceName } from '@zilventor/shared';

export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });

export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });

export const scale = (v: Vec3, s: number): Vec3 => ({ x: v.x * s, y: v.y * s, z: v.z * s });

export const length = (v: Vec3): number => Math.sqrt(dot(v, v));

export const normalize = (v: Vec3): Vec3 => {
  const l = length(v);
  if (l < 1e-12) return { x: 0, y: 0, z: 0 };
  return scale(v, 1 / l);
};

const notImplemented = (what: string): KernelError => ({
  kind: 'notImplemented',
  message: `${what} not yet implemented`,
  correlationId: newCorrelationId(),
});

const invalidGeometryFail = (what: string): { ok: false; error: KernelError } => ({
  ok: false,
  error: {
    kind: 'invalidGeometry',
    message: what,
    correlationId: newCorrelationId(),
  },
});

function resolveParam(p: ParamOrLiteral, params: Record<string, SketchParameter>): number {
  if (p.kind === 'literal') return p.value;
  return params[p.paramName]?.value ?? 0;
}



export function evaluateWorkAxis(
  occt: OcctInstance,
  shape: NamedShape | null,
  source: WorkAxisFeature['source'],
  wfs: Map<string, WorkFeatureValue>,
): Result<{ origin: Vec3; direction: Vec3 }, KernelError> {
  if (source.mode === 'origin') {
    const direction: Vec3 =
      source.axis === 'X' ? { x: 1, y: 0, z: 0 } :
      source.axis === 'Y' ? { x: 0, y: 1, z: 0 } :
                            { x: 0, y: 0, z: 1 };
    return { ok: true, value: { origin: { x: 0, y: 0, z: 0 }, direction } };
  }
  if (source.mode === 'twoPoints') {
    const a = resolveWorkPointRef(source.pointA, occt, shape, wfs);
    if (!a.ok) return a;
    const b = resolveWorkPointRef(source.pointB, occt, shape, wfs);
    if (!b.ok) return b;
    const dir = sub(b.value.position, a.value.position);
    if (length(dir) < 1e-9) return invalidGeometryFail('twoPoints: pointA and pointB are coincident');
    return { ok: true, value: { origin: a.value.position, direction: normalize(dir) } };
  }
  if (source.mode === 'normalToPlaneThroughPoint') {
    const pl = resolveWorkPlaneRef(source.plane, occt, shape, wfs);
    if (!pl.ok) return pl;
    const pt = resolveWorkPointRef(source.point, occt, shape, wfs);
    if (!pt.ok) return pt;
    return { ok: true, value: { origin: pt.value.position, direction: normalize(pl.value.normal) } };
  }
  if (source.mode === 'twoPlanes') {
    const pa = resolveWorkPlaneRef(source.planeA, occt, shape, wfs);
    if (!pa.ok) return pa;
    const pb = resolveWorkPlaneRef(source.planeB, occt, shape, wfs);
    if (!pb.ok) return pb;
    const raw = cross(pa.value.normal, pb.value.normal);
    if (length(raw) < 1e-9) return invalidGeometryFail('twoPlanes: planes are parallel; no intersection axis');
    const dir = normalize(raw);
    const dA = dot(pa.value.normal, pa.value.origin);
    const dB = dot(pb.value.normal, pb.value.origin);
    const ax = Math.abs(dir.x);
    const ay = Math.abs(dir.y);
    const az = Math.abs(dir.z);
    const fixCoord = ax >= ay && ax >= az ? 'x' : ay >= az ? 'y' : 'z';
    let origin: Vec3;
    if (fixCoord === 'x') {
      const det = pa.value.normal.y * pb.value.normal.z - pa.value.normal.z * pb.value.normal.y;
      const y = (dA * pb.value.normal.z - dB * pa.value.normal.z) / det;
      const z = (pa.value.normal.y * dB - pb.value.normal.y * dA) / det;
      origin = { x: 0, y, z };
    } else if (fixCoord === 'y') {
      const det = pa.value.normal.x * pb.value.normal.z - pa.value.normal.z * pb.value.normal.x;
      const x = (dA * pb.value.normal.z - dB * pa.value.normal.z) / det;
      const z = (pa.value.normal.x * dB - pb.value.normal.x * dA) / det;
      origin = { x, y: 0, z };
    } else {
      const det = pa.value.normal.x * pb.value.normal.y - pa.value.normal.y * pb.value.normal.x;
      const x = (dA * pb.value.normal.y - dB * pa.value.normal.y) / det;
      const y = (pa.value.normal.x * dB - pb.value.normal.x * dA) / det;
      origin = { x, y, z: 0 };
    }
    return { ok: true, value: { origin, direction: dir } };
  }
  if (source.mode === 'cylindricalFace') {
    const ax = extractCylinderAxis(occt, shape, source.face);
    if (!ax) return { ok: false, error: featureNotFound('cylindrical face', `${source.face.featureId}/${source.face.role}`) };
    return { ok: true, value: ax };
  }
  if (source.mode === 'edge') {
    const ax = extractEdgeLine(occt, shape, source.edge);
    if (!ax) return { ok: false, error: featureNotFound('edge', `${source.edge.faceA.featureId}|${source.edge.faceB.featureId}`) };
    return { ok: true, value: ax };
  }
  return { ok: false, error: notImplemented(`evaluateWorkAxis: mode ${(source as { mode: string }).mode}`) };
}

export function evaluateWorkPlane(
  occt: OcctInstance,
  shape: NamedShape | null,
  source: WorkPlaneFeature['source'],
  wfs: Map<string, WorkFeatureValue>,
  params: Record<string, SketchParameter>,
): Result<{ origin: Vec3; normal: Vec3 }, KernelError> {
  if (source.mode === 'origin') {
    const normal: Vec3 =
      source.plane === 'XY' ? { x: 0, y: 0, z: 1 } :
      source.plane === 'YZ' ? { x: 1, y: 0, z: 0 } :
                              { x: 0, y: 1, z: 0 };
    return { ok: true, value: { origin: { x: 0, y: 0, z: 0 }, normal } };
  }
  if (source.mode === 'offsetFromPlane') {
    const pl = resolveWorkPlaneRef(source.plane, occt, shape, wfs);
    if (!pl.ok) return pl;
    const off = resolveParam(source.offset, params);
    return {
      ok: true,
      value: {
        origin: add(pl.value.origin, scale(normalize(pl.value.normal), off)),
        normal: pl.value.normal,
      },
    };
  }
  if (source.mode === 'threePoints') {
    const a = resolveWorkPointRef(source.points[0], occt, shape, wfs);
    if (!a.ok) return a;
    const b = resolveWorkPointRef(source.points[1], occt, shape, wfs);
    if (!b.ok) return b;
    const c = resolveWorkPointRef(source.points[2], occt, shape, wfs);
    if (!c.ok) return c;
    const ab = sub(b.value.position, a.value.position);
    const ac = sub(c.value.position, a.value.position);
    const n = cross(ab, ac);
    if (length(n) < 1e-9) return invalidGeometryFail('threePoints: collinear points cannot define a plane');
    return { ok: true, value: { origin: a.value.position, normal: normalize(n) } };
  }
  if (source.mode === 'midplane') {
    const a = resolveWorkPlaneRef(source.planeA, occt, shape, wfs);
    if (!a.ok) return a;
    const b = resolveWorkPlaneRef(source.planeB, occt, shape, wfs);
    if (!b.ok) return b;
    const dotN = Math.abs(dot(normalize(a.value.normal), normalize(b.value.normal)));
    if (dotN < 0.999) return invalidGeometryFail('midplane: input planes are not parallel');
    const mid = scale(add(a.value.origin, b.value.origin), 0.5);
    return { ok: true, value: { origin: mid, normal: normalize(a.value.normal) } };
  }
  if (source.mode === 'axisPerpendicularToPlane') {
    const ax = resolveWorkAxisRef(source.axis, occt, shape, wfs);
    if (!ax.ok) return ax;
    const pl = resolveWorkPlaneRef(source.plane, occt, shape, wfs);
    if (!pl.ok) return pl;
    const raw = cross(ax.value.direction, pl.value.normal);
    if (length(raw) < 1e-9) return invalidGeometryFail('axisPerpendicularToPlane: axis is parallel to plane normal');
    return { ok: true, value: { origin: ax.value.origin, normal: normalize(raw) } };
  }
  if (source.mode === 'axisAtAngleToPlane') {
    const ax = resolveWorkAxisRef(source.axis, occt, shape, wfs);
    if (!ax.ok) return ax;
    const pl = resolveWorkPlaneRef(source.plane, occt, shape, wfs);
    if (!pl.ok) return pl;
    const angle = (resolveParam(source.angle, params) * Math.PI) / 180;
    const k = normalize(ax.value.direction);
    const n0 = pl.value.normal;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const term1 = scale(n0, cosA);
    const term2 = scale(cross(k, n0), sinA);
    const term3 = scale(k, dot(k, n0) * (1 - cosA));
    const n = normalize(add(add(term1, term2), term3));
    return { ok: true, value: { origin: ax.value.origin, normal: n } };
  }
  if (source.mode === 'tangentToSurfaceParallelToPlane') {
    const refPlane = resolveWorkPlaneRef(source.plane, occt, shape, wfs);
    if (!refPlane.ok) return refPlane;
    const cyl = extractCylinderInfo(occt, shape, source.face);
    if (!cyl) return { ok: false, error: featureNotFound('cylindrical face', `${source.face.featureId}/${source.face.role}`) };
    const nRef = normalize(refPlane.value.normal);
    const D = normalize(cyl.direction);
    // Project nRef onto the plane perpendicular to the cylinder axis. The
    // surface normal at the tangent point is parallel to that projection.
    const nPerp = sub(nRef, scale(D, dot(nRef, D)));
    if (length(nPerp) < 1e-9) {
      return invalidGeometryFail('tangentToSurfaceParallelToPlane: reference plane normal is parallel to cylinder axis');
    }
    const nUnit = normalize(nPerp);
    const tangentPoint = add(cyl.origin, scale(nUnit, cyl.radius));
    return { ok: true, value: { origin: tangentPoint, normal: nRef } };
  }
  return { ok: false, error: notImplemented(`evaluateWorkPlane: mode ${(source as { mode: string }).mode}`) };
}

export function evaluateWorkPoint(
  occt: OcctInstance,
  shape: NamedShape | null,
  source: WorkPointFeature['source'],
  wfs: Map<string, WorkFeatureValue>,
): Result<{ position: Vec3 }, KernelError> {
  if (source.mode === 'origin') {
    return { ok: true, value: { position: { x: 0, y: 0, z: 0 } } };
  }
  if (source.mode === 'axisIntersectsPlane') {
    const ax = resolveWorkAxisRef(source.axis, occt, shape, wfs);
    if (!ax.ok) return ax;
    const pl = resolveWorkPlaneRef(source.plane, occt, shape, wfs);
    if (!pl.ok) return pl;
    const denom = dot(ax.value.direction, pl.value.normal);
    if (Math.abs(denom) < 1e-9) return invalidGeometryFail('axisIntersectsPlane: axis is parallel to plane');
    const t = dot(sub(pl.value.origin, ax.value.origin), pl.value.normal) / denom;
    return { ok: true, value: { position: add(ax.value.origin, scale(ax.value.direction, t)) } };
  }
  if (source.mode === 'threePlanes') {
    const planes: { origin: Vec3; normal: Vec3 }[] = [];
    for (const ref of source.planes) {
      const r = resolveWorkPlaneRef(ref, occt, shape, wfs);
      if (!r.ok) return r;
      planes.push(r.value);
    }
    const M: number[][] = planes.map((p) => [p.normal.x, p.normal.y, p.normal.z]);
    const d: number[] = planes.map((p) => dot(p.normal, p.origin));
    const det3 = (m: number[][]): number =>
      m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!)
      - m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!)
      + m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!);
    const D = det3(M);
    if (Math.abs(D) < 1e-9) return invalidGeometryFail('threePlanes: planes are linearly dependent');
    const Mx = M.map((row, i) => [d[i]!, row[1]!, row[2]!]);
    const My = M.map((row, i) => [row[0]!, d[i]!, row[2]!]);
    const Mz = M.map((row, i) => [row[0]!, row[1]!, d[i]!]);
    return {
      ok: true,
      value: { position: { x: det3(Mx) / D, y: det3(My) / D, z: det3(Mz) / D } },
    };
  }
  if (source.mode === 'vertex') {
    const pt = extractEdgeEndpoint(occt, shape, source.edge, source.end);
    if (!pt) return { ok: false, error: featureNotFound('vertex', `${source.edge.faceA.featureId}|${source.edge.faceB.featureId}#${source.end}`) };
    return { ok: true, value: { position: pt } };
  }
  if (source.mode === 'midpointOfEdge') {
    const pt = extractEdgeMidpoint(occt, shape, source.edge);
    if (!pt) return { ok: false, error: featureNotFound('edge', `${source.edge.faceA.featureId}|${source.edge.faceB.featureId}`) };
    return { ok: true, value: { position: pt } };
  }
  if (source.mode === 'centerOfArc') {
    // Reuse the cylinder-axis extractor: gp_Cylinder.Location() is the
    // basepoint of the axis, which on default cylinder construction is the
    // arc/circle center.
    const ax = extractCylinderAxis(occt, shape, source.face);
    if (!ax) return { ok: false, error: featureNotFound('arc/cylinder face', `${source.face.featureId}/${source.face.role}`) };
    return { ok: true, value: { position: ax.origin } };
  }
  return { ok: false, error: notImplemented(`evaluateWorkPoint: mode ${(source as { mode: string }).mode}`) };
}

const featureNotFound = (kind: string, featureId: string): KernelError => ({
  kind: 'featureNotFound',
  message: `${kind} ${featureId} not found in work-feature cache`,
  correlationId: newCorrelationId(),
  featureId,
});

export function resolveWorkAxisRef(
  ref: WorkAxisRef,
  _occt: OcctInstance | null,
  _shape: NamedShape | null,
  wfs: Map<string, WorkFeatureValue>,
): Result<{ origin: Vec3; direction: Vec3 }, KernelError> {
  if (ref.source === 'workAxis') {
    const v = wfs.get(ref.featureId);
    if (!v || v.kind !== 'axis') return { ok: false, error: featureNotFound('work axis', ref.featureId) };
    return { ok: true, value: { origin: v.origin, direction: v.direction } };
  }
  if (ref.source === 'cylindricalFace') {
    const ax = _occt && _shape ? extractCylinderAxis(_occt, _shape, ref.face) : null;
    if (!ax) return { ok: false, error: featureNotFound('cylindrical face', `${ref.face.featureId}/${ref.face.role}`) };
    return { ok: true, value: ax };
  }
  if (ref.source === 'edge') {
    const ax = _occt && _shape ? extractEdgeLine(_occt, _shape, ref.edge) : null;
    if (!ax) return { ok: false, error: featureNotFound('edge', `${ref.edge.faceA.featureId}|${ref.edge.faceB.featureId}`) };
    return { ok: true, value: ax };
  }
  return { ok: false, error: notImplemented(`resolveWorkAxisRef: source ${(ref as { source: string }).source}`) };
}

/**
 * Look up a face by name in a NamedShape and extract its plane (origin +
 * outward normal). Returns null when the face isn't named or isn't planar.
 * Uses BRepAdaptor_Surface — same pattern HoleFeature uses for face plane.
 */
export function extractFacePlane(
  oc: OcctInstance,
  shape: NamedShape | null,
  faceName: FaceName,
): { origin: Vec3; normal: Vec3 } | null {
  if (!shape) return null;
  const entry = shape.faceNames.find((e) => faceNamesEqual(e.name, faceName));
  if (!entry) return null;
  const ocAny = oc as unknown as {
    TopoDS: { Face_1: (s: unknown) => unknown };
    BRepAdaptor_Surface_2: new (face: unknown, restriction: boolean) => {
      GetType: () => unknown;
      Plane: () => { Location: () => { X: () => number; Y: () => number; Z: () => number }; Axis: () => { Direction: () => { X: () => number; Y: () => number; Z: () => number } } };
      delete?: () => void;
    };
    GeomAbs_SurfaceType: { GeomAbs_Plane: unknown };
  };
  const typedFace = ocAny.TopoDS.Face_1(entry.face);
  const adaptor = new ocAny.BRepAdaptor_Surface_2(typedFace, true);
  try {
    if (adaptor.GetType() !== ocAny.GeomAbs_SurfaceType.GeomAbs_Plane) return null;
    const pln = adaptor.Plane();
    const loc = pln.Location();
    const dir = pln.Axis().Direction();
    return {
      origin: { x: loc.X(), y: loc.Y(), z: loc.Z() },
      normal: { x: dir.X(), y: dir.Y(), z: dir.Z() },
    };
  } finally {
    adaptor.delete?.();
  }
}

/**
 * Look up a face by name and extract its cylinder axis (origin = a point
 * on the axis, direction = unit vector along the axis). Returns null when
 * the face isn't named or isn't cylindrical.
 */
export function extractCylinderAxis(
  oc: OcctInstance,
  shape: NamedShape | null,
  faceName: FaceName,
): { origin: Vec3; direction: Vec3 } | null {
  if (!shape) return null;
  const entry = shape.faceNames.find((e) => faceNamesEqual(e.name, faceName));
  if (!entry) return null;
  const ocAny = oc as unknown as {
    TopoDS: { Face_1: (s: unknown) => unknown };
    BRepAdaptor_Surface_2: new (face: unknown, restriction: boolean) => {
      GetType: () => unknown;
      Cylinder: () => {
        Location: () => { X: () => number; Y: () => number; Z: () => number };
        Axis: () => { Direction: () => { X: () => number; Y: () => number; Z: () => number } };
      };
      delete?: () => void;
    };
    GeomAbs_SurfaceType: { GeomAbs_Cylinder: unknown };
  };
  const typedFace = ocAny.TopoDS.Face_1(entry.face);
  const adaptor = new ocAny.BRepAdaptor_Surface_2(typedFace, true);
  try {
    if (adaptor.GetType() !== ocAny.GeomAbs_SurfaceType.GeomAbs_Cylinder) return null;
    const cyl = adaptor.Cylinder();
    const loc = cyl.Location();
    const dir = cyl.Axis().Direction();
    return {
      origin: { x: loc.X(), y: loc.Y(), z: loc.Z() },
      direction: { x: dir.X(), y: dir.Y(), z: dir.Z() },
    };
  } finally {
    adaptor.delete?.();
  }
}

/**
 * Look up a cylindrical face by name and extract its axis (origin + unit
 * direction) plus radius. Returns null when the face isn't named or isn't
 * cylindrical. Superset of extractCylinderAxis.
 */
export function extractCylinderInfo(
  oc: OcctInstance,
  shape: NamedShape | null,
  faceName: FaceName,
): { origin: Vec3; direction: Vec3; radius: number } | null {
  if (!shape) return null;
  const entry = shape.faceNames.find((e) => faceNamesEqual(e.name, faceName));
  if (!entry) return null;
  const ocAny = oc as unknown as {
    TopoDS: { Face_1: (s: unknown) => unknown };
    BRepAdaptor_Surface_2: new (face: unknown, restriction: boolean) => {
      GetType: () => unknown;
      Cylinder: () => {
        Location: () => { X: () => number; Y: () => number; Z: () => number };
        Axis: () => { Direction: () => { X: () => number; Y: () => number; Z: () => number } };
        Radius: () => number;
      };
      delete?: () => void;
    };
    GeomAbs_SurfaceType: { GeomAbs_Cylinder: unknown };
  };
  const typedFace = ocAny.TopoDS.Face_1(entry.face);
  const adaptor = new ocAny.BRepAdaptor_Surface_2(typedFace, true);
  try {
    if (adaptor.GetType() !== ocAny.GeomAbs_SurfaceType.GeomAbs_Cylinder) return null;
    const cyl = adaptor.Cylinder();
    const loc = cyl.Location();
    const dir = cyl.Axis().Direction();
    return {
      origin: { x: loc.X(), y: loc.Y(), z: loc.Z() },
      direction: { x: dir.X(), y: dir.Y(), z: dir.Z() },
      radius: cyl.Radius(),
    };
  } finally {
    adaptor.delete?.();
  }
}

/**
 * Look up an edge by name and extract the line it represents (origin =
 * curve start point, direction = normalized vector from start to end).
 * Returns null when the edge isn't named or has degenerate length.
 */
export function extractEdgeLine(
  oc: OcctInstance,
  shape: NamedShape | null,
  edgeName: EdgeName,
): { origin: Vec3; direction: Vec3 } | null {
  if (!shape) return null;
  const edge = resolveEdgeByName(oc, shape, edgeName);
  if (!edge) return null;
  const ocAny = oc as unknown as {
    TopoDS: { Edge_1: (s: unknown) => unknown };
    BRepAdaptor_Curve_2: new (edge: unknown) => {
      FirstParameter: () => number;
      LastParameter: () => number;
      Value: (t: number) => { X: () => number; Y: () => number; Z: () => number };
      delete?: () => void;
    };
  };
  const typedEdge = ocAny.TopoDS.Edge_1(edge);
  const adaptor = new ocAny.BRepAdaptor_Curve_2(typedEdge);
  try {
    const t0 = adaptor.FirstParameter();
    const t1 = adaptor.LastParameter();
    const p0 = adaptor.Value(t0);
    const p1 = adaptor.Value(t1);
    const origin: Vec3 = { x: p0.X(), y: p0.Y(), z: p0.Z() };
    const raw: Vec3 = { x: p1.X() - p0.X(), y: p1.Y() - p0.Y(), z: p1.Z() - p0.Z() };
    if (length(raw) < 1e-12) return null;
    return { origin, direction: normalize(raw) };
  } finally {
    adaptor.delete?.();
  }
}

export function resolveWorkPlaneRef(
  ref: WorkPlaneRef,
  _occt: OcctInstance | null,
  _shape: NamedShape | null,
  wfs: Map<string, WorkFeatureValue>,
): Result<{ origin: Vec3; normal: Vec3 }, KernelError> {
  if (ref.source === 'workPlane') {
    const v = wfs.get(ref.featureId);
    if (!v || v.kind !== 'plane') return { ok: false, error: featureNotFound('work plane', ref.featureId) };
    return { ok: true, value: { origin: v.origin, normal: v.normal } };
  }
  if (ref.source === 'face') {
    const plane = _occt && _shape ? extractFacePlane(_occt, _shape, ref.face) : null;
    if (!plane) {
      return { ok: false, error: featureNotFound('face', `${ref.face.featureId}/${ref.face.role}`) };
    }
    return { ok: true, value: plane };
  }
  return { ok: false, error: notImplemented(`resolveWorkPlaneRef: source ${(ref as { source: string }).source}`) };
}

export function resolveWorkPointRef(
  ref: WorkPointRef,
  _occt: OcctInstance | null,
  _shape: NamedShape | null,
  wfs: Map<string, WorkFeatureValue>,
): Result<{ position: Vec3 }, KernelError> {
  if (ref.source === 'workPoint') {
    const v = wfs.get(ref.featureId);
    if (!v || v.kind !== 'point') return { ok: false, error: featureNotFound('work point', ref.featureId) };
    return { ok: true, value: { position: v.position } };
  }
  if (ref.source === 'vertex') {
    const pt = _occt && _shape ? extractEdgeEndpoint(_occt, _shape, ref.edge, ref.end) : null;
    if (!pt) return { ok: false, error: featureNotFound('vertex', `${ref.edge.faceA.featureId}|${ref.edge.faceB.featureId}#${ref.end}`) };
    return { ok: true, value: { position: pt } };
  }
  return { ok: false, error: notImplemented(`resolveWorkPointRef: source ${(ref as { source: string }).source}`) };
}

/**
 * Look up an edge by name and return either its start or end vertex
 * position by walking the curve to FirstParameter / LastParameter.
 * Returns null when the edge isn't named.
 */
export function extractEdgeEndpoint(
  oc: OcctInstance,
  shape: NamedShape | null,
  edgeName: EdgeName,
  end: 'start' | 'end',
): Vec3 | null {
  if (!shape) return null;
  const edge = resolveEdgeByName(oc, shape, edgeName);
  if (!edge) return null;
  const ocAny = oc as unknown as {
    TopoDS: { Edge_1: (s: unknown) => unknown };
    BRepAdaptor_Curve_2: new (edge: unknown) => {
      FirstParameter: () => number;
      LastParameter: () => number;
      Value: (t: number) => { X: () => number; Y: () => number; Z: () => number };
      delete?: () => void;
    };
  };
  const typedEdge = ocAny.TopoDS.Edge_1(edge);
  const adaptor = new ocAny.BRepAdaptor_Curve_2(typedEdge);
  try {
    const t = end === 'start' ? adaptor.FirstParameter() : adaptor.LastParameter();
    const p = adaptor.Value(t);
    return { x: p.X(), y: p.Y(), z: p.Z() };
  } finally {
    adaptor.delete?.();
  }
}

/**
 * Look up an edge by name and return the midpoint of its parameter range
 * — i.e. Value((FirstParameter + LastParameter) / 2). For straight
 * edges this is the geometric midpoint; for curves the parametric midpoint
 * (which OCCT chooses to coincide with arc-length midpoint for arcs of
 * circles).
 */
export function extractEdgeMidpoint(
  oc: OcctInstance,
  shape: NamedShape | null,
  edgeName: EdgeName,
): Vec3 | null {
  if (!shape) return null;
  const edge = resolveEdgeByName(oc, shape, edgeName);
  if (!edge) return null;
  const ocAny = oc as unknown as {
    TopoDS: { Edge_1: (s: unknown) => unknown };
    BRepAdaptor_Curve_2: new (edge: unknown) => {
      FirstParameter: () => number;
      LastParameter: () => number;
      Value: (t: number) => { X: () => number; Y: () => number; Z: () => number };
      delete?: () => void;
    };
  };
  const typedEdge = ocAny.TopoDS.Edge_1(edge);
  const adaptor = new ocAny.BRepAdaptor_Curve_2(typedEdge);
  try {
    const t = (adaptor.FirstParameter() + adaptor.LastParameter()) / 2;
    const p = adaptor.Value(t);
    return { x: p.X(), y: p.Y(), z: p.Z() };
  } finally {
    adaptor.delete?.();
  }
}
