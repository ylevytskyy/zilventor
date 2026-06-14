import { describe, it, expect, vi } from 'vitest';
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

function makeSpec(): MarkerOverlaySpec {
  return {
    key: 'parts/side.zipt#c1',
    partPath: 'parts/side.zipt',
    panelDims: { length: 600, width: 400, thickness: 18 },
    worldPose: { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] },
    bores: [{
      id: 'b42', face: { featureId: 'panel', role: 'Top', instance: 0 },
      u: 100, v: 50, diameter: 5, depth: 34,
      role: 'confirmat-face', connectorId: 'k1', connectorKind: 'confirmat',
    }],
  };
}

describe('SceneManager — MarkerOverlaySpec.partPath (slice-3)', () => {
  it('MarkerOverlaySpec type includes partPath (compile-time + runtime)', () => {
    const spec = makeSpec();
    // Fails at compile time if partPath is not in the type.
    expect(spec.partPath).toBe('parts/side.zipt');
  });

  it('rebuildBoreMarkers sets mesh.userData.partPath from spec.partPath', () => {
    const mgr = new SceneManager(document.createElement('canvas'));
    mgr.setShowBores(true);
    mgr.setBoreMarkers([makeSpec()]);
    const markers = mgr.boreMarkerList();
    expect(markers).toHaveLength(1);
    expect(markers[0]!.userData.partPath).toBe('parts/side.zipt');
  });

  it('mesh.userData.markerKey (existing key) is ALSO present alongside partPath', () => {
    const mgr = new SceneManager(document.createElement('canvas'));
    mgr.setShowBores(true);
    mgr.setBoreMarkers([makeSpec()]);
    const m = mgr.boreMarkerList()[0]!;
    // Both must co-exist — other code may still read markerKey.
    expect(m.userData.markerKey).toBe('parts/side.zipt#c1');
    expect(m.userData.partPath).toBe('parts/side.zipt');
  });

  it('mesh.userData.boreId is still set', () => {
    const mgr = new SceneManager(document.createElement('canvas'));
    mgr.setShowBores(true);
    mgr.setBoreMarkers([makeSpec()]);
    expect(mgr.boreMarkerList()[0]!.userData.boreId).toBe('b42');
  });
});
