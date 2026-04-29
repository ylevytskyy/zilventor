import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { SceneManager, type ComponentLeaf } from '../SceneManager';
import { pathKey } from '@zilventor/shared';

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
  };
}

describe('SceneManager — component meshes', () => {
  let mgr: SceneManager;
  beforeEach(() => {
    const canvas = document.createElement('canvas');
    mgr = new SceneManager(canvas);
  });

  it('setComponentMeshes adds a mesh per component', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    mgr.setPartGeometry('p.zipt', g);
    mgr.setComponentMeshes([leaf({ componentPath: ['C1'] })]);
    expect(mgr.componentMeshCount()).toBe(1);
  });

  it('updating same path updates the mesh in place', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    mgr.setPartGeometry('p.zipt', g);
    mgr.setComponentMeshes([leaf({ componentPath: ['C1'] })]);
    const meshA = mgr.getComponentMesh(pathKey(['C1']));
    mgr.setComponentMeshes([leaf({
      componentPath: ['C1'],
      worldPose: { translation: { x: 50, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] },
    })]);
    const meshB = mgr.getComponentMesh(pathKey(['C1']));
    expect(meshA).toBe(meshB);
    expect(meshB!.matrix.elements[12]).toBeCloseTo(50, 5);
  });

  it('removing a path removes its mesh from the scene', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    mgr.setPartGeometry('p.zipt', g);
    mgr.setComponentMeshes([leaf({ componentPath: ['C1'] })]);
    expect(mgr.componentMeshCount()).toBe(1);
    mgr.setComponentMeshes([]);
    expect(mgr.componentMeshCount()).toBe(0);
  });

  it('two components sharing partPath reference the same BufferGeometry', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    mgr.setPartGeometry('p.zipt', g);
    mgr.setComponentMeshes([
      leaf({ componentPath: ['C1'] }),
      leaf({ componentPath: ['C2'], worldPose: { translation: { x: 10, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] } }),
    ]);
    const m1 = mgr.getComponentMesh(pathKey(['C1']));
    const m2 = mgr.getComponentMesh(pathKey(['C2']));
    expect(m1!.geometry).toBe(g);
    expect(m2!.geometry).toBe(g);
    expect(m1!.geometry).toBe(m2!.geometry);
  });

  it('attaches mesh.userData.componentPath to each placed leaf', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    mgr.setPartGeometry('p.zipt', g);
    mgr.setComponentMeshes([
      leaf({ componentPath: ['a', 'b'], materialColor: '#888888' }),
    ]);
    const meshes = mgr.componentMeshesByPathKey();
    expect(meshes.get(pathKey(['a', 'b']))!.userData.componentPath).toEqual(['a', 'b']);
  });

  it('clearComponentMeshes removes all', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    mgr.setPartGeometry('p.zipt', g);
    mgr.setComponentMeshes([
      leaf({ componentPath: ['C1'] }),
      leaf({ componentPath: ['C2'] }),
    ]);
    mgr.clearComponentMeshes();
    expect(mgr.componentMeshCount()).toBe(0);
  });

  it('geometry hash includes component transforms', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    mgr.setPartGeometry('p.zipt', g);
    mgr.setComponentMeshes([leaf({ componentPath: ['C1'] })]);
    const hashA = mgr.geometryHash();
    mgr.setComponentMeshes([leaf({
      componentPath: ['C1'],
      worldPose: { translation: { x: 50, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] },
    })]);
    const hashB = mgr.geometryHash();
    expect(hashA).not.toBe(hashB);
  });

  it('geometry hash differs by component count', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    mgr.setPartGeometry('p.zipt', g);
    mgr.setComponentMeshes([leaf({ componentPath: ['C1'] })]);
    const hashA = mgr.geometryHash();
    mgr.setComponentMeshes([
      leaf({ componentPath: ['C1'] }),
      leaf({ componentPath: ['C2'], worldPose: { translation: { x: 10, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] } }),
    ]);
    const hashB = mgr.geometryHash();
    expect(hashA).not.toBe(hashB);
  });

  it('raycastComponent returns the componentPath of the hit mesh', () => {
    const g = new THREE.BoxGeometry(50, 50, 50);
    mgr.setPartGeometry('p.zipt', g);
    mgr.setComponentMeshes([leaf({ componentPath: ['C1'] })]);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
    camera.position.set(0, 0, 200);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const ndc = new THREE.Vector2(0, 0);
    const path = mgr.raycastComponent(camera, ndc);
    expect(path).toEqual(['C1']);
  });

  it('raycastComponent returns null when nothing is hit', () => {
    const g = new THREE.BoxGeometry(50, 50, 50);
    mgr.setPartGeometry('p.zipt', g);
    mgr.setComponentMeshes([leaf({
      componentPath: ['C1'],
      worldPose: { translation: { x: 1000, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] },
    })]);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
    camera.position.set(0, 0, 200);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const ndc = new THREE.Vector2(0, 0);
    const path = mgr.raycastComponent(camera, ndc);
    expect(path).toBeNull();
  });

  it('worldPose places the mesh at the requested translation', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    mgr.setPartGeometry('p.zipt', g);
    mgr.setComponentMeshes([leaf({
      componentPath: ['C1'],
      worldPose: { translation: { x: 42, y: 7, z: 3 }, quaternion: [0, 0, 0, 1] },
    })]);
    const mesh = mgr.getComponentMesh(pathKey(['C1']))!;
    expect(mesh.matrix.elements[12]).toBeCloseTo(42, 5);
    expect(mesh.matrix.elements[13]).toBeCloseTo(7, 5);
    expect(mesh.matrix.elements[14]).toBeCloseTo(3, 5);
  });

  it('materialColor produces a MeshStandardMaterial with that color', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    mgr.setPartGeometry('p.zipt', g);
    mgr.setComponentMeshes([
      leaf({ componentPath: ['C1'], materialColor: '#cc8866' }),
    ]);
    const mesh = mgr.getComponentMesh(pathKey(['C1']))!;
    expect(mesh.material).toBeInstanceOf(THREE.MeshStandardMaterial);
    const mat = mesh.material as THREE.MeshStandardMaterial;
    expect(mat.color.getHexString()).toBe('cc8866');
  });

  it('two components with same materialColor share the cached material instance', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    mgr.setPartGeometry('p.zipt', g);
    mgr.setComponentMeshes([
      leaf({ componentPath: ['C1'], materialColor: '#cc8866' }),
      leaf({ componentPath: ['C2'], materialColor: '#cc8866' }),
    ]);
    const a = mgr.getComponentMesh(pathKey(['C1']))!;
    const b = mgr.getComponentMesh(pathKey(['C2']))!;
    expect(a.material).toBe(b.material);
  });

  it('leaf without materialColor uses the shared grey component material', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    mgr.setPartGeometry('p.zipt', g);
    mgr.setComponentMeshes([
      leaf({ componentPath: ['C1'] }),
      leaf({ componentPath: ['C2'] }),
    ]);
    const a = mgr.getComponentMesh(pathKey(['C1']))!;
    const b = mgr.getComponentMesh(pathKey(['C2']))!;
    expect(a.material).toBe(b.material);
    expect(a.material).toBeInstanceOf(THREE.MeshStandardMaterial);
  });

  it('reverts to shared grey material when materialColor is removed on update', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    mgr.setPartGeometry('p.zipt', g);
    mgr.setComponentMeshes([
      leaf({ componentPath: ['C1'], materialColor: '#aabbcc' }),
      leaf({ componentPath: ['C2'] }),
    ]);
    const c2Grey = mgr.getComponentMesh(pathKey(['C2']))!.material;
    mgr.setComponentMeshes([
      leaf({ componentPath: ['C1'] }),
      leaf({ componentPath: ['C2'] }),
    ]);
    const c1AfterRevert = mgr.getComponentMesh(pathKey(['C1']))!.material;
    expect(c1AfterRevert).toBe(c2Grey);
  });

  it('selection overlay activates for the matching componentPath only', () => {
    const g = new THREE.BoxGeometry(50, 50, 50);
    mgr.setPartGeometry('p.zipt', g);
    mgr.setComponentMeshes([
      leaf({ componentPath: ['a'] }),
      leaf({ componentPath: ['s', 'leaf'] }),
    ]);
    mgr.setSelectedComponentPaths([['s', 'leaf']]);
    expect(mgr.selectionOverlayPathKeys()).toEqual([pathKey(['s', 'leaf'])]);
  });

  it('setSelectedComponentPaths adds an outline overlay to selected meshes only', () => {
    const g = new THREE.BoxGeometry(50, 50, 50);
    mgr.setPartGeometry('p.zipt', g);
    mgr.setComponentMeshes([
      leaf({ componentPath: ['C1'] }),
      leaf({ componentPath: ['C2'], worldPose: { translation: { x: 100, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] } }),
    ]);
    mgr.setSelectedComponentPaths([['C1']]);
    const m1 = mgr.getComponentMesh(pathKey(['C1']))!;
    const m2 = mgr.getComponentMesh(pathKey(['C2']))!;
    const overlays1 = m1.children.filter((c) => c instanceof THREE.LineSegments);
    const overlays2 = m2.children.filter((c) => c instanceof THREE.LineSegments);
    expect(overlays1.length).toBe(1);
    expect(overlays2.length).toBe(0);
    const mat = (overlays1[0] as THREE.LineSegments).material as THREE.LineBasicMaterial;
    expect(mat).toBeInstanceOf(THREE.LineBasicMaterial);
    expect(mat.color.getHexString()).toBe('ff8800');
    expect(mgr.hasSelectionOverlay(pathKey(['C1']))).toBe(true);
    expect(mgr.hasSelectionOverlay(pathKey(['C2']))).toBe(false);
  });

  it('setSelectedComponentPaths removes overlay and disposes its geometry when deselected', () => {
    const g = new THREE.BoxGeometry(50, 50, 50);
    mgr.setPartGeometry('p.zipt', g);
    mgr.setComponentMeshes([leaf({ componentPath: ['C1'] })]);
    mgr.setSelectedComponentPaths([['C1']]);
    const m1 = mgr.getComponentMesh(pathKey(['C1']))!;
    const overlay = m1.children.find((c) => c instanceof THREE.LineSegments) as THREE.LineSegments;
    expect(overlay).toBeDefined();
    const disposeSpy = vi.spyOn(overlay.geometry, 'dispose');
    mgr.setSelectedComponentPaths([]);
    expect(mgr.hasSelectionOverlay(pathKey(['C1']))).toBe(false);
    expect(m1.children.filter((c) => c instanceof THREE.LineSegments).length).toBe(0);
    expect(disposeSpy).toHaveBeenCalled();
  });

  it('setSelectedComponentPaths is idempotent for already-selected meshes', () => {
    const g = new THREE.BoxGeometry(50, 50, 50);
    mgr.setPartGeometry('p.zipt', g);
    mgr.setComponentMeshes([leaf({ componentPath: ['C1'] })]);
    mgr.setSelectedComponentPaths([['C1']]);
    mgr.setSelectedComponentPaths([['C1']]);
    const m1 = mgr.getComponentMesh(pathKey(['C1']))!;
    expect(m1.children.filter((c) => c instanceof THREE.LineSegments).length).toBe(1);
  });

});

describe('SceneManager — work features', () => {
  let mgr: SceneManager;
  beforeEach(() => {
    const canvas = document.createElement('canvas');
    mgr = new SceneManager(canvas);
  });

  it('setWorkFeatures adds an axis renderer node', () => {
    mgr.setWorkFeatures([
      { featureId: 'WA1', kind: 'axis', origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 }, visible: true },
    ]);
    expect(mgr.workFeatureCount()).toBe(1);
    const node = mgr.getWorkFeatureNode('WA1');
    expect(node).toBeDefined();
  });

  it('setWorkFeatures updates same id in place', () => {
    mgr.setWorkFeatures([{ featureId: 'WA1', kind: 'axis', origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 }, visible: true }]);
    const a = mgr.getWorkFeatureNode('WA1');
    mgr.setWorkFeatures([{ featureId: 'WA1', kind: 'axis', origin: { x: 5, y: 0, z: 0 }, direction: { x: 0, y: 1, z: 0 }, visible: true }]);
    const b = mgr.getWorkFeatureNode('WA1');
    expect(a).toBe(b);
  });

  it('setWorkFeatures removes nodes whose id is no longer in the spec list', () => {
    mgr.setWorkFeatures([{ featureId: 'WA1', kind: 'axis', origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 }, visible: true }]);
    mgr.setWorkFeatures([]);
    expect(mgr.workFeatureCount()).toBe(0);
  });

  it('respects visible flag', () => {
    mgr.setWorkFeatures([{ featureId: 'WA1', kind: 'axis', origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 }, visible: false }]);
    expect(mgr.getWorkFeatureNode('WA1')!.visible).toBe(false);
  });

  it('clearWorkFeatures removes all', () => {
    mgr.setWorkFeatures([
      { featureId: 'WA1', kind: 'axis', origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 }, visible: true },
      { featureId: 'WP1', kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, visible: true },
    ]);
    mgr.clearWorkFeatures();
    expect(mgr.workFeatureCount()).toBe(0);
  });

  it('builds a plane node as a Group at the origin position', () => {
    mgr.setWorkFeatures([
      { featureId: 'WP1', kind: 'plane', origin: { x: 1, y: 2, z: 3 }, normal: { x: 0, y: 0, z: 1 }, visible: true },
    ]);
    const node = mgr.getWorkFeatureNode('WP1') as THREE.Group;
    expect(node).toBeDefined();
    expect(node.children.length).toBeGreaterThanOrEqual(1);
    expect(node.position.x).toBeCloseTo(1, 5);
    expect(node.position.y).toBeCloseTo(2, 5);
    expect(node.position.z).toBeCloseTo(3, 5);
  });

  it('builds a point node at the spec origin', () => {
    mgr.setWorkFeatures([
      { featureId: 'WPT1', kind: 'point', origin: { x: 1, y: 2, z: 3 }, visible: true },
    ]);
    const node = mgr.getWorkFeatureNode('WPT1') as THREE.Group;
    expect(node).toBeDefined();
    expect(node.position.x).toBeCloseTo(1, 5);
    expect(node.position.y).toBeCloseTo(2, 5);
    expect(node.position.z).toBeCloseTo(3, 5);
  });

  it('geometry hash includes work-feature transforms', () => {
    mgr.setWorkFeatures([{ featureId: 'WP1', kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, visible: true }]);
    const a = mgr.geometryHash();
    mgr.setWorkFeatures([{ featureId: 'WP1', kind: 'plane', origin: { x: 0, y: 0, z: 50 }, normal: { x: 0, y: 0, z: 1 }, visible: true }]);
    const b = mgr.geometryHash();
    expect(a).not.toBe(b);
  });

  it('hidden work features do not affect the hash', () => {
    mgr.setWorkFeatures([{ featureId: 'WP1', kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, visible: false }]);
    const a = mgr.geometryHash();
    mgr.setWorkFeatures([]);
    const b = mgr.geometryHash();
    expect(a).toBe(b);
  });

  it('raycastWorkFeature returns the hit feature id', () => {
    mgr.setWorkFeatures([{ featureId: 'WP1', kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, visible: true }]);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
    camera.position.set(0, 0, 200);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const id = mgr.raycastWorkFeature(camera, new THREE.Vector2(0, 0));
    expect(id).toBe('WP1');
  });

  it('raycastWorkFeature returns null when nothing is hit', () => {
    mgr.setWorkFeatures([{ featureId: 'WP1', kind: 'plane', origin: { x: 1000, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, visible: true }]);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
    camera.position.set(0, 0, 200);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    // Plane is 1000mm off in +X; ray straight ahead misses.
    const id = mgr.raycastWorkFeature(camera, new THREE.Vector2(0, 0));
    expect(id).toBeNull();
  });
});
