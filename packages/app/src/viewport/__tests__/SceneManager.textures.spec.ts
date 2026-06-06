import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { pathKey } from '@zilventor/shared';
import type { ComponentLeaf } from '../SceneManager';
import { SceneManager } from '../SceneManager';
import * as textureCache from '../textureCache';

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
  return { globalTextureCache: { loadTextureSet: () => fakeSet, disposeTextures: () => {} } };
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

const identityPose = {
  translation: { x: 0, y: 0, z: 0 },
  quaternion: [0, 0, 0, 1] as [number, number, number, number],
};

function leaf(opts: Partial<ComponentLeaf> & { componentPath: ReadonlyArray<string> }): ComponentLeaf {
  return {
    kind: 'leaf',
    componentPath: opts.componentPath,
    partPath: opts.partPath ?? 'p.zipt',
    worldPose: opts.worldPose ?? identityPose,
    visible: opts.visible ?? true,
    ...(opts.materialColor !== undefined ? { materialColor: opts.materialColor } : {}),
    ...(opts.textureId !== undefined ? { textureId: opts.textureId } : {}),
  } as ComponentLeaf;
}

describe('SceneManager.dispose — texture cache teardown', () => {
  it('calls globalTextureCache.disposeTextures() when disposed', () => {
    const canvas = document.createElement('canvas');
    const mgr = new SceneManager(canvas);
    const spy = vi.spyOn(textureCache.globalTextureCache, 'disposeTextures');
    mgr.dispose();
    expect(spy).toHaveBeenCalledOnce();
  });
});

describe('SceneManager — textured component materials', () => {
  let canvas: HTMLCanvasElement;
  let mgr: SceneManager;
  beforeEach(() => { canvas = document.createElement('canvas'); mgr = new SceneManager(canvas); });

  it('two leaves with the same textureId + materialColor share one material instance', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    mgr.setPartGeometry('p.zipt', g);
    mgr.setComponentMeshes([
      leaf({ componentPath: ['C1'], textureId: 'oak', materialColor: '#8b6914' }),
      leaf({ componentPath: ['C2'], partPath: 'p.zipt', textureId: 'oak', materialColor: '#8b6914' }),
    ]);
    const m1 = (mgr.getComponentMesh(pathKey(['C1'])) as THREE.Mesh | undefined)?.material;
    const m2 = (mgr.getComponentMesh(pathKey(['C2'])) as THREE.Mesh | undefined)?.material;
    expect(m1).toBeDefined();
    expect(m1).toBe(m2);
  });

  it('different textureId + same tint produces different materials', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    mgr.setPartGeometry('p.zipt', g);
    mgr.setComponentMeshes([
      leaf({ componentPath: ['C1'], textureId: 'oak', materialColor: '#8b6914' }),
      leaf({ componentPath: ['C2'], partPath: 'p.zipt', materialColor: '#8b6914' }),
    ]);
    const m1 = (mgr.getComponentMesh(pathKey(['C1'])) as THREE.Mesh | undefined)?.material;
    const m2 = (mgr.getComponentMesh(pathKey(['C2'])) as THREE.Mesh | undefined)?.material;
    expect(m1).not.toBe(m2);
  });
});
