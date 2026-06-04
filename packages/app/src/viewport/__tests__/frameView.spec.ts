import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { computeCameraFrame } from '../frameView';

// Bounding sphere helper: every corner of `box` must satisfy
//   near <= |corner - camera| <= far   (model fully inside the depth range)
// and the model's angular radius must fit inside the smaller FOV (model framed).
function corners(box: THREE.Box3): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) out.push(new THREE.Vector3(x, y, z));
  return out;
}

describe('computeCameraFrame', () => {
  const fovDeg = 40;
  const aspect = 1.7;
  const dir = new THREE.Vector3(1, 1, 1);

  it('targets the box center', () => {
    const box = new THREE.Box3(new THREE.Vector3(10, 20, 30), new THREE.Vector3(50, 80, 90));
    const f = computeCameraFrame(box, fovDeg, aspect, dir);
    expect(f.target.x).toBeCloseTo(30, 6);
    expect(f.target.y).toBeCloseTo(50, 6);
    expect(f.target.z).toBeCloseTo(60, 6);
  });

  it('preserves the requested view direction', () => {
    const box = new THREE.Box3(new THREE.Vector3(-5, -5, -5), new THREE.Vector3(5, 5, 5));
    const f = computeCameraFrame(box, fovDeg, aspect, dir);
    const fromTarget = f.position.clone().sub(f.target).normalize();
    const want = dir.clone().normalize();
    expect(fromTarget.dot(want)).toBeCloseTo(1, 5);
  });

  it('frames the whole model inside the FOV and depth range', () => {
    const box = new THREE.Box3(new THREE.Vector3(-100, -50, -200), new THREE.Vector3(100, 50, 200));
    const f = computeCameraFrame(box, fovDeg, aspect, dir);
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    const dist = f.position.distanceTo(f.target);
    // Model's angular radius fits within the limiting half-FOV (with margin).
    const vfov = (fovDeg * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const halfFov = Math.min(vfov, hfov) / 2;
    expect(Math.asin(sphere.radius / dist)).toBeLessThan(halfFov);
    // Near/far enclose every corner; near is positive.
    expect(f.near).toBeGreaterThan(0);
    for (const c of corners(box)) {
      const d = f.position.distanceTo(c);
      expect(d).toBeGreaterThanOrEqual(f.near);
      expect(d).toBeLessThanOrEqual(f.far);
    }
  });

  it('handles the Predator import: far plane expands past the old 10000 and contains the model', () => {
    // Real tessellated mesh bbox of mq-1-predator Assem1.STEP.
    const box = new THREE.Box3(
      new THREE.Vector3(-7319, -205, -8220),
      new THREE.Vector3(7319, 2438, 790),
    );
    const f = computeCameraFrame(box, fovDeg, aspect, dir);
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    const dist = f.position.distanceTo(f.target);
    // Camera now stands well outside the model (was buried inside at standoff ~692).
    expect(dist).toBeGreaterThan(sphere.radius);
    // Old fixed far plane (10000) was too small; new far must clear the model.
    expect(f.far).toBeGreaterThan(10000);
    for (const c of corners(box)) {
      const d = f.position.distanceTo(c);
      expect(d).toBeGreaterThanOrEqual(f.near);
      expect(d).toBeLessThanOrEqual(f.far);
    }
  });

  it('degenerate (zero-size) box does not produce NaN/zero distance', () => {
    const box = new THREE.Box3(new THREE.Vector3(5, 5, 5), new THREE.Vector3(5, 5, 5));
    const f = computeCameraFrame(box, fovDeg, aspect, dir);
    expect(Number.isFinite(f.position.x)).toBe(true);
    expect(f.near).toBeGreaterThan(0);
    expect(f.far).toBeGreaterThan(f.near);
    expect(f.position.distanceTo(f.target)).toBeGreaterThan(0);
  });
});
