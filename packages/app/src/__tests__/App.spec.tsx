import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../App';
import { useAppStore } from '../store/useAppStore';
import type { AssemblyDocument } from '@zilventor/shared';
import { pathKey } from '@zilventor/shared';

// spawnKernel spins up a real Worker + OCCT WASM in production; that won't work
// under jsdom. Reject cleanly so App.tsx records a "Kernel failed" status and
// we can still assert the static layout renders.
vi.mock('../kernel-client/KernelClient', () => ({
  spawnKernel: vi.fn().mockRejectedValue(new Error('mocked, skipping'))
}));

// createSketcherWorkerApi spins up a real Worker that doesn't exist in jsdom.
vi.mock('../vendor/sketcherWorker', () => ({
  createSketcherWorkerApi: vi.fn(() => ({
    loadSketch: vi.fn().mockResolvedValue({ dof: null }),
    unloadSketch: vi.fn().mockResolvedValue(undefined),
    addPrimitive: vi.fn(),
    removePrimitive: vi.fn(),
    updatePrimitive: vi.fn(),
    addConstraint: vi.fn(),
    removeConstraint: vi.fn(),
    beginDrag: vi.fn(),
    dragTo: vi.fn(),
    endDrag: vi.fn(),
    inferFromSnaps: vi.fn()
  }))
}));

// jsdom has no navigator.storage.getDirectory; stub Opfs so the autosave +
// 4d dev-hook effects don't throw unhandled rejections.
vi.mock('@zilventor/kernel/src/storage/Opfs', () => {
  class FakeOpfs {
    static async forNavigator(): Promise<FakeOpfs> { return new FakeOpfs(); }
    async read(): Promise<Uint8Array> { throw new Error('ENOENT (mocked)'); }
    async write(): Promise<void> { /* swallow */ }
    async exists(): Promise<boolean> { return false; }
    async list(): Promise<string[]> { return []; }
    async delete(): Promise<void> { /* swallow */ }
  }
  return { Opfs: FakeOpfs };
});

// Viewport mounts three.js; jsdom has no WebGL. Mock the renderer + OrbitControls.
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

class MockResizeObserver { observe() {} unobserve() {} disconnect() {} }
(global as unknown as { ResizeObserver: typeof MockResizeObserver }).ResizeObserver = MockResizeObserver;

describe('App shell', () => {
  it('renders all six regions with stable IDs', () => {
    render(<App />);
    for (const id of ['region-appbar', 'region-ribbon', 'region-browser', 'region-viewport', 'region-properties', 'region-statusbar']) {
      expect(document.getElementById(id)).toBeTruthy();
    }
    expect(screen.getByText('ZilInventor')).toBeTruthy();
  });
});

describe('App 4d dev hooks (T33)', () => {
  function makeAsm(overrides: Partial<AssemblyDocument> = {}): AssemblyDocument {
    return {
      id: 'A', name: 'top', units: 'mm', parameters: {},
      components: [],
      constraints: [], groundedComponentPaths: [],
      colors: {}, bomItemNumbers: {}, colorOverrides: {}, properties: {}, materials: [],
      ...overrides,
    };
  }

  function seed(top: AssemblyDocument, subAsmDocs: Record<string, AssemblyDocument> = {}) {
    useAppStore.setState({
      activeDocument: { kind: 'assembly', document: top },
      activeAssembly: top,
      subAssemblyDocs: subAsmDocs,
    } as any);
  }

  it('exposes __zilventorSubAsmCacheGet returning the cached doc', () => {
    render(<App />);
    const sub = makeAsm({ id: 'S', name: 'drawer' });
    seed(makeAsm(), { 'drawer.ziasm': sub });
    const w = window as unknown as { __zilventorSubAsmCacheGet: (p: string) => AssemblyDocument | undefined };
    const fn = w.__zilventorSubAsmCacheGet;
    expect(typeof fn).toBe('function');
    expect(fn('drawer.ziasm')?.name).toBe('drawer');
    expect(fn('missing.ziasm')).toBeUndefined();
  });

  it('__zilventorComponentPathToLeafCount returns the descendant leaf count', () => {
    render(<App />);
    const sub = makeAsm({
      id: 'S', name: 'drawer',
      components: [
        { id: 'leaf-a', partPath: 'parts/cube.zipt',
          position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        { id: 'leaf-b', partPath: 'parts/cube.zipt',
          position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
    });
    const top = makeAsm({
      components: [
        { id: 'sub1', partPath: 'drawer.ziasm',
          position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        { id: 'leaf-c', partPath: 'parts/shelf.zipt',
          position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
    });
    seed(top, { 'drawer.ziasm': sub });
    const w = window as unknown as { __zilventorComponentPathToLeafCount: (p: string[]) => number };
    expect(w.__zilventorComponentPathToLeafCount(['sub1'])).toBe(2);
    expect(w.__zilventorComponentPathToLeafCount(['leaf-c'])).toBe(1);
    expect(w.__zilventorComponentPathToLeafCount(['nonexistent'])).toBe(0);
  });

  it('__zilventorComposedPoseFor returns the world pose for a leaf', () => {
    render(<App />);
    const sub = makeAsm({
      id: 'S', name: 'drawer',
      components: [
        { id: 'leaf', partPath: 'parts/cube.zipt',
          position: { x: 7, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
    });
    const top = makeAsm({
      components: [
        { id: 'sub1', partPath: 'drawer.ziasm',
          position: { x: 3, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
    });
    seed(top, { 'drawer.ziasm': sub });
    const w = window as unknown as { __zilventorComposedPoseFor: (p: string[]) => { translation: { x: number; y: number; z: number } } | undefined };
    const topPose = w.__zilventorComposedPoseFor(['sub1']);
    expect(topPose?.translation.x).toBeCloseTo(3);
    const leafPose = w.__zilventorComposedPoseFor(['sub1', 'leaf']);
    // 3 (parent) + 7 (local, no rotation) = 10
    expect(leafPose?.translation.x).toBeCloseTo(10);
    // pathKey is implicitly tested by the composed lookup chain
    expect(pathKey(['sub1', 'leaf'])).toMatch(/sub1/);
  });
});
