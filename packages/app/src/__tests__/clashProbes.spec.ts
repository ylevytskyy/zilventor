/**
 * Tests that __zilventorClashCount and __zilventorClashResults are registered
 * by App.tsx's DEV useEffect and actually read from the store.
 *
 * Pattern mirrors perfProbe.spec.ts (and App.spec.tsx mocks) — render real App,
 * wait for effects, then call the window probes.  If the probe registration is
 * deleted from App.tsx, the "probe is defined" assertion fails immediately
 * (making this non-tautological, unlike the previous direct store read).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import App from '../App';
import { useAppStore } from '../store/useAppStore';
import type { ClashReportRow } from '@zilventor/shared';

// jsdom mocks — identical to perfProbe.spec.ts / App.spec.tsx

vi.mock('../kernel-client/KernelClient', () => ({
  spawnKernel: vi.fn().mockRejectedValue(new Error('mocked, skipping')),
}));

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
    inferFromSnaps: vi.fn(),
  })),
}));

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

type WindowWithProbes = typeof globalThis & {
  __zilventorClashCount?: () => number;
  __zilventorClashResults?: () => unknown[];
};

describe('clash window probes (SC-17)', () => {
  afterEach(() => {
    cleanup();
    delete (globalThis as WindowWithProbes).__zilventorClashCount;
    delete (globalThis as WindowWithProbes).__zilventorClashResults;
  });

  it('probes are registered after App mounts (non-tautological: deleting registration breaks this)', async () => {
    render(React.createElement(App));
    // Wait for App's useEffect to run (same pattern as perfProbe.spec.ts)
    await new Promise((r) => setTimeout(r, 200));

    const countFn = (globalThis as WindowWithProbes).__zilventorClashCount;
    const resultsFn = (globalThis as WindowWithProbes).__zilventorClashResults;

    expect(typeof countFn).toBe('function');
    expect(typeof resultsFn).toBe('function');
  });

  it('__zilventorClashCount returns 0 when clashRows is null', async () => {
    render(React.createElement(App));
    await new Promise((r) => setTimeout(r, 200));

    useAppStore.setState({ clashRows: null } as any);

    const countFn = (globalThis as WindowWithProbes).__zilventorClashCount!;
    expect(countFn()).toBe(0);
  });

  it('__zilventorClashCount returns correct count after store update', async () => {
    render(React.createElement(App));
    await new Promise((r) => setTimeout(r, 200));

    const row: ClashReportRow = {
      aPathKey: 'a', bPathKey: 'b',
      aPath: ['a'], bPath: ['b'],
      aName: 'A', bName: 'B',
      kind: 'interference', volume: 100,
    };
    useAppStore.setState({ clashRows: [row] } as any);

    const countFn = (globalThis as WindowWithProbes).__zilventorClashCount!;
    expect(countFn()).toBe(1);
  });

  it('__zilventorClashResults reflects store clashRows', async () => {
    render(React.createElement(App));
    await new Promise((r) => setTimeout(r, 200));

    const row: ClashReportRow = {
      aPathKey: 'x', bPathKey: 'y',
      aPath: ['x'], bPath: ['y'],
      aName: 'X', bName: 'Y',
      kind: 'clearance', distance: 0.5,
    };
    useAppStore.setState({ clashRows: [row] } as any);

    const resultsFn = (globalThis as WindowWithProbes).__zilventorClashResults!;
    const results = resultsFn();
    expect(results).toHaveLength(1);
    expect((results[0] as ClashReportRow).kind).toBe('clearance');
  });
});
