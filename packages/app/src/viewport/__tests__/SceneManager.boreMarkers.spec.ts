import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { SceneManager, type MarkerOverlaySpec } from '../SceneManager';
import { face2DFrame } from '@zilventor/shared';

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

// One Top-face bore on a 600x400x18 panel at panel-local (u=100,v=50).
const oneBoreSpec = (): MarkerOverlaySpec => ({
  key: 'p1#c1',
  panelDims: { length: 600, width: 400, thickness: 18 },
  worldPose: identityPose,
  bores: [{
    id: 'b1', face: { featureId: 'panel', role: 'Top', instance: 0 }, u: 100, v: 50,
    diameter: 5, depth: 34, role: 'confirmat-face',
    connectorId: 'k1', connectorKind: 'confirmat',
  }],
});

describe('SceneManager — bore markers (Phase 5)', () => {
  let mgr: SceneManager;
  beforeEach(() => {
    mgr = new SceneManager(document.createElement('canvas'));
  });

  it('setBoreMarkers stores specs without throwing and starts empty', () => {
    expect(mgr.boreMarkerCount()).toBe(0);
    mgr.setBoreMarkers([oneBoreSpec()]);
    // Render happens in setShowBores/rebuild (next task); setter alone is inert.
    expect(mgr.boreMarkerSpecList()).toHaveLength(1);
  });

  it('builds one marker mesh per bore when showBores=true', () => {
    mgr.setShowBores(true);
    mgr.setBoreMarkers([oneBoreSpec()]);
    expect(mgr.boreMarkerCount()).toBe(1);
    const m = mgr.boreMarkerList()[0]!;
    expect(m).toBeInstanceOf(THREE.Mesh);
    expect(m.userData.kind).toBe('boreMarker');
    expect(m.userData.boreId).toBe('b1');
  });

  it('removes markers when showBores=false', () => {
    mgr.setShowBores(true);
    mgr.setBoreMarkers([oneBoreSpec()]);
    expect(mgr.boreMarkerCount()).toBe(1);
    mgr.setShowBores(false);
    expect(mgr.boreMarkerCount()).toBe(0);
  });

  it('positions a Top-face bore at face2DFrame(u,v) in world space (identity pose)', () => {
    // Top face of a 600x400x18 panel: origin = panel-local frame per face2DFrame.
    // u=100,v=50 must land at the same point face2DFrame computes; we assert the
    // marker's world position equals face2DFrame's P = origin + u*uDir + v*vDir.
    mgr.setShowBores(true);
    mgr.setBoreMarkers([oneBoreSpec()]);
    const m = mgr.boreMarkerList()[0]!;
    m.updateMatrixWorld(true);
    const wp = new THREE.Vector3();
    m.getWorldPosition(wp);
    // Use the SAME pure helper the production code uses — this guards the
    // shared <-> viewport coordinate agreement (the recurring false-green class).
    const f = face2DFrame({ length: 600, width: 400, thickness: 18 }, 'Top');
    const expected = {
      x: f.origin.x + 100 * f.uDir.x + 50 * f.vDir.x,
      y: f.origin.y + 100 * f.uDir.y + 50 * f.vDir.y,
      z: f.origin.z + 100 * f.uDir.z + 50 * f.vDir.z,
    };
    expect(wp.x).toBeCloseTo(expected.x, 4);
    expect(wp.y).toBeCloseTo(expected.y, 4);
    expect(wp.z).toBeCloseTo(expected.z, 4);
  });

  it('colors markers by connectorKind', () => {
    mgr.setShowBores(true);
    mgr.setBoreMarkers([oneBoreSpec()]);
    const mat = mgr.boreMarkerList()[0]!.material as THREE.MeshBasicMaterial;
    expect(mat.depthWrite).toBe(false);
    // confirmat -> a stable hex; exact value asserted against the constant map.
    expect(mat.color.getHexString()).toBe(SceneManager.BORE_COLORS.confirmat.replace('#', ''));
  });

  it('attach() subscribes setShowBores to the store', async () => {
    const { useAppStore } = await import('../../store/useAppStore');
    useAppStore.getState().setShowBores(true);
    mgr.setBoreMarkers([oneBoreSpec()]);
    const unsub = mgr.attach();
    expect(mgr.boreMarkerCount()).toBe(1);
    useAppStore.getState().setShowBores(false);
    expect(mgr.boreMarkerCount()).toBe(0);
    unsub();
  });
});
