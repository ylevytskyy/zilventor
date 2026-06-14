import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

// Stub OffscreenCanvas and HTMLCanvasElement 2D context for jsdom
let capturedDrawImageCall: { sw: number; sh: number; sx: number; sy: number } | null = null;
const fakeBytes = new Uint8Array([137, 80, 78, 71]);
const fakeBlob = new Blob([fakeBytes], { type: 'image/png' }) as Blob & {
  arrayBuffer(): Promise<ArrayBuffer>;
};
fakeBlob.arrayBuffer = () => Promise.resolve(fakeBytes.buffer as ArrayBuffer);

// drawImage(image, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight) — 9-arg form
const fakeCtx = {
  drawImage: vi.fn((_img: unknown, sx: number, sy: number, sw: number, sh: number,
                   _dx: number, _dy: number, _dw: number, _dh: number) => {
    capturedDrawImageCall = { sw, sh, sx, sy };
  }),
};

beforeEach(() => {
  capturedDrawImageCall = null;
  fakeCtx.drawImage.mockClear();
});

// CRITICAL: restore all spies after each test so the document.createElement spy
// installed by installOffscreenCanvasSpy() does NOT leak into other spec files
// sharing the same vitest worker (this repo does NOT isolate document between files).
afterEach(() => {
  vi.restoreAllMocks();
});

function makeSceneManager(): SceneManager {
  // Create the canvas BEFORE installing any document.createElement spy so the
  // SceneManager's own canvas is a real jsdom canvas (not the mock offscreen one).
  const canvas = document.createElement('canvas');
  return new SceneManager(canvas);
}

/**
 * Install a document.createElement('canvas') spy AFTER the SceneManager has
 * been constructed. The spy intercepts the offscreen canvas created inside
 * captureThumbnailScaled, stubs its 2D context and toBlob.
 * @param blobOverride - optional override for the blob returned by toBlob; defaults to fakeBlob
 */
function installOffscreenCanvasSpy(blobOverride?: ((cb: BlobCallback) => void)): void {
  const origCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag === 'canvas') {
      const c = origCreateElement('canvas') as HTMLCanvasElement;
      vi.spyOn(c, 'getContext').mockImplementation((type: string) => {
        if (type === '2d') return fakeCtx as unknown as CanvasRenderingContext2D;
        return null;
      });
      const toBlobImpl = blobOverride ?? ((cb: BlobCallback) => { cb(fakeBlob); });
      vi.spyOn(c, 'toBlob').mockImplementation(toBlobImpl);
      return c;
    }
    return origCreateElement(tag);
  });
}

describe('SceneManager.captureThumbnailScaled', () => {
  it('returns a Uint8Array (PNG bytes)', async () => {
    const mgr = makeSceneManager();
    installOffscreenCanvasSpy();
    vi.spyOn(mgr, 'render');
    const result = await mgr.captureThumbnailScaled(256);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(0);
  });

  it('calls render() before drawing to the 2D canvas', async () => {
    const mgr = makeSceneManager();
    installOffscreenCanvasSpy();
    const renderSpy = vi.spyOn(mgr, 'render');
    await mgr.captureThumbnailScaled(256);
    expect(renderSpy).toHaveBeenCalled();
  });

  it('does NOT call renderer.setSize (no WebGL resize)', async () => {
    const mgr = makeSceneManager();
    installOffscreenCanvasSpy();
    const setSizeSpy = vi.spyOn(mgr.renderer, 'setSize');
    await mgr.captureThumbnailScaled(256);
    expect(setSizeSpy).not.toHaveBeenCalled();
  });

  it('center-crops a wider-than-tall source into a square drawImage call', async () => {
    const mgr = makeSceneManager();
    // Simulate a 800×400 canvas (wider than tall) by overriding domElement dimensions
    Object.defineProperty(mgr.renderer.domElement, 'width', { value: 800, configurable: true });
    Object.defineProperty(mgr.renderer.domElement, 'height', { value: 400, configurable: true });
    installOffscreenCanvasSpy();
    vi.spyOn(mgr, 'render');
    await mgr.captureThumbnailScaled(256);
    // Should crop to the largest centered square: 400×400 centered at x=(800-400)/2=200, y=0
    expect(capturedDrawImageCall).not.toBeNull();
    expect(capturedDrawImageCall!.sw).toBe(400); // cropSize = min(800,400) = 400
    expect(capturedDrawImageCall!.sh).toBe(400);
    expect(capturedDrawImageCall!.sx).toBe(200); // (800-400)/2
    expect(capturedDrawImageCall!.sy).toBe(0);
  });

  it('center-crops a taller-than-wide source', async () => {
    const mgr = makeSceneManager();
    Object.defineProperty(mgr.renderer.domElement, 'width', { value: 400, configurable: true });
    Object.defineProperty(mgr.renderer.domElement, 'height', { value: 800, configurable: true });
    installOffscreenCanvasSpy();
    vi.spyOn(mgr, 'render');
    await mgr.captureThumbnailScaled(256);
    // Largest centered square: 400×400 at x=0, y=(800-400)/2=200
    expect(capturedDrawImageCall!.sw).toBe(400);
    expect(capturedDrawImageCall!.sh).toBe(400);
    expect(capturedDrawImageCall!.sx).toBe(0);
    expect(capturedDrawImageCall!.sy).toBe(200);
  });

  it('throws when toBlob returns null', async () => {
    const mgr = makeSceneManager();
    // Install spy that returns null from toBlob
    installOffscreenCanvasSpy((cb: BlobCallback) => { cb(null); });
    vi.spyOn(mgr, 'render');
    await expect(mgr.captureThumbnailScaled(256)).rejects.toThrow('thumbnail scaled capture failed');
  });
});
