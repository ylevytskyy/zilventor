import { describe, it, expect, beforeEach, vi } from 'vitest';
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
});
