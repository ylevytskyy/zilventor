import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { SceneManager } from '../SceneManager';

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
