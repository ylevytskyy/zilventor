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
import type { Result } from '@zilventor/shared';
import { type KernelError, newCorrelationId } from '@zilventor/shared';
import type { OcctInstance } from './occtLoader';
import type { NamedShape } from './FaceNaming';

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
  return { ok: false, error: notImplemented(`evaluateWorkAxis: mode ${source.mode}`) };
}

export function evaluateWorkPlane(
  _occt: OcctInstance,
  _shape: NamedShape | null,
  source: WorkPlaneFeature['source'],
  _wfs: Map<string, WorkFeatureValue>,
): Result<{ origin: Vec3; normal: Vec3 }, KernelError> {
  if (source.mode === 'origin') {
    const normal: Vec3 =
      source.plane === 'XY' ? { x: 0, y: 0, z: 1 } :
      source.plane === 'YZ' ? { x: 1, y: 0, z: 0 } :
                              { x: 0, y: 1, z: 0 };
    return { ok: true, value: { origin: { x: 0, y: 0, z: 0 }, normal } };
  }
  return { ok: false, error: notImplemented(`evaluateWorkPlane: mode ${source.mode}`) };
}

export function evaluateWorkPoint(
  _occt: OcctInstance,
  _shape: NamedShape | null,
  source: WorkPointFeature['source'],
  _wfs: Map<string, WorkFeatureValue>,
): Result<{ position: Vec3 }, KernelError> {
  if (source.mode === 'origin') {
    return { ok: true, value: { position: { x: 0, y: 0, z: 0 } } };
  }
  return { ok: false, error: notImplemented(`evaluateWorkPoint: mode ${source.mode}`) };
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
  return { ok: false, error: notImplemented(`resolveWorkAxisRef: source ${ref.source}`) };
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
  return { ok: false, error: notImplemented(`resolveWorkPlaneRef: source ${ref.source}`) };
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
  return { ok: false, error: notImplemented(`resolveWorkPointRef: source ${ref.source}`) };
}
