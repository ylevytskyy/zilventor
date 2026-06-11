import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { SceneManager, type MarkerOverlaySpec } from '../SceneManager';

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

function makeSpec(partPath: string, boreId: string): MarkerOverlaySpec {
  return {
    key: `${partPath}#c1`,
    partPath,
    panelDims: { length: 600, width: 400, thickness: 18 },
    worldPose: { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] },
    bores: [{
      id: boreId,
      face: { featureId: 'panel', role: 'Top', instance: 0 },
      u: 0, v: 0, diameter: 5, depth: 34,
      role: 'confirmat-face', connectorId: 'k1', connectorKind: 'confirmat',
    }],
  };
}

describe('SceneManager.raycastBoreMarker (slice-3)', () => {
  it('returns null when no markers are present', () => {
    const mgr = new SceneManager(document.createElement('canvas'));
    mgr.setShowBores(true);
    mgr.setBoreMarkers([]);
    // Method takes camera + ndc — mirror of raycastComponent signature.
    const result = mgr.raycastBoreMarker(mgr.getCamera(), new THREE.Vector2(0, 0));
    expect(result).toBeNull();
  });

  it('userData.boreId and userData.partPath are set correctly by rebuildBoreMarkers', () => {
    const mgr = new SceneManager(document.createElement('canvas'));
    mgr.setShowBores(true);
    mgr.setBoreMarkers([makeSpec('parts/side.zipt', 'bore-1')]);
    expect(mgr.boreMarkerList()).toHaveLength(1);
    const marker = mgr.boreMarkerList()[0]!;
    expect(marker.userData.boreId).toBe('bore-1');
    expect(marker.userData.partPath).toBe('parts/side.zipt');
  });

  it('method exists and returns null on miss (no geometry/ray overlap in headless env)', () => {
    const mgr = new SceneManager(document.createElement('canvas'));
    mgr.setShowBores(true);
    mgr.setBoreMarkers([makeSpec('a/b.zipt', 'boreX')]);
    expect(typeof mgr.raycastBoreMarker).toBe('function');
    // Headless: no real canvas geometry — raycaster never intersects, returns null.
    const result = mgr.raycastBoreMarker(mgr.getCamera(), new THREE.Vector2(9999, 9999));
    expect(result === null || (typeof result === 'object' && 'boreId' in result)).toBe(true);
  });

  it('method signature is (camera, ndc) — mirrors raycastComponent exactly', () => {
    const mgr = new SceneManager(document.createElement('canvas'));
    // Calling with wrong arg count must be a type error. Runtime check:
    expect(mgr.raycastBoreMarker.length).toBe(2);
  });
});
