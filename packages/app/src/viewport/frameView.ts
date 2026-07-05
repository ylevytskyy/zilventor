import * as THREE from 'three';

export interface CameraFrame {
  position: THREE.Vector3;
  target: THREE.Vector3;
  near: number;
  far: number;
}

/**
 * Compute a camera placement that frames `box` for a perspective camera.
 *
 * The hardcoded camera (position 400,400,400 / near 0.1 / far 10000) was sized
 * for ~500mm furniture parts and buries itself inside any large import — e.g. a
 * full-scale STEP drone (~14.6m) renders only partly (camera inside the
 * fuselage; far half clipped past 10000). This frames the camera to the actual
 * model bounds along the requested view direction and derives near/far from the
 * model size so nothing is clipped at any orbit angle.
 */
/**
 * Derive a [near, far] clipping window from a camera-to-target distance and
 * the model's bounding-sphere radius. Used both at fit-time (computeCameraFrame)
 * and live, on every OrbitControls 'change' event, so dollying the camera never
 * moves it outside a stale near/far window computed once at file-open.
 */
export function computeClippingForDistance(dist: number, radius: number): { near: number; far: number } {
  const r = Number.isFinite(radius) && radius > 0 ? radius : 0;
  const near = Math.max(dist - r * 1.5, dist / 1000, 0.01);
  let far = dist + r * 1.5;
  if (far <= near) far = near + Math.max(near * 0.001, 0.01);
  return { near, far };
}

export function computeCameraFrame(
  box: THREE.Box3,
  fovDeg: number,
  aspect: number,
  dir: THREE.Vector3,
): CameraFrame {
  const sphere = new THREE.Sphere();
  box.getBoundingSphere(sphere);
  const center = sphere.center.clone();
  let r = sphere.radius;
  if (!(r > 0) || !Number.isFinite(r)) r = 1; // degenerate / single-point box

  // Fit against the smaller of the vertical / horizontal FOV so the model is
  // framed regardless of viewport aspect.
  const vfov = (fovDeg * Math.PI) / 180;
  const safeAspect = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * safeAspect);
  const halfFov = Math.min(vfov, hfov) / 2;
  const margin = 1.2;
  const dist = (r / Math.sin(halfFov)) * margin;

  let d = dir.clone();
  if (!(d.lengthSq() > 0) || !Number.isFinite(d.lengthSq())) d.set(1, 1, 1);
  d.normalize();

  const position = center.clone().add(d.multiplyScalar(dist));
  const { near, far } = computeClippingForDistance(dist, r);
  return { position, target: center, near, far };
}
