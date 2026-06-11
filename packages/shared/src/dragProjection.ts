import type { Vec3 } from './types';

// Local helpers — dot/sub are not exported from connectorCoupling (PC1)
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });

export const GIZMO_AXIS_VIEW_PARALLEL_THRESHOLD = 0.95;

export interface PointerRay {
  origin: Vec3;
  /** Assumed unit-length (three.js Raycaster guarantees this). */
  dir: Vec3;
}

/**
 * Parameter t of the closest point on the line (pivot + t·axis) to the given ray.
 * Both axis and ray.dir are assumed unit-length. denom = sin²θ between them.
 */
function closestAxisParam(axis: Vec3, pivot: Vec3, ray: PointerRay): number {
  const b = dot(axis, ray.dir);   // a=c=1 (both unit vectors)
  const w0 = sub(pivot, ray.origin);
  const dA = dot(axis, w0);
  const eD = dot(ray.dir, w0);
  const denom = 1 - b * b;        // sin²θ
  return (b * eD - dA) / denom;
}

/**
 * Signed millimetres the bore should move along `axis` given the pointer ray
 * at drag-start and now.
 *
 * Returns `null` (hold — PC4) when the axis is near-parallel to the view
 * direction (|axis·rayNow.dir| > GIZMO_AXIS_VIEW_PARALLEL_THRESHOLD), which
 * would make the projection numerically degenerate.
 */
export function signedDragDeltaAlongAxis(
  axis: Vec3,
  pivot: Vec3,
  rayStart: PointerRay,
  rayNow: PointerRay,
): number | null {
  if (Math.abs(dot(axis, rayNow.dir)) > GIZMO_AXIS_VIEW_PARALLEL_THRESHOLD) {
    return null;
  }
  return closestAxisParam(axis, pivot, rayNow) - closestAxisParam(axis, pivot, rayStart);
}
