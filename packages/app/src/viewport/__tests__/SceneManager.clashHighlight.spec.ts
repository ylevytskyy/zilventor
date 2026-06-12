/**
 * SC-17: setClashHighlight uses a red LineSegments child overlay (same pattern as
 * selection overlays) — approach (b) from SC-17 chosen because it composes cleanly
 * with the orange selection overlay (both are LineSegments children; different material
 * colors).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { SceneManager } from '../SceneManager';
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

function makeSceneManager(): SceneManager {
  const canvas = document.createElement('canvas');
  return new SceneManager(canvas);
}

describe('SceneManager.setClashHighlight', () => {
  let sm: SceneManager;

  beforeEach(() => {
    sm = makeSceneManager();
  });

  it('setClashHighlight([]) on empty componentMeshes is a no-op (no throw)', () => {
    expect(() => sm.setClashHighlight([])).not.toThrow();
  });

  it('after setClashHighlight with known keys, clashHighlightPathKeys() returns those keys', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    const key = pathKey(['A', 'B']);
    // Directly inject a mesh into the private componentMeshes map for testing.
    (sm as any).componentMeshes.set(key, mesh);

    sm.setClashHighlight([key]);

    expect(sm.clashHighlightPathKeys()).toContain(key);
  });

  it('calling setClashHighlight([]) clears all overlays', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    const key = pathKey(['A', 'B']);
    (sm as any).componentMeshes.set(key, mesh);
    sm.setClashHighlight([key]);
    expect(sm.clashHighlightPathKeys()).toHaveLength(1);

    sm.setClashHighlight([]);
    expect(sm.clashHighlightPathKeys()).toHaveLength(0);
  });

  it('re-running setClashHighlight replaces old highlights (SC-13(d))', () => {
    const meshA = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    const meshB = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    const keyA = pathKey(['A']);
    const keyB = pathKey(['B']);
    (sm as any).componentMeshes.set(keyA, meshA);
    (sm as any).componentMeshes.set(keyB, meshB);

    sm.setClashHighlight([keyA]);
    expect(sm.clashHighlightPathKeys()).toEqual([keyA]);

    sm.setClashHighlight([keyB]);
    expect(sm.clashHighlightPathKeys()).toEqual([keyB]);
    // A's overlay must have been removed (no stale red)
    expect(meshA.children.filter((c: any) => c.userData?.clashOverlay)).toHaveLength(0);
  });
});
