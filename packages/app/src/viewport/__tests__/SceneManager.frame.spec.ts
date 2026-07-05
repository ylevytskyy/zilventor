import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { SceneManager, type ComponentLeaf } from '../SceneManager';
import { computeClippingForDistance } from '../frameView';

vi.mock('three', async (orig) => {
  const actual = (await orig()) as typeof import('three');
  class FakeRenderer {
    domElement = document.createElement('canvas');
    setPixelRatio() {}
    setSize() {}
    render() {}
    dispose() {}
  }
  return { ...actual, WebGLRenderer: FakeRenderer };
});

vi.mock('three/examples/jsm/controls/OrbitControls.js', () => {
  class FakeOrbitControls {
    enableDamping = false;
    dampingFactor = 0;
    // Minimal target supporting the reads/writes frameToModel performs.
    target = {
      x: 0,
      y: 0,
      z: 0,
      copy(v: { x: number; y: number; z: number }) {
        this.x = v.x;
        this.y = v.y;
        this.z = v.z;
        return this;
      },
    };
    // Minimal EventDispatcher shape so SceneManager's 'change' listener wiring
    // can be exercised (real OrbitControls extends THREE.EventDispatcher).
    private listeners: Record<string, Array<() => void>> = {};
    addEventListener(type: string, fn: () => void): void {
      (this.listeners[type] ??= []).push(fn);
    }
    removeEventListener(type: string, fn: () => void): void {
      const arr = this.listeners[type];
      if (!arr) return;
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    }
    dispatchEvent(type: string): void {
      for (const fn of this.listeners[type] ?? []) fn();
    }
    update() {}
    dispose() {}
  }
  return { OrbitControls: FakeOrbitControls };
});

// Flat box geometry → positions/indices for SceneManager.setMesh.
function boxMesh(size: number): { pos: Float32Array; idx: Uint32Array } {
  const g = new THREE.BoxGeometry(size, size, size);
  const pos = new Float32Array(g.attributes.position!.array as ArrayLike<number>);
  const idx = new Uint32Array(g.index!.array as ArrayLike<number>);
  g.dispose();
  return { pos, idx };
}

describe('SceneManager — fit-to-model framing', () => {
  let mgr: SceneManager;
  beforeEach(() => {
    mgr = new SceneManager(document.createElement('canvas'));
  });

  it('does not move the camera on mesh upload when not armed', () => {
    const before = mgr.camera.position.clone();
    const farBefore = mgr.camera.far;
    const big = boxMesh(14000);
    mgr.setMesh(big.pos, big.idx);
    expect(mgr.camera.position.distanceTo(before)).toBeCloseTo(0, 6);
    expect(mgr.camera.far).toBe(farBefore);
  });

  it('frames a large model when armed: camera stands outside it and far clears it', () => {
    mgr.requestFrameOnNextMesh();
    const big = boxMesh(14000); // ~Predator scale, exceeds the default far=10000
    mgr.setMesh(big.pos, big.idx);
    // Camera now stands outside the model (half-extent 7000), not buried inside.
    const standoff = mgr.camera.position.distanceTo(
      new THREE.Vector3(mgr.controls.target.x, mgr.controls.target.y, mgr.controls.target.z),
    );
    expect(standoff).toBeGreaterThan(7000);
    // Far plane expanded past the old fixed 10000.
    expect(mgr.camera.far).toBeGreaterThan(10000);
    expect(mgr.camera.near).toBeGreaterThan(0);
  });

  it('is one-shot: a subsequent edit re-mesh does NOT re-frame', () => {
    mgr.requestFrameOnNextMesh();
    const big = boxMesh(14000);
    mgr.setMesh(big.pos, big.idx);
    const framedPos = mgr.camera.position.clone();
    const framedFar = mgr.camera.far;
    // Simulate an edit that re-meshes the same document (flag NOT re-armed).
    const small = boxMesh(50);
    mgr.setMesh(small.pos, small.idx);
    expect(mgr.camera.position.distanceTo(framedPos)).toBeCloseTo(0, 6);
    expect(mgr.camera.far).toBe(framedFar);
  });
});

describe('SceneManager — live re-clipping on zoom (OrbitControls change)', () => {
  let mgr: SceneManager;
  beforeEach(() => {
    mgr = new SceneManager(document.createElement('canvas'));
  });

  function fireControlsChange(m: SceneManager): void {
    (m.controls as unknown as { dispatchEvent(type: string): void }).dispatchEvent('change');
  }

  function targetVec(m: SceneManager): THREE.Vector3 {
    return new THREE.Vector3(m.controls.target.x, m.controls.target.y, m.controls.target.z);
  }

  it('is a no-op (no throw, near/far unchanged) when change fires with no geometry in the scene', () => {
    const nearBefore = mgr.camera.near;
    const farBefore = mgr.camera.far;
    expect(() => fireControlsChange(mgr)).not.toThrow();
    expect(mgr.camera.near).toBe(nearBefore);
    expect(mgr.camera.far).toBe(farBefore);
  });

  it('LOCKING (restored-session gap): derives near/far from a live measurement even when the mesh was set without ever going through frameToModel()', () => {
    // No requestFrameOnNextMesh() — this is the path a restored session takes:
    // geometry is displayed directly, frameToModel() never runs, so there is
    // no cached radius anywhere. The 'change' listener must still measure the
    // model live and re-derive near/far, not no-op at the constructor defaults
    // (0.1 / 10000), which is the second path to the "model is cut off" bug.
    const big = boxMesh(2000); // bounding-sphere radius sqrt(3)*1000 ~= 1732.05, centered at origin
    mgr.setMesh(big.pos, big.idx);
    const target = targetVec(mgr);
    const dist = mgr.camera.position.distanceTo(target); // camera still at constructor default (400,400,400)
    const radius = Math.sqrt(3) * 1000;
    const expected = computeClippingForDistance(dist, radius);
    fireControlsChange(mgr);
    expect(mgr.camera.near).toBeCloseTo(expected.near, 3);
    expect(mgr.camera.far).toBeCloseTo(expected.far, 3);
  });

  it('grows the far plane on a dolly-out so the model stays inside the depth range', () => {
    mgr.requestFrameOnNextMesh();
    const big = boxMesh(2000); // bounding-sphere radius ~1732
    mgr.setMesh(big.pos, big.idx);
    const framedFar = mgr.camera.far;
    const target = targetVec(mgr);
    const dir = mgr.camera.position.clone().sub(target).normalize();
    // Dolly the camera far outside the fit-time far plane.
    mgr.camera.position.copy(target.clone().add(dir.multiplyScalar(50000)));
    fireControlsChange(mgr);
    expect(mgr.camera.far).toBeGreaterThan(framedFar);
    expect(mgr.camera.far).toBeGreaterThan(50000);
  });

  it('shrinks the near plane on a dolly-in so the model front face is not clipped', () => {
    mgr.requestFrameOnNextMesh();
    const big = boxMesh(2000); // bounding-sphere radius ~1732
    mgr.setMesh(big.pos, big.idx);
    const framedNear = mgr.camera.near;
    const target = targetVec(mgr);
    const dir = mgr.camera.position.clone().sub(target).normalize();
    // Dolly the camera in close, well within the fit-time near plane.
    mgr.camera.position.copy(target.clone().add(dir.multiplyScalar(50)));
    fireControlsChange(mgr);
    expect(mgr.camera.near).toBeLessThan(framedNear);
    expect(mgr.camera.near).toBeGreaterThan(0);
  });

  it('STALENESS: reflects a model that grew after the initial fit, not a cached fit-time radius', () => {
    mgr.requestFrameOnNextMesh();
    const big = boxMesh(2000); // bounding-sphere radius ~1732
    mgr.setMesh(big.pos, big.idx);

    // Grow the scene bounds AFTER the fit: add a second (component) mesh far
    // away, simulating an edit that enlarges the model post-framing. A cached
    // fit-time radius would go stale here; a live measurement must not.
    const farGeom = new THREE.BoxGeometry(10, 10, 10);
    mgr.setPartGeometry('parts/far.zipt', farGeom);
    const grownLeaf: ComponentLeaf = {
      kind: 'leaf',
      componentPath: ['far'],
      partPath: 'parts/far.zipt',
      worldPose: { translation: { x: 60000, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] },
      visible: true,
    };
    mgr.setComponentMeshes([grownLeaf]);

    // Dolly the camera IN close (dist tiny) so the far-plane value is
    // dominated by the radius term, not the distance term — this isolates
    // whether the recompute uses a STALE fit-time radius (~1732, which would
    // cap far around 1732*1.5+50 ~= 2650) or a fresh measurement of the grown
    // model (now spanning out to x=60000, radius in the tens of thousands).
    const target = targetVec(mgr);
    const dir = mgr.camera.position.clone().sub(target).normalize();
    mgr.camera.position.copy(target.clone().add(dir.multiplyScalar(50)));
    fireControlsChange(mgr);

    expect(mgr.camera.far).toBeGreaterThan(20000);
  });
});
