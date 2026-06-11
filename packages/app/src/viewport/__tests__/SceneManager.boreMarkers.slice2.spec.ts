import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { SceneManager, type MarkerOverlaySpec } from '../SceneManager';
import type { BoreOp, BoreConnectorKind } from '@zilventor/shared';

// --- WebGL mock: verbatim from SceneManager.boreMarkers.spec.ts ---
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
// --- end mock ---

function makeSceneManager(): SceneManager {
  return new SceneManager(document.createElement('canvas'));
}

function shelfPinBore(i: number): BoreOp {
  return {
    id: `pin-col-front-${i}`,
    face: { featureId: 'panel', role: 'Top', instance: 0 },
    u: 64 + i * 32,
    v: 37,
    diameter: 5,
    depth: 13,
    role: 'shelfPin-system32',
    connectorId: 'pin-col-front',
    connectorKind: 'shelfPin',
  };
}

function hingeCupBore(i: number): BoreOp {
  return {
    id: `hinge-${i}`,
    face: { featureId: 'panel', role: 'Bottom', instance: 0 },
    u: 100 + i * 400,
    v: 21,
    diameter: 35,
    depth: 12,
    role: 'hingeCup',
    connectorId: `hinge-${i}`,
    connectorKind: 'hinge',
  };
}

function spec(bores: BoreOp[]): MarkerOverlaySpec {
  return {
    key: 'parts/side.zipt#0',
    partPath: 'parts/side.zipt',
    panelDims: { length: 720, width: 560, thickness: 16 },
    worldPose: { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] },
    bores,
  };
}

describe('SceneManager bore markers — slice-2 shelfPin/hinge kinds', () => {
  // Primary exhaustiveness guard: every BoreConnectorKind must have a color string.
  // The compile-time `satisfies Record<BoreConnectorKind,string>` on BORE_COLORS (Phase 1)
  // is the stronger lock; this runtime check is the secondary defense.
  it('every BoreConnectorKind has a non-empty color string in BORE_COLORS', () => {
    const kinds: BoreConnectorKind[] = ['confirmat', 'minifix', 'dowel', 'shelfPin', 'hinge'];
    for (const k of kinds) {
      expect(typeof SceneManager.BORE_COLORS[k]).toBe('string');
      expect(SceneManager.BORE_COLORS[k].length).toBeGreaterThan(0);
    }
  });

  it('setBoreMarkers with shelfPin+hinge bores does not throw on the new connectorKinds', () => {
    const sm = makeSceneManager();
    sm.setShowBores(true);
    const bores = [shelfPinBore(0), shelfPinBore(1), shelfPinBore(2), hingeCupBore(0), hingeCupBore(1)];
    expect(() => sm.setBoreMarkers([spec(bores)])).not.toThrow();
    // Marker count confirms each bore produced a marker (no silently-dropped kinds).
    expect(sm.boreMarkerCount()).toBe(bores.length);
  });
});
