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
});
