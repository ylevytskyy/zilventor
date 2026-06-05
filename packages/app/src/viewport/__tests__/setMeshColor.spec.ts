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

function triMesh(): { pos: Float32Array; idx: Uint32Array } {
  return {
    pos: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    idx: new Uint32Array([0, 1, 2]),
  };
}

describe('SceneManager.setMesh color', () => {
  let sm: SceneManager;
  beforeEach(() => {
    sm = new SceneManager(document.createElement('canvas'));
  });

  it('uses the provided hex color on the part material', () => {
    const { pos, idx } = triMesh();
    sm.setMesh(pos, idx, '#ff0000');
    const mesh = (sm as unknown as { current: THREE.Mesh }).current;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    expect(mat.color.getHexString()).toBe('ff0000');
  });

  it('falls back to default gray when no color is given', () => {
    const { pos, idx } = triMesh();
    sm.setMesh(pos, idx);
    const mesh = (sm as unknown as { current: THREE.Mesh }).current;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    expect(mat.color.getHexString()).toBe('c8c8c8');
  });
});
