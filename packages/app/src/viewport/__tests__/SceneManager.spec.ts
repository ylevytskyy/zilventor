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
    update() {}
    dispose() {}
  }
  return { OrbitControls: FakeOrbitControls };
});

describe('SceneManager — component meshes', () => {
  let mgr: SceneManager;
  beforeEach(() => {
    const canvas = document.createElement('canvas');
    mgr = new SceneManager(canvas);
  });

  it('setComponentMeshes adds a mesh per component', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    mgr.setComponentMeshes([
      { componentId: 'C1', geometry: g, transform: new THREE.Matrix4(), visible: true },
    ]);
    expect(mgr.componentMeshCount()).toBe(1);
  });

  it('updating same id updates the mesh in place', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    const t1 = new THREE.Matrix4();
    const t2 = new THREE.Matrix4().setPosition(50, 0, 0);
    mgr.setComponentMeshes([{ componentId: 'C1', geometry: g, transform: t1, visible: true }]);
    const meshA = mgr.getComponentMesh('C1');
    mgr.setComponentMeshes([{ componentId: 'C1', geometry: g, transform: t2, visible: true }]);
    const meshB = mgr.getComponentMesh('C1');
    expect(meshA).toBe(meshB);
    expect(meshB!.matrix.elements[12]).toBe(50);
  });

  it('removing an id disposes its mesh and removes from scene', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    mgr.setComponentMeshes([{ componentId: 'C1', geometry: g, transform: new THREE.Matrix4(), visible: true }]);
    expect(mgr.componentMeshCount()).toBe(1);
    mgr.setComponentMeshes([]);
    expect(mgr.componentMeshCount()).toBe(0);
  });

  it('two components sharing geometry reference the same BufferGeometry', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    mgr.setComponentMeshes([
      { componentId: 'C1', geometry: g, transform: new THREE.Matrix4(), visible: true },
      { componentId: 'C2', geometry: g, transform: new THREE.Matrix4().setPosition(10, 0, 0), visible: true },
    ]);
    const m1 = mgr.getComponentMesh('C1');
    const m2 = mgr.getComponentMesh('C2');
    expect(m1!.geometry).toBe(g);
    expect(m2!.geometry).toBe(g);
    expect(m1!.geometry).toBe(m2!.geometry);
  });

  it('clearComponentMeshes removes all', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    mgr.setComponentMeshes([
      { componentId: 'C1', geometry: g, transform: new THREE.Matrix4(), visible: true },
      { componentId: 'C2', geometry: g, transform: new THREE.Matrix4(), visible: true },
    ]);
    mgr.clearComponentMeshes();
    expect(mgr.componentMeshCount()).toBe(0);
  });

  it('geometry hash includes component transforms', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    mgr.setComponentMeshes([{ componentId: 'C1', geometry: g, transform: new THREE.Matrix4(), visible: true }]);
    const hashA = mgr.geometryHash();
    mgr.setComponentMeshes([{ componentId: 'C1', geometry: g, transform: new THREE.Matrix4().setPosition(50, 0, 0), visible: true }]);
    const hashB = mgr.geometryHash();
    expect(hashA).not.toBe(hashB);
  });

  it('geometry hash differs by component count', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    mgr.setComponentMeshes([{ componentId: 'C1', geometry: g, transform: new THREE.Matrix4(), visible: true }]);
    const hashA = mgr.geometryHash();
    mgr.setComponentMeshes([
      { componentId: 'C1', geometry: g, transform: new THREE.Matrix4(), visible: true },
      { componentId: 'C2', geometry: g, transform: new THREE.Matrix4().setPosition(10, 0, 0), visible: true },
    ]);
    const hashB = mgr.geometryHash();
    expect(hashA).not.toBe(hashB);
  });

  it('raycastComponent returns the componentId of the hit mesh', () => {
    const g = new THREE.BoxGeometry(50, 50, 50);
    const t = new THREE.Matrix4();
    mgr.setComponentMeshes([{ componentId: 'C1', geometry: g, transform: t, visible: true }]);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
    camera.position.set(0, 0, 200);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    // NDC at center → straight ahead — should hit the cube at origin
    const ndc = new THREE.Vector2(0, 0);
    const id = mgr.raycastComponent(camera, ndc);
    expect(id).toBe('C1');
  });

  it('raycastComponent returns null when nothing is hit', () => {
    const g = new THREE.BoxGeometry(50, 50, 50);
    const t = new THREE.Matrix4().setPosition(1000, 0, 0);
    mgr.setComponentMeshes([{ componentId: 'C1', geometry: g, transform: t, visible: true }]);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
    camera.position.set(0, 0, 200);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    // NDC at center → straight ahead, but cube is way off to +X
    const ndc = new THREE.Vector2(0, 0);
    const id = mgr.raycastComponent(camera, ndc);
    expect(id).toBeNull();
  });

  it('pose overrides Euler transform when present', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    const transform = new THREE.Matrix4(); // identity — position at origin
    const pose = {
      translation: { x: 42, y: 7, z: 3 },
      quaternion: [0, 0, 0, 1] as [number, number, number, number],
    };
    mgr.setComponentMeshes([{ componentId: 'C1', geometry: g, transform, pose, visible: true }]);
    const mesh = mgr.getComponentMesh('C1')!;
    // pose.translation should win over the identity transform
    expect(mesh.matrix.elements[12]).toBeCloseTo(42, 5);
    expect(mesh.matrix.elements[13]).toBeCloseTo(7, 5);
    expect(mesh.matrix.elements[14]).toBeCloseTo(3, 5);
  });

  it('pose-less spec still uses the Euler transform', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    const transform = new THREE.Matrix4().setPosition(99, 0, 0);
    mgr.setComponentMeshes([{ componentId: 'C1', geometry: g, transform, visible: true }]);
    const mesh = mgr.getComponentMesh('C1')!;
    expect(mesh.matrix.elements[12]).toBeCloseTo(99, 5);
  });

  it('colorHex spec produces a MeshStandardMaterial with that color', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    mgr.setComponentMeshes([
      { componentId: 'C1', geometry: g, transform: new THREE.Matrix4(), visible: true, colorHex: '#cc8866' },
    ]);
    const mesh = mgr.getComponentMesh('C1')!;
    expect(mesh.material).toBeInstanceOf(THREE.MeshStandardMaterial);
    const mat = mesh.material as THREE.MeshStandardMaterial;
    expect(mat.color.getHexString()).toBe('cc8866');
  });

  it('two components with same colorHex share the cached material instance', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    mgr.setComponentMeshes([
      { componentId: 'C1', geometry: g, transform: new THREE.Matrix4(), visible: true, colorHex: '#cc8866' },
      { componentId: 'C2', geometry: g, transform: new THREE.Matrix4().setPosition(10, 0, 0), visible: true, colorHex: '#cc8866' },
    ]);
    const a = mgr.getComponentMesh('C1')!;
    const b = mgr.getComponentMesh('C2')!;
    expect(a.material).toBe(b.material);
  });

  it('spec without colorHex uses the shared grey component material', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    mgr.setComponentMeshes([
      { componentId: 'C1', geometry: g, transform: new THREE.Matrix4(), visible: true },
      { componentId: 'C2', geometry: g, transform: new THREE.Matrix4().setPosition(10, 0, 0), visible: true },
    ]);
    const a = mgr.getComponentMesh('C1')!;
    const b = mgr.getComponentMesh('C2')!;
    expect(a.material).toBe(b.material);
    expect(a.material).toBeInstanceOf(THREE.MeshStandardMaterial);
  });

  it('reverts to shared grey material when colorHex is removed on update', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    mgr.setComponentMeshes([
      { componentId: 'C1', geometry: g, transform: new THREE.Matrix4(), visible: true, colorHex: '#aabbcc' },
      { componentId: 'C2', geometry: g, transform: new THREE.Matrix4(), visible: true },
    ]);
    const c2Grey = mgr.getComponentMesh('C2')!.material;
    mgr.setComponentMeshes([
      { componentId: 'C1', geometry: g, transform: new THREE.Matrix4(), visible: true },
      { componentId: 'C2', geometry: g, transform: new THREE.Matrix4(), visible: true },
    ]);
    const c1AfterRevert = mgr.getComponentMesh('C1')!.material;
    expect(c1AfterRevert).toBe(c2Grey);
  });

  it('setSelectedComponentIds adds an outline overlay to selected meshes only', () => {
    const g = new THREE.BoxGeometry(50, 50, 50);
    mgr.setComponentMeshes([
      { componentId: 'C1', geometry: g, transform: new THREE.Matrix4(), visible: true },
      { componentId: 'C2', geometry: g, transform: new THREE.Matrix4().setPosition(100, 0, 0), visible: true },
    ]);
    mgr.setSelectedComponentIds(['C1']);
    const m1 = mgr.getComponentMesh('C1')!;
    const m2 = mgr.getComponentMesh('C2')!;
    const overlays1 = m1.children.filter((c) => c instanceof THREE.LineSegments);
    const overlays2 = m2.children.filter((c) => c instanceof THREE.LineSegments);
    expect(overlays1.length).toBe(1);
    expect(overlays2.length).toBe(0);
    const mat = (overlays1[0] as THREE.LineSegments).material as THREE.LineBasicMaterial;
    expect(mat).toBeInstanceOf(THREE.LineBasicMaterial);
    expect(mat.color.getHexString()).toBe('ff8800');
    expect(mgr.hasSelectionOverlay('C1')).toBe(true);
    expect(mgr.hasSelectionOverlay('C2')).toBe(false);
  });

  it('setSelectedComponentIds removes overlay and disposes its geometry when deselected', () => {
    const g = new THREE.BoxGeometry(50, 50, 50);
    mgr.setComponentMeshes([
      { componentId: 'C1', geometry: g, transform: new THREE.Matrix4(), visible: true },
    ]);
    mgr.setSelectedComponentIds(['C1']);
    const m1 = mgr.getComponentMesh('C1')!;
    const overlay = m1.children.find((c) => c instanceof THREE.LineSegments) as THREE.LineSegments;
    expect(overlay).toBeDefined();
    const disposeSpy = vi.spyOn(overlay.geometry, 'dispose');
    mgr.setSelectedComponentIds([]);
    expect(mgr.hasSelectionOverlay('C1')).toBe(false);
    expect(m1.children.filter((c) => c instanceof THREE.LineSegments).length).toBe(0);
    expect(disposeSpy).toHaveBeenCalled();
  });

  it('setSelectedComponentIds is idempotent for already-selected meshes', () => {
    const g = new THREE.BoxGeometry(50, 50, 50);
    mgr.setComponentMeshes([
      { componentId: 'C1', geometry: g, transform: new THREE.Matrix4(), visible: true },
    ]);
    mgr.setSelectedComponentIds(['C1']);
    mgr.setSelectedComponentIds(['C1']);
    const m1 = mgr.getComponentMesh('C1')!;
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
