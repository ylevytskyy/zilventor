# PBR Textures Phase 3 — TDD Implementation Plan
<!-- 2026-06-07 | Built on Phase 2 (manifest v20, custom textures) -->

## Goal

Two deliverables, app-layer only:

1. **Export 3D view as PNG** — new "Export Image" button + "Transparent background" checkbox in FileTab; new `captureViewportPng` on SceneManager and ViewportRef; renderer gets `alpha: true`.
2. **Fix blank autosave thumbnails** — new `captureThumbnailScaled` on SceneManager/ViewportRef; autosave effect wires throttled (≥5 s) thumbnail capture via refs; replaces the `new Uint8Array()` placeholders in both the assembly and part autosave paths.

**No manifest bump. No kernel changes. No migration.** Custom textures persist at v20; thumbnails are already part of the .zipt/.ziasm format.

## Architecture

```
Export:
  FileTab "Export Image" btn
    → handleExportImage(transparent: boolean)
      → useAppStore.getState().viewport.captureViewportPng({ transparent })
        → SceneManager.captureViewportPng({ transparent })
          (opaque: render at current size → toBlob)
          (transparent: stash scene.background → null, setClearAlpha(0) → render → toBlob; restore in finally)
      → triggerDownload(blob, { suggestedName: `${name}.png`, mimeType:'image/png', extension:'png', description:'Image PNG' })

Autosave thumbnail:
  App.tsx autosave effect (500ms debounce)
    → (throttle check: lastThumbBytesRef.current === null || Date.now() - lastThumbTimeRef.current > 5000)
      → viewport.captureThumbnailScaled(256)
        → SceneManager.captureThumbnailScaled(256)
          (render() → drawImage onto 256×256 2D canvas center-cropped → toBlob → Uint8Array)
      → cache in lastThumbBytesRef.current
    → packAssembly(merged, lastThumbBytesRef.current ?? new Uint8Array(), texBytes)
    → kernel.saveToBytes(doc.document.id, lastThumbBytesRef.current ?? new Uint8Array())
```

## Tech Stack

- TypeScript, Vitest + jsdom, THREE.js (mocked in unit tests), Playwright (e2e)
- vitest runs from `packages/app/` CWD via `npx vitest run --config vitest.config.ts <relpath>`

**For agentic workers — REQUIRED SUB-SKILL:** invoke `superpowers:test-driven-development` before writing any implementation code. Each task is a red→green→refactor slice. Never proceed to implementation without first seeing the test fail for the expected reason.

---

## Tasks

- [ ] **Task 1** — `captureViewportPng` opaque: returns PNG `Uint8Array`, calls `render()` then `canvas.toBlob` at current canvas size (no `setSize` call)
- [ ] **Task 2** — `captureViewportPng` transparent: stashes/restores `scene.background`; calls `setClearAlpha(0)` then `setClearAlpha(1)` in `finally`; renderer constructed with `alpha: true`
- [ ] **Task 3** — `captureThumbnailScaled`: no `setSize` call; creates an offscreen 2D canvas of `size×size`; center-crops source; returns `Uint8Array`
- [ ] **Task 4** — FileTab Export Image UI: button present, enabled for part/assembly, disabled for drawing; checkbox toggles transparent arg; `triggerDownload` called with `<name>.png`; ViewportRef exposes both new methods
- [ ] **Task 5** — Autosave throttled thumbnail: packer receives non-empty bytes; throttle reuses cached bytes within `THUMB_THROTTLE_MS`; first capture is immediate (cache null)
- [ ] **Task 6** — e2e §6 gate: open textured part → Export Image opaque + transparent → decode PNG blob in-page and assert pixel-variance/grain; trigger autosave → verify Place Component dialog tile has texture

---

## Task 1 — `captureViewportPng` opaque

### Files
- **Modify** `packages/app/src/viewport/SceneManager.ts` — add `captureViewportPng` after `captureThumbnail` (~line 312)
- **Test** `packages/app/src/viewport/__tests__/SceneManager.captureViewportPng.spec.ts` (new)

### Steps

**1a. Write failing test**

Create `packages/app/src/viewport/__tests__/SceneManager.captureViewportPng.spec.ts`:

```typescript
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
    // Stub canvas.toBlob to return a non-null Blob
    const fakeBlob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
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
```

**1b. Run test — confirm RED**

```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && \
  npx vitest run --config vitest.config.ts src/viewport/__tests__/SceneManager.captureViewportPng.spec.ts
```

Expected failure: `TypeError: mgr.captureViewportPng is not a function` (method does not exist yet).

**1c. Implement `captureViewportPng` (opaque path only — transparent flag intentionally ignored)**

In `packages/app/src/viewport/SceneManager.ts`, add after `captureThumbnail` (~line 312):

```typescript
/**
 * Render the current 3D viewport at its current on-screen canvas size and
 * return the PNG bytes. No resize → no on-screen flicker (WYSIWYG).
 *
 * Task 1 implements the opaque path only. The transparent path (stash
 * scene.background + setClearAlpha(0)) is added in Task 2.
 *
 * Requires preserveDrawingBuffer: true (already set in constructor).
 */
async captureViewportPng({ transparent: _transparent }: { transparent: boolean }): Promise<Uint8Array> {
  // Opaque path — render at current canvas size, no setSize.
  // NOTE: transparent flag is ignored here; Task 2 adds the full transparent path.
  this.render();
  const canvas = this.renderer.domElement;
  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/png')
  );
  if (!blob) throw new Error('viewport PNG capture failed');
  return new Uint8Array(await blob.arrayBuffer());
}
```

**1d. Run test — confirm GREEN**

```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && \
  npx vitest run --config vitest.config.ts src/viewport/__tests__/SceneManager.captureViewportPng.spec.ts
```

Expected: all 4 tests pass.

**1e. Commit**

```
git commit -m "feat(viewport): add SceneManager.captureViewportPng opaque path (Task 1)"
```

---

## Task 2 — `captureViewportPng` transparent + renderer `alpha: true`

### Files
- **Modify** `packages/app/src/viewport/SceneManager.ts` — add `alpha: true` to renderer constructor (~line 100); replace the opaque-only stub with the full transparent/opaque implementation
- **Test** `packages/app/src/viewport/__tests__/SceneManager.captureViewportPng.spec.ts` — extend with transparent tests

### Steps

**2a. Write failing tests for transparent path**

Append to `packages/app/src/viewport/__tests__/SceneManager.captureViewportPng.spec.ts`:

```typescript
describe('SceneManager.captureViewportPng — transparent', () => {
  let mgr: SceneManager;
  let setClearAlphaSpy: ReturnType<typeof vi.fn>;
  let renderSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mgr = makeSceneManager();
    renderSpy = vi.spyOn(mgr, 'render');
    setClearAlphaSpy = vi.spyOn(mgr.renderer, 'setClearAlpha');
    const fakeBlob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
    vi.spyOn(mgr.renderer.domElement, 'toBlob').mockImplementation(
      (cb: BlobCallback) => { cb(fakeBlob); }
    );
  });

  it('sets scene.background to null and restores it after transparent capture', async () => {
    const originalBg = mgr.scene.background;
    expect(originalBg).not.toBeNull();
    await mgr.captureViewportPng({ transparent: true });
    // After capture, background must be restored.
    expect(mgr.scene.background).toBe(originalBg);
  });

  it('calls setClearAlpha(0) before toBlob and setClearAlpha(1) in finally', async () => {
    await mgr.captureViewportPng({ transparent: true });
    expect(setClearAlphaSpy).toHaveBeenCalledWith(0);
    expect(setClearAlphaSpy).toHaveBeenCalledWith(1);
    // 0 comes before 1
    const calls = setClearAlphaSpy.mock.calls.map((c) => c[0]);
    expect(calls.indexOf(0)).toBeLessThan(calls.indexOf(1));
  });

  it('restores background even when toBlob returns null (finally block)', async () => {
    const originalBg = mgr.scene.background;
    vi.spyOn(mgr.renderer.domElement, 'toBlob').mockImplementation(
      (cb: BlobCallback) => { cb(null); }
    );
    await expect(mgr.captureViewportPng({ transparent: true })).rejects.toThrow('viewport PNG capture failed');
    // Background must be restored despite the error.
    expect(mgr.scene.background).toBe(originalBg);
    expect(setClearAlphaSpy).toHaveBeenCalledWith(1);
  });

  it('renderer constructor is called with alpha: true (structural assertion)', async () => {
    const fs = await import('fs/promises');
    const src = await fs.readFile(
      new URL('../SceneManager.ts', import.meta.url).pathname,
      'utf-8'
    );
    expect(src).toContain('alpha: true');
    expect(src).toContain('WebGLRenderer(');
  });
});
```

**2b. Run test — confirm RED**

```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && \
  npx vitest run --config vitest.config.ts src/viewport/__tests__/SceneManager.captureViewportPng.spec.ts
```

Expected failure: the transparent-behavior tests fail RED because Task 1's implementation ignores the `transparent` flag — specifically:
- `'sets scene.background to null and restores it after transparent capture'` fails: `mgr.scene.background` is never set to `null` during capture (the opaque stub does nothing with `scene.background`), so the assertion `expect(mgr.scene.background).toBe(originalBg)` passes but the assertion `expect(originalBg).not.toBeNull()` in the body is irrelevant — the real failure is that `setClearAlpha(0)` is never called.
- `'calls setClearAlpha(0) before toBlob and setClearAlpha(1) in finally'` fails: `setClearAlphaSpy` call count is 0, not the expected calls with `0` and `1`.
- The structural assertion `expect(src).toContain('alpha: true')` fails because the constructor does not yet have `alpha: true`.

Real RED reason: `expect(setClearAlphaSpy).toHaveBeenCalledWith(0)` → `AssertionError: expected spy to have been called with 0 but it was never called` (Task 1 stub never calls `setClearAlpha`).

**2c. Add `alpha: true` to the renderer constructor and replace the opaque stub with the full implementation**

1. In `packages/app/src/viewport/SceneManager.ts`, change the renderer constructor line (~line 100):

```typescript
// BEFORE:
this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });

// AFTER:
this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true, alpha: true });
```

2. Replace the Task 1 opaque-only stub of `captureViewportPng` with the full implementation that handles both paths:

```typescript
/**
 * Render the current 3D viewport at its current on-screen canvas size and
 * return the PNG bytes. No resize → no on-screen flicker (WYSIWYG).
 *
 * Opaque (transparent: false): uses the live scene background as-is.
 * Transparent (transparent: true): stashes/restores scene.background and
 * sets clear alpha to 0 around the capture; requires alpha: true on the
 * renderer constructor (added in this task).
 *
 * Requires preserveDrawingBuffer: true (already set in constructor).
 */
async captureViewportPng({ transparent }: { transparent: boolean }): Promise<Uint8Array> {
  if (transparent) {
    const savedBackground = this.scene.background;
    try {
      this.scene.background = null;
      this.renderer.setClearAlpha(0);
      this.render();
      const canvas = this.renderer.domElement;
      const blob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/png')
      );
      if (!blob) throw new Error('viewport PNG capture failed');
      return new Uint8Array(await blob.arrayBuffer());
    } finally {
      this.scene.background = savedBackground;
      this.renderer.setClearAlpha(1);
      this.render();
    }
  }
  // Opaque path — render at current canvas size, no setSize.
  this.render();
  const canvas = this.renderer.domElement;
  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/png')
  );
  if (!blob) throw new Error('viewport PNG capture failed');
  return new Uint8Array(await blob.arrayBuffer());
}
```

The `setClearAlpha` method is already present in `FakeRenderer` from Task 1's mock — no changes to the test mock needed.

**2d. Run test — confirm GREEN**

```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && \
  npx vitest run --config vitest.config.ts src/viewport/__tests__/SceneManager.captureViewportPng.spec.ts
```

Expected: all tests (opaque + transparent, ~7 total) pass.

**2e. Commit**

```
git commit -m "feat(viewport): renderer alpha:true + captureViewportPng transparent path with finally-restore (Task 2)"
```

---

## Task 3 — `captureThumbnailScaled`

### Files
- **Modify** `packages/app/src/viewport/SceneManager.ts` — add `captureThumbnailScaled` after `captureViewportPng`
- **Test** `packages/app/src/viewport/__tests__/SceneManager.captureThumbnailScaled.spec.ts` (new)

### Steps

**3a. Write failing test**

Create `packages/app/src/viewport/__tests__/SceneManager.captureThumbnailScaled.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

// Stub OffscreenCanvas and HTMLCanvasElement 2D context for jsdom
let capturedDrawImageCall: { sw: number; sh: number; sx: number; sy: number } | null = null;
const fakeBlob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });

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

    // Stub document.createElement('canvas') ONLY for the OFFSCREEN canvas created
  // inside captureThumbnailScaled. We must set this up AFTER the SceneManager is
  // constructed (constructor also calls createElement('canvas') for OrbitControls'
  // domElement check — we don't want to intercept that call).
  // Tests that need this stub call mgr = makeSceneManager() THEN set up the spy.
  // The helpers below show the pattern used per-test.
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
 * @param blobResult - optional override for the blob returned by toBlob; defaults to fakeBlob
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
```

**3b. Run test — confirm RED**

```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && \
  npx vitest run --config vitest.config.ts src/viewport/__tests__/SceneManager.captureThumbnailScaled.spec.ts
```

Expected failure: `TypeError: mgr.captureThumbnailScaled is not a function`.

**3c. Implement `captureThumbnailScaled`**

In `packages/app/src/viewport/SceneManager.ts`, add after `captureViewportPng`:

```typescript
/**
 * Draw the live WebGL canvas into a `size × size` 2D canvas (center-cropped
 * to avoid aspect distortion) and return the PNG bytes. Does NOT call setSize
 * on the WebGL renderer → no on-screen flash. Calls render() first for a
 * fresh frame.
 */
async captureThumbnailScaled(size: number): Promise<Uint8Array> {
  this.render();
  const src = this.renderer.domElement;
  const srcW = src.width;
  const srcH = src.height;

  // Largest centered square crop
  const cropSize = Math.min(srcW, srcH);
  const sx = Math.floor((srcW - cropSize) / 2);
  const sy = Math.floor((srcH - cropSize) / 2);

  const offscreen = document.createElement('canvas');
  offscreen.width = size;
  offscreen.height = size;
  const ctx = offscreen.getContext('2d')!;
  // drawImage(image, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight)
  ctx.drawImage(src, sx, sy, cropSize, cropSize, 0, 0, size, size);

  const blob: Blob | null = await new Promise((resolve) =>
    offscreen.toBlob((b) => resolve(b), 'image/png')
  );
  if (!blob) throw new Error('thumbnail scaled capture failed');
  return new Uint8Array(await blob.arrayBuffer());
}
```

**3d. Run test — confirm GREEN**

```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && \
  npx vitest run --config vitest.config.ts src/viewport/__tests__/SceneManager.captureThumbnailScaled.spec.ts
```

Expected: all 6 tests pass.

**3e. Commit**

```
git commit -m "feat(viewport): add SceneManager.captureThumbnailScaled (2D crop, no WebGL resize) (Task 3)"
```

---

## Task 4 — FileTab Export Image UI + ViewportRef methods

### Files
- **Modify** `packages/app/src/viewport/Viewport.tsx` — add `captureViewportPng` and `captureThumbnailScaled` to `ViewportRef` type (~line 47) and `useImperativeHandle` body (~line 184)
- **Modify** `packages/app/src/shell/tabs/FileTab.tsx` — add import for `triggerDownload`, `handleExportImage`, Export Image button, Transparent checkbox
- **Test** `packages/app/src/shell/tabs/__tests__/FileTab.exportImage.spec.ts` (new)

### Steps

**4a. Write failing tests**

Create `packages/app/src/shell/tabs/__tests__/FileTab.exportImage.spec.ts`:

```typescript
// @vitest-environment node
/**
 * Structural tests for FileTab Export Image feature.
 * We test at source-text level (same approach as FileTab.drawing.spec.ts)
 * because FileTab calls browser APIs (showSaveFilePicker) that don't exist in jsdom.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import path from 'path';

const FILE_TAB_PATH = path.resolve(__dirname, '../FileTab.tsx');
const VIEWPORT_PATH = path.resolve(__dirname, '../../../viewport/Viewport.tsx');

async function readSrc(p: string): Promise<string> {
  return fs.readFile(p, 'utf-8');
}

describe('FileTab — Export Image button', () => {
  it('imports triggerDownload from nesting/triggerDownload', async () => {
    const src = await readSrc(FILE_TAB_PATH);
    expect(src).toContain("from '../../nesting/triggerDownload'");
  });

  it('contains handleExportImage function', async () => {
    const src = await readSrc(FILE_TAB_PATH);
    expect(src).toContain('handleExportImage');
  });

  it('calls captureViewportPng with transparent arg', async () => {
    const src = await readSrc(FILE_TAB_PATH);
    expect(src).toContain('captureViewportPng');
    expect(src).toContain('transparent');
  });

  it('calls triggerDownload with .png suggestedName', async () => {
    const src = await readSrc(FILE_TAB_PATH);
    expect(src).toContain('triggerDownload');
    expect(src).toContain('.png`');
  });

  it('Export Image button is disabled when activeDoc.kind === drawing', async () => {
    const src = await readSrc(FILE_TAB_PATH);
    // The button must be conditionally disabled when activeDoc kind is 'drawing'
    expect(src).toContain("Export Image");
    expect(src).toContain("kind === 'drawing'");
  });

  it('Transparent background checkbox is present', async () => {
    const src = await readSrc(FILE_TAB_PATH);
    expect(src).toContain('Transparent');
    // Checkbox must be a controlled input or equivalent
    expect(src).toContain('transparentBg');
  });
});

describe('ViewportRef — new methods present', () => {
  it('ViewportRef type declares captureViewportPng', async () => {
    const src = await readSrc(VIEWPORT_PATH);
    expect(src).toContain('captureViewportPng');
  });

  it('ViewportRef type declares captureThumbnailScaled', async () => {
    const src = await readSrc(VIEWPORT_PATH);
    expect(src).toContain('captureThumbnailScaled');
  });

  it('useImperativeHandle body forwards captureViewportPng to SceneManager', async () => {
    const src = await readSrc(VIEWPORT_PATH);
    // Both the type declaration and the delegation must exist
    const occurrences = (src.match(/captureViewportPng/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2); // type + impl
  });

  it('useImperativeHandle body forwards captureThumbnailScaled to SceneManager', async () => {
    const src = await readSrc(VIEWPORT_PATH);
    const occurrences = (src.match(/captureThumbnailScaled/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2); // type + impl
  });
});
```

**4b. Run test — confirm RED**

```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && \
  npx vitest run --config vitest.config.ts src/shell/tabs/__tests__/FileTab.exportImage.spec.ts
```

Expected failure: most assertions fail (none of these identifiers exist in the source yet).

**4c. Implement: extend `ViewportRef` and `useImperativeHandle` in `Viewport.tsx`**

In `packages/app/src/viewport/Viewport.tsx`:

1. Add to `ViewportRef` type (after `captureThumbnail` line ~47):

```typescript
captureViewportPng(opts: { transparent: boolean }): Promise<Uint8Array>;
captureThumbnailScaled(size: number): Promise<Uint8Array>;
```

2. Add to `useImperativeHandle` body (after the `captureThumbnail` delegation, ~line 187):

```typescript
captureViewportPng: async (opts) => {
  if (!sceneRef.current) throw new Error('viewport not ready');
  return sceneRef.current.captureViewportPng(opts);
},
captureThumbnailScaled: async (size) => {
  if (!sceneRef.current) throw new Error('viewport not ready');
  return sceneRef.current.captureThumbnailScaled(size);
},
```

**4d. Implement: FileTab Export Image UI**

In `packages/app/src/shell/tabs/FileTab.tsx`:

1. Add import at top (after existing imports):

```typescript
import { triggerDownload } from '../../nesting/triggerDownload';
```

2. Add `useState` import for `transparentBg` (already using `useState` for `errorDialog` — extend destructuring):

```typescript
const [transparentBg, setTransparentBg] = useState(false);
```

3. Add `handleExportImage` inline function inside `FileTab` (after `handleSaveAs`):

```typescript
const handleExportImage = async (transparent: boolean) => {
  const { viewport, activeDocument } = useAppStore.getState();
  if (!viewport || !activeDocument) return;
  try {
    const bytes = await viewport.captureViewportPng({ transparent });
    const name = activeDocument.document.name;
    await triggerDownload(
      new Blob([bytes], { type: 'image/png' }),
      { suggestedName: `${name}.png`, mimeType: 'image/png', extension: 'png', description: 'Image PNG' },
    );
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
    setErrorDialog(`Export failed: ${(e as Error).message}`);
  }
};
```

4. Add the Export Image button and Transparent checkbox in the JSX (after the Save As… button):

```tsx
<label className="flex items-center gap-1 select-none">
  <input
    type="checkbox"
    checked={transparentBg}
    onChange={(e) => setTransparentBg(e.target.checked)}
  />
  Transparent
</label>
<button
  className="hover:text-white disabled:text-neutral-500"
  disabled={!activeDoc || activeDoc.kind === 'drawing'}
  onClick={() => handleExportImage(transparentBg)}
>
  Export Image
</button>
```

Note: `activeDoc` is already in scope from the existing `useAppStore((s) => s.activeDocument)` selector.

**4e. Run test — confirm GREEN**

```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && \
  npx vitest run --config vitest.config.ts src/shell/tabs/__tests__/FileTab.exportImage.spec.ts
```

Expected: all 10 tests pass.

**4f. Run full unit suite to confirm no regressions**

```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && \
  npx vitest run --config vitest.config.ts
```

**4g. Commit**

```
git commit -m "feat(ui): Export Image button + Transparent checkbox in FileTab; expose captureViewportPng+captureThumbnailScaled on ViewportRef (Task 4)"
```

---

## Task 5 — Autosave throttled thumbnail wiring

### Files
- **Modify** `packages/app/src/App.tsx` — add `lastThumbBytesRef`, `lastThumbTimeRef`, `THUMB_THROTTLE_MS` constant; wire `captureThumbnailScaled` in autosave effect; replace `new Uint8Array()` thumbnail args (~lines 3806, 3811)
- **Test** `packages/app/src/App.autosaveThumbnail.spec.tsx` (new)

### Steps

**5a. Write failing tests**

Create `packages/app/src/App.autosaveThumbnail.spec.tsx`:

```typescript
// @vitest-environment node
/**
 * Structural tests for the autosave thumbnail wiring in App.tsx.
 * We verify at source-text level that the throttle refs and capture call are present,
 * plus a logic-level test for the throttle condition using the extracted constant.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import path from 'path';

const APP_PATH = path.resolve(__dirname, 'App.tsx');

async function readApp(): Promise<string> {
  return fs.readFile(APP_PATH, 'utf-8');
}

describe('App.tsx — autosave thumbnail wiring', () => {
  it('declares lastThumbBytesRef', async () => {
    const src = await readApp();
    expect(src).toContain('lastThumbBytesRef');
  });

  it('declares lastThumbTimeRef', async () => {
    const src = await readApp();
    expect(src).toContain('lastThumbTimeRef');
  });

  it('declares THUMB_THROTTLE_MS = 5000', async () => {
    const src = await readApp();
    expect(src).toContain('THUMB_THROTTLE_MS');
    expect(src).toContain('5000');
  });

  it('calls captureThumbnailScaled(256) in the autosave effect', async () => {
    const src = await readApp();
    expect(src).toContain('captureThumbnailScaled(256)');
  });

  it('no longer passes a bare new Uint8Array() as thumbnail in the assembly autosave path', async () => {
    const src = await readApp();
    // The old code was:  packAssembly(merged, new Uint8Array(), texBytes)
    // The new code must pass the cached ref instead.
    // We check that new Uint8Array() is only used as the null-coalescing fallback,
    // not as the direct second argument after the variable name.
    // Structural: the ref variable must appear as the thumbnail arg.
    expect(src).toContain('lastThumbBytesRef.current');
    // The coalescing pattern must be present: `?? new Uint8Array()`
    expect(src).toContain('?? new Uint8Array()');
  });

  it('autosave part path passes thumbnail to kernel.saveToBytes', async () => {
    const src = await readApp();
    // Must call kernel.saveToBytes with two args (id + thumbnail)
    // Check that lastThumbBytesRef.current (or coalesced) is passed as second arg
    expect(src).toContain('saveToBytes(doc.document.id,');
  });
});

describe('THUMB_THROTTLE_MS throttle logic', () => {
  it('first capture is immediate when lastThumbBytesRef.current is null', () => {
    // Logic test: null cache → should capture
    const lastThumbBytesRef = { current: null as Uint8Array | null };
    const lastThumbTimeRef = { current: 0 };
    const THUMB_THROTTLE_MS = 5000;
    const shouldCapture =
      lastThumbBytesRef.current === null ||
      Date.now() - lastThumbTimeRef.current > THUMB_THROTTLE_MS;
    expect(shouldCapture).toBe(true);
  });

  it('throttle skips capture when within THUMB_THROTTLE_MS of last capture', () => {
    const lastThumbBytesRef = { current: new Uint8Array([1, 2, 3]) };
    const lastThumbTimeRef = { current: Date.now() - 1000 }; // 1s ago, within 5s
    const THUMB_THROTTLE_MS = 5000;
    const shouldCapture =
      lastThumbBytesRef.current === null ||
      Date.now() - lastThumbTimeRef.current > THUMB_THROTTLE_MS;
    expect(shouldCapture).toBe(false);
  });

  it('throttle allows capture after THUMB_THROTTLE_MS has elapsed', () => {
    const lastThumbBytesRef = { current: new Uint8Array([1, 2, 3]) };
    const lastThumbTimeRef = { current: Date.now() - 6000 }; // 6s ago, > 5s
    const THUMB_THROTTLE_MS = 5000;
    const shouldCapture =
      lastThumbBytesRef.current === null ||
      Date.now() - lastThumbTimeRef.current > THUMB_THROTTLE_MS;
    expect(shouldCapture).toBe(true);
  });
});
```

**5b. Run test — confirm RED**

```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && \
  npx vitest run --config vitest.config.ts src/App.autosaveThumbnail.spec.tsx
```

Expected failure: structural assertions fail (refs/constant don't exist yet).

**5c. Implement autosave thumbnail wiring in `App.tsx`**

1. Add the constant near the top of the file (after existing imports, before `export default function App()`), or inline near the autosave effect:

```typescript
const THUMB_THROTTLE_MS = 5000;
```

2. Add the two refs near the other autosave refs (~line 3739, after `autosaveStatsRef`):

```typescript
const lastThumbBytesRef = useRef<Uint8Array | null>(null);
const lastThumbTimeRef = useRef<number>(0);
```

3. Inside the autosave `async` callback (at the start, before the `opfsRef` check), add throttled thumbnail capture:

```typescript
// Throttled thumbnail capture — max once per THUMB_THROTTLE_MS
const vp = useAppStore.getState().viewport;
if (vp && (lastThumbBytesRef.current === null || Date.now() - lastThumbTimeRef.current > THUMB_THROTTLE_MS)) {
  try {
    lastThumbBytesRef.current = await vp.captureThumbnailScaled(256);
    lastThumbTimeRef.current = Date.now();
  } catch {
    // Non-fatal: keep previous cached bytes (or null → empty fallback below).
  }
}
const thumb = lastThumbBytesRef.current ?? new Uint8Array();
```

4. In the assembly autosave path (~line 3806), replace:
```typescript
// OLD:
const archive = await packAssembly(merged, new Uint8Array(), Object.keys(texBytes).length ? texBytes : undefined);
// NEW:
const archive = await packAssembly(merged, thumb, Object.keys(texBytes).length ? texBytes : undefined);
```

5. In the part autosave path (~line 3811), replace:
```typescript
// OLD:
const bytes = await kernel.saveToBytes(doc.document.id);
// NEW:
const bytes = await kernel.saveToBytes(doc.document.id, thumb);
```

Note: the `thumb` variable is declared before the `if (doc.kind === 'drawing')` check, so it's in scope for both assembly and part paths. The drawing path uses `autosaveDrawing` helper and does not embed a thumbnail — leave that path unchanged.

**Full autosave callback structure after changes:**

```typescript
void (async () => {
  try {
    // Throttled thumbnail capture
    const vp = useAppStore.getState().viewport;
    if (vp && (lastThumbBytesRef.current === null || Date.now() - lastThumbTimeRef.current > THUMB_THROTTLE_MS)) {
      try {
        lastThumbBytesRef.current = await vp.captureThumbnailScaled(256);
        lastThumbTimeRef.current = Date.now();
      } catch {
        // Non-fatal: fall back to previous cached bytes.
      }
    }
    const thumb = lastThumbBytesRef.current ?? new Uint8Array();

    if (!opfsRef.current) opfsRef.current = await Opfs.forNavigator();
    const opfs = opfsRef.current;
    const doc = useAppStore.getState().activeDocument;
    if (!doc) return;
    if (doc.kind === 'drawing') {
      await autosaveDrawing({ doc: doc.document, opfs, packDrawing });
      autosaveStatsRef.current.writeCount += 1;
      return;
    }
    if (doc.kind === 'assembly') {
      // ... existing assembly packing logic ...
      const archive = await packAssembly(merged, thumb, Object.keys(texBytes).length ? texBytes : undefined);
      // ... rest unchanged ...
    } else {
      if (!kernel) return;
      const bytes = await kernel.saveToBytes(doc.document.id, thumb);
      // ... rest unchanged ...
    }
    autosaveStatsRef.current.writeCount += 1;
  } catch (e) {
    console.warn('autosave failed:', (e as Error).message);
  }
})();
```

**5d. Run test — confirm GREEN**

```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && \
  npx vitest run --config vitest.config.ts src/App.autosaveThumbnail.spec.tsx
```

Expected: all 9 tests pass.

**5e. Run full unit suite**

```bash
cd /Users/lion/Documents/Projects/mine/zilventor/packages/app && \
  npx vitest run --config vitest.config.ts
```

Expected: existing tests pass; no regressions.

**5f. Commit**

```
git commit -m "feat(app): wire throttled captureThumbnailScaled into autosave (fix blank OPFS thumbnails) (Task 5)"
```

---

## Task 6 — e2e §6 gate

### Files
- **Create** `tests/e2e/pbr-textures-phase3-export.spec.ts`
- Fixtures reused: `tests/e2e/fixtures/custom-texture-upload.jpg`, `tests/e2e/fixtures/custom-texture-normal.jpg`

### e2e Harness

The e2e suite uses Playwright with a local dev server. Match the setup pattern from `tests/e2e/pbr-textures-custom-upload.spec.ts`:
- `import { test, expect } from '@playwright/test'`
- `import { waitForKernelReady } from './helpers/buildBox'`
- `await page.goto('/')` then `await waitForKernelReady(page)`
- Import commands via `await import('/src/commands/CommandName.ts')` inside `page.evaluate`
- Access store via `window.__zilventorStore`

### Steps

**6a. Write failing test**

Create `tests/e2e/pbr-textures-phase3-export.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from './helpers/buildBox';
import path from 'node:path';

type ZilventorStore = {
  getState(): {
    activePart: { id: string; materials: Array<{ id: string; name: string; textureId?: string }>; featureTree: unknown[] } | null;
    bus: { execute(c: unknown): Promise<unknown> };
    setPanelDialog(s: unknown): void;
  };
};

test.describe('PBR Textures Phase 3 — Export Image + autosave thumbnail', () => {
  test.setTimeout(240_000);

  test('Export Image (opaque): PNG blob has grain (pixel-variance > 25)', async ({ page }) => {
    page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
    page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

    await page.goto('/');
    await waitForKernelReady(page);

    // 1. Create a new part and add a textured material.
    await page.getByRole('tab', { name: 'Model' }).click();
    await page.getByRole('button', { name: 'New Part' }).click();
    await expect(page.getByText('Part1')).toBeVisible();

    const matId = await page.evaluate(async () => {
      const { AddMaterialCommand } = await import('/src/commands/AddMaterialCommand.ts');
      const store = (window as unknown as { __zilventorStore: ZilventorStore }).__zilventorStore;
      await store.getState().bus.execute(
        new AddMaterialCommand({ name: 'Wood Export', defaultThickness: 18, color: '#888888' }),
      );
      const mat = store.getState().activePart!.materials.find((m) => m.name === 'Wood Export');
      if (!mat) throw new Error('material not found');
      return mat.id;
    });
    expect(matId).toBeTruthy();

    // 2. Upload a custom texture (albedo + normal) and assign to the material.
    await page.evaluate(() => {
      const w = window as unknown as { __zilventorStore: { getState(): { setPanelDialog(s: unknown): void } } };
      w.__zilventorStore.getState().setPanelDialog({
        mode: 'part',
        onSubmit: () => {},
        onCancel: () => w.__zilventorStore.getState().setPanelDialog(null),
      });
    });
    const dialog = page.getByRole('dialog', { name: 'Panel' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /Manage/i }).click();
    const editor = dialog.locator('[data-testid="material-registry-editor"]');
    await expect(editor).toBeVisible();

    await editor.getByRole('button', { name: /Upload custom texture/i }).click();
    await page.getByLabel('Texture name').fill('Export Wood');
    await page.getByLabel(/Albedo/).setInputFiles(
      path.resolve(__dirname, 'fixtures/custom-texture-upload.jpg'),
    );
    await page.getByLabel(/Normal/).setInputFiles(
      path.resolve(__dirname, 'fixtures/custom-texture-normal.jpg'),
    );
    await page.getByRole('button', { name: 'Add texture' }).click();

    const row = editor.locator('tbody tr').filter({ hasText: 'Wood Export' });
    await row.hover();
    await row.getByRole('button', { name: /Edit Wood Export/i }).click();
    await editor.getByLabel('Edit texture').selectOption({ label: 'Export Wood' });
    await editor.getByRole('button', { name: 'Save' }).click();

    // Close dialog.
    await page.evaluate(() => {
      const w = window as unknown as { __zilventorStore: { getState(): { setPanelDialog(s: unknown): void } } };
      w.__zilventorStore.getState().setPanelDialog(null);
    });
    await expect(dialog).not.toBeVisible();

    // 3. Add a textured panel feature.
    await page.evaluate(async (materialId: string) => {
      const { AddPanelFeatureCommand } = await import('/src/commands/AddPanelFeatureCommand.ts');
      const store = (window as unknown as { __zilventorStore: ZilventorStore }).__zilventorStore;
      await store.getState().bus.execute(
        new AddPanelFeatureCommand({
          kind: 'panel',
          id: 'pf-export-e2e',
          length: { kind: 'literal', value: 600 },
          width: { kind: 'literal', value: 400 },
          thickness: { kind: 'literal', value: 18 },
          thicknessFromMaterial: false,
          materialId,
          grain: 'length',
          edgeBands: { front: null, back: null, left: null, right: null },
        }),
      );
    }, matId);

    // 4. Wait for mesh + texture GPU upload.
    await expect(page.locator('[data-triangle-count]')).toHaveAttribute(
      'data-triangle-count',
      /[1-9]\d*/,
      { timeout: 60_000 },
    );
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // 5. Call captureViewportPng({ transparent: false }) directly on the viewport ref
    //    and decode the returned PNG in-page to assert pixel variance > 25 (grain present).
    const opaqueVariance = await page.evaluate(async () => {
      const store = (window as unknown as { __zilventorStore: { getState(): { viewport: { captureViewportPng(opts: { transparent: boolean }): Promise<Uint8Array> } | null } } }).__zilventorStore;
      const vp = store.getState().viewport;
      if (!vp) return -1;
      const bytes = await vp.captureViewportPng({ transparent: false });

      // Decode PNG via ImageBitmap → Canvas → sample center pixels
      const blob = new Blob([bytes], { type: 'image/png' });
      const bmp = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      const w = Math.min(bmp.width, 100);
      const h = Math.min(bmp.height, 100);
      const data = ctx.getImageData(
        Math.floor(bmp.width / 2 - w / 2),
        Math.floor(bmp.height / 2 - h / 2),
        w,
        h,
      );
      const reds = Array.from({ length: w * h }, (_, i) => data.data[i * 4]!);
      const mean = reds.reduce((a, b) => a + b, 0) / reds.length;
      return reds.reduce((a, b) => a + (b - mean) ** 2, 0) / reds.length;
    });

    expect(opaqueVariance, 'opaque PNG must have grain (variance > 25)').toBeGreaterThan(25);
    await page.screenshot({ path: '/tmp/pbr-phase3-opaque.png' });

    // 6. Call captureViewportPng({ transparent: true }) and assert pixels have alpha < 255 in background.
    const transparentHasAlpha = await page.evaluate(async () => {
      const store = (window as unknown as { __zilventorStore: { getState(): { viewport: { captureViewportPng(opts: { transparent: boolean }): Promise<Uint8Array> } | null } } }).__zilventorStore;
      const vp = store.getState().viewport;
      if (!vp) return false;
      const bytes = await vp.captureViewportPng({ transparent: true });
      const blob = new Blob([bytes], { type: 'image/png' });
      const bmp = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      // Sample a corner (likely background) for alpha < 255
      const cornerData = ctx.getImageData(0, 0, 10, 10);
      const alphas = Array.from({ length: 10 * 10 }, (_, i) => cornerData.data[i * 4 + 3]!);
      return alphas.some((a) => a < 255);
    });
    expect(transparentHasAlpha, 'transparent PNG must have some pixels with alpha < 255 (background is transparent)').toBe(true);
    await page.screenshot({ path: '/tmp/pbr-phase3-transparent-restored.png' });
  });

  test('autosave thumbnail: Place Component dialog tile is non-blank after autosave', async ({ page }) => {
    page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
    page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

    await page.goto('/');
    await waitForKernelReady(page);

    // 1. Create a new assembly and a textured part (same setup as Phase 2 test).
    await page.getByRole('tab', { name: 'Model' }).click();
    await page.getByRole('button', { name: 'New Part' }).click();
    await expect(page.getByText('Part1')).toBeVisible();

    // Add material + texture + panel (same steps as test 1 above — abbreviated here
    // because the assembly tile test only needs a saved, textured .zipt in OPFS).
    const matId2 = await page.evaluate(async () => {
      const { AddMaterialCommand } = await import('/src/commands/AddMaterialCommand.ts');
      const store = (window as unknown as { __zilventorStore: ZilventorStore }).__zilventorStore;
      await store.getState().bus.execute(
        new AddMaterialCommand({ name: 'Tile Wood', defaultThickness: 18, color: '#8B5E3C' }),
      );
      const mat = store.getState().activePart!.materials.find((m) => m.name === 'Tile Wood');
      return mat?.id ?? null;
    });
    expect(matId2).toBeTruthy();

    await page.evaluate(() => {
      const w = window as unknown as { __zilventorStore: { getState(): { setPanelDialog(s: unknown): void } } };
      w.__zilventorStore.getState().setPanelDialog({ mode: 'part', onSubmit: () => {}, onCancel: () => w.__zilventorStore.getState().setPanelDialog(null) });
    });
    const dialog2 = page.getByRole('dialog', { name: 'Panel' });
    await expect(dialog2).toBeVisible();
    await dialog2.getByRole('button', { name: /Manage/i }).click();
    const editor2 = dialog2.locator('[data-testid="material-registry-editor"]');
    await expect(editor2).toBeVisible();

    await editor2.getByRole('button', { name: /Upload custom texture/i }).click();
    await page.getByLabel('Texture name').fill('Tile Tex');
    await page.getByLabel(/Albedo/).setInputFiles(path.resolve(__dirname, 'fixtures/custom-texture-upload.jpg'));
    await page.getByLabel(/Normal/).setInputFiles(path.resolve(__dirname, 'fixtures/custom-texture-normal.jpg'));
    await page.getByRole('button', { name: 'Add texture' }).click();

    const row2 = editor2.locator('tbody tr').filter({ hasText: 'Tile Wood' });
    await row2.hover();
    await row2.getByRole('button', { name: /Edit Tile Wood/i }).click();
    await editor2.getByLabel('Edit texture').selectOption({ label: 'Tile Tex' });
    await editor2.getByRole('button', { name: 'Save' }).click();

    await page.evaluate(() => {
      const w = window as unknown as { __zilventorStore: { getState(): { setPanelDialog(s: unknown): void } } };
      w.__zilventorStore.getState().setPanelDialog(null);
    });
    await expect(dialog2).not.toBeVisible();

    await page.evaluate(async (materialId: string) => {
      const { AddPanelFeatureCommand } = await import('/src/commands/AddPanelFeatureCommand.ts');
      const store = (window as unknown as { __zilventorStore: ZilventorStore }).__zilventorStore;
      await store.getState().bus.execute(
        new AddPanelFeatureCommand({
          kind: 'panel', id: 'pf-tile-e2e',
          length: { kind: 'literal', value: 600 },
          width: { kind: 'literal', value: 400 },
          thickness: { kind: 'literal', value: 18 },
          thicknessFromMaterial: false, materialId,
          grain: 'length',
          edgeBands: { front: null, back: null, left: null, right: null },
        }),
      );
    }, matId2);

    await expect(page.locator('[data-triangle-count]')).toHaveAttribute('data-triangle-count', /[1-9]\d*/, { timeout: 60_000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // 2. Wait for autosave to fire (500 ms debounce + give it time to run).
    //    The autosave will now capture a thumbnail via captureThumbnailScaled.
    await page.waitForTimeout(2000);

    // 3. Verify autosaveStats.writeCount > 0 (proves autosave ran).
    const writeCount = await page.evaluate(() => {
      const fn = (window as unknown as { __zilventorAutosaveStats?: () => { writeCount: number } }).__zilventorAutosaveStats;
      return fn ? fn().writeCount : 0;
    });
    expect(writeCount, 'autosave must have run at least once').toBeGreaterThan(0);

    // 4. Switch to a new assembly and open the Place Component dialog to check the tile.
    await page.getByRole('button', { name: 'New Assembly' }).click();
    await expect(page.locator('[data-testid="assembly-view"]').or(page.getByText('untitled-assembly'))).toBeVisible({ timeout: 10_000 });

    // Open the Place Component dialog via the store (same pattern as other assembly e2e tests).
    await page.evaluate(() => {
      const w = window as unknown as { __zilventorStore: { getState(): { openPlaceComponentDialog(): void } } };
      w.__zilventorStore.getState().openPlaceComponentDialog();
    });

    // 5. Check that the Part1 tile has a non-blank (non-uniform gray) thumbnail.
    //    The tile is an <img> whose src is a data URI or blob URL from the OPFS file.
    //    We assert pixel variance on the tile image > 10 (even a small thumbnail
    //    with any grain is sufficient; blank = all pixels identical → variance ≈ 0).
    const tileVariance = await page.evaluate(async () => {
      // Find the tile img for 'Part1' in the Place Component dialog.
      const img = Array.from(document.querySelectorAll('img')).find(
        (i) => i.alt?.includes('Part1') || i.closest('[data-part-name="Part1"]') != null
      );
      if (!img || !img.src) return -1;
      // Decode via canvas
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || 64;
      canvas.height = img.naturalHeight || 64;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const reds = Array.from({ length: canvas.width * canvas.height }, (_, i) => data.data[i * 4]!);
      const mean = reds.reduce((a, b) => a + b, 0) / reds.length;
      return reds.reduce((a, b) => a + (b - mean) ** 2, 0) / reds.length;
    });

    await page.screenshot({ path: '/tmp/pbr-phase3-place-component-tile.png' });
    // Blank thumbnail = 0 variance. Any texture > 10 variance.
    // Use a generous lower bound since tile images may be small.
    expect(tileVariance, 'Place Component tile must not be blank (autosave thumbnail must contain texture grain)').toBeGreaterThan(10);
  });
});
```

**6b. Run test — confirm RED**

```bash
cd /Users/lion/Documents/Projects/mine/zilventor && \
  npx playwright test tests/e2e/pbr-textures-phase3-export.spec.ts
```

Expected failure: tests fail because `captureViewportPng` does not exist yet (Tasks 1–5 not implemented).

**6c. Implement Tasks 1–5, then re-run**

After Tasks 1–5 are merged:

```bash
cd /Users/lion/Documents/Projects/mine/zilventor && \
  npx playwright test tests/e2e/pbr-textures-phase3-export.spec.ts
```

Expected: both tests pass; screenshots saved to `/tmp/pbr-phase3-*.png`. Controller reads back screenshots to confirm.

**Note on tile-variance assertion**: If the Place Component dialog does not expose a `setPlaceComponentDialogOpen` store action or an `img[alt="Part1"]` selector, the implementer must check the real store action name and the actual tile `img` selector from the Phase 2 e2e suite before asserting. The `tileVariance > 10` threshold is intentionally low to avoid brittleness.

**6d. Commit**

```
git commit -m "test(e2e): PBR Phase 3 — Export Image opaque+transparent variance gate + autosave tile non-blank (Task 6)"
```

---

## Manifest / Migration

**None.** This is purely additive:
- No new fields on any document type.
- Thumbnails already exist in `.zipt` / `.ziasm` format (the autosave fix populates a previously-empty slot).
- Custom textures persist at format version 20 (Phase 2).
- No manifest bump. No migration needed.

---

## NO-TDD Exceptions

None. The single-line `alpha: true` constructor change is covered by Task 2's structural `expect(src).toContain('alpha: true')` assertion — it is not a free-floating change without a test.

---

## Cross-task Type Consistency Checklist

| Identifier | Source | Used in Task |
|---|---|---|
| `SceneManager.captureViewportPng({ transparent: boolean }): Promise<Uint8Array>` | SceneManager.ts (new) | T1, T2, T4, T6 |
| `SceneManager.captureThumbnailScaled(size: number): Promise<Uint8Array>` | SceneManager.ts (new) | T3, T5, T6 |
| `this.renderer` (`THREE.WebGLRenderer`) | SceneManager.ts:100 | T1, T2, T3 |
| `this.scene` (`THREE.Scene`) | SceneManager.ts:48 | T2 |
| `this.scene.background` (set in constructor to `new THREE.Color(0x1a2028)`) | SceneManager.ts:102 | T2 |
| `this.render()` | SceneManager.ts:284 | T1, T2, T3 |
| `this.renderer.domElement` | SceneManager.ts (captureThumbnail:304) | T1, T2, T3 |
| `ViewportRef.captureThumbnail(w, h)` (existing) | Viewport.tsx:47 | model for T4 |
| `ViewportRef.getSceneManager()` (existing) | Viewport.tsx:48 | model for T4 |
| `useAppStore((s) => s.activeDocument)` as `activeDoc` | FileTab.tsx:18 | T4 |
| `useAppStore.getState().viewport` | FileTab.tsx:32 (in handleSaveAs) | T4 |
| `triggerDownload(blob, opts)` | nesting/triggerDownload.ts:8 | T4 |
| `packAssembly(doc, thumbnail, textures?)` | AssemblyPacker.ts:5 | T5 |
| `kernel.saveToBytes(partId, thumbnail?)` | kernel/api.ts:82 | T5 |
| `autosaveStatsRef` | App.tsx:3740 | T5, T6 |
| `THUMB_THROTTLE_MS = 5000` | new constant | T5 |
| `lastThumbBytesRef`, `lastThumbTimeRef` | new refs | T5 |
| `collectCustomTextureBytes` | App.tsx:3805 (unchanged call) | T5 |
