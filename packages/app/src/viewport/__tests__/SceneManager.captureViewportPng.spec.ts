import { describe, it, expect, vi, beforeEach } from 'vitest';
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
    setClearAlpha(_a: number) {}
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

describe('SceneManager.captureViewportPng — opaque', () => {
  let mgr: SceneManager;
  let renderSpy: ReturnType<typeof vi.fn>;
  let setSizeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mgr = makeSceneManager();
    renderSpy = vi.spyOn(mgr, 'render');
    setSizeSpy = vi.spyOn(mgr.renderer, 'setSize');
    // Stub canvas.toBlob to return a non-null Blob.
    // jsdom's Blob lacks .arrayBuffer() — patch it onto the fake instance.
    const fakeBytes = new Uint8Array([137, 80, 78, 71]);
    const fakeBlob = new Blob([fakeBytes], { type: 'image/png' }) as Blob & { arrayBuffer(): Promise<ArrayBuffer> };
    fakeBlob.arrayBuffer = () => Promise.resolve(fakeBytes.buffer as ArrayBuffer);
    vi.spyOn(mgr.renderer.domElement, 'toBlob').mockImplementation(
      (cb: BlobCallback) => { cb(fakeBlob); }
    );
  });

  it('returns a Uint8Array (PNG bytes) from captureViewportPng({ transparent: false })', async () => {
    const result = await mgr.captureViewportPng({ transparent: false });
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(0);
  });

  it('calls render() before toBlob for opaque capture', async () => {
    await mgr.captureViewportPng({ transparent: false });
    expect(renderSpy).toHaveBeenCalled();
  });

  it('does NOT call renderer.setSize for opaque capture (current canvas size, no resize)', async () => {
    await mgr.captureViewportPng({ transparent: false });
    expect(setSizeSpy).not.toHaveBeenCalled();
  });

  it('throws when toBlob returns null', async () => {
    vi.spyOn(mgr.renderer.domElement, 'toBlob').mockImplementation(
      (cb: BlobCallback) => { cb(null); }
    );
    await expect(mgr.captureViewportPng({ transparent: false })).rejects.toThrow('viewport PNG capture failed');
  });
});
