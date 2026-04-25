import type {
  WorkAxisFeature,
  WorkPlaneFeature,
  WorkPointFeature,
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

export function evaluateWorkAxis(
  _occt: OcctInstance,
  _shape: NamedShape | null,
  source: WorkAxisFeature['source'],
  _wfs: Map<string, WorkFeatureValue>,
): Result<{ origin: Vec3; direction: Vec3 }, KernelError> {
  if (source.mode === 'origin') {
    const direction: Vec3 =
      source.axis === 'X' ? { x: 1, y: 0, z: 0 } :
      source.axis === 'Y' ? { x: 0, y: 1, z: 0 } :
                            { x: 0, y: 0, z: 1 };
    return { ok: true, value: { origin: { x: 0, y: 0, z: 0 }, direction } };
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
