import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { SceneManager } from '../SceneManager';
import { createCustomTextureRegistry } from '../../textures/customTextureRegistry';

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
    update() {}
    dispose() {}
  }
  return { OrbitControls: FakeOrbitControls };
});

vi.mock('../textureCache', () => {
  const fakeSet = {
    albedo: { wrapS: 0, wrapT: 0, repeat: { set: () => {} }, dispose: () => {} },
    normal: { wrapS: 0, wrapT: 0, repeat: { set: () => {} }, dispose: () => {} },
    roughness: { wrapS: 0, wrapT: 0, repeat: { set: () => {} }, dispose: () => {} },
  };
  return { globalTextureCache: { loadTextureSet: () => fakeSet, disposeTextures: vi.fn() } };
});

vi.mock('@zilventor/shared', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    findTextureDef: (id: string) =>
      id === 'oak'
        ? { id: 'oak', name: 'Oak', albedoUrl: '/textures/oak/albedo.jpg', physicalWidthMm: 400, physicalHeightMm: 400 }
        : undefined,
  };
});

// Minimal geometry data for setMesh
const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const indices = new Uint32Array([0, 1, 2]);
const uv = new Float32Array([0, 0, 1, 0, 0, 1]);

function makeSceneManager(): SceneManager {
  const canvas = document.createElement('canvas');
  return new SceneManager(canvas);
}

beforeEach(() => {
  (globalThis as any).URL.createObjectURL = vi.fn(() => 'blob:fake');
  (globalThis as any).URL.revokeObjectURL = vi.fn();
});

describe('SceneManager — custom texture resolution', () => {
  it('buildMaterial resolves a custom textureId via the injected registry', () => {
    const reg = createCustomTextureRegistry();
    reg.register(
      [{ id: 'custom-1', name: 'M', physicalWidthMm: 1000, physicalHeightMm: 1000, albedoBlobId: 'a' }],
      { a: new Uint8Array([1]) },
    );
    const sm = makeSceneManager();
    sm.setCustomTextureRegistry(reg);
    sm.setMesh(positions, indices, '#ffffff', uv, 'custom-1');
    const mat = sm.getCurrentMaterial();
    expect((mat as THREE.MeshStandardMaterial).map).toBeTruthy();
  });

  it('falls back to solid color when a custom id is unknown to the registry', () => {
    const sm = makeSceneManager();
    sm.setMesh(positions, indices, '#abcdef', uv, 'custom-missing');
    const mat = sm.getCurrentMaterial();
    expect((mat as THREE.MeshStandardMaterial).map).toBeFalsy();
  });

  it('setCustomTextureRegistry clears texture-id-keyed caches so a rebuilt registry does not serve stale URLs', async () => {
    const { globalTextureCache } = await import('../textureCache');
    (globalTextureCache.disposeTextures as ReturnType<typeof vi.fn>).mockClear();
    const reg = createCustomTextureRegistry();
    reg.register(
      [{ id: 'custom-1', name: 'M', physicalWidthMm: 1000, physicalHeightMm: 1000, albedoBlobId: 'a' }],
      { a: new Uint8Array([1]) },
    );
    const sm = makeSceneManager();
    sm.setCustomTextureRegistry(reg);
    expect(globalTextureCache.disposeTextures).toHaveBeenCalled();
  });
});
