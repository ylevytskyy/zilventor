import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import App from '../App';

// --- jsdom mocks (mirrored from App.spec.tsx) ---

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

describe('__zilventorFingerprintPartStateMs (T63h)', () => {
  afterEach(() => {
    cleanup();
    delete (globalThis as { __zilventorFingerprintPartStateMs?: unknown }).__zilventorFingerprintPartStateMs;
  });

  it('probe is registered and returns p95 < 5ms for 20-feature synthetic part', async () => {
    render(React.createElement(App));
    await new Promise((r) => setTimeout(r, 200));
    const probe = (globalThis as {
      __zilventorFingerprintPartStateMs?: (n: number) => number;
    }).__zilventorFingerprintPartStateMs;
    expect(typeof probe).toBe('function');
    const p95 = probe!(30);
    expect(p95).toBeGreaterThanOrEqual(0);
    expect(p95).toBeLessThan(5);
  });
});

describe('__zilventorSectionCutMs stepped variant (F1.2 / T63d wiring)', () => {
  afterEach(() => {
    cleanup();
    delete (globalThis as { __zilventorSectionCutMs?: unknown }).__zilventorSectionCutMs;
  });

  it('probe accepts { mode: "stepped", segmentCount: 4 } and returns mode label', async () => {
    render(React.createElement(App));
    // Wait for the App effect to install the probe.
    await new Promise((r) => setTimeout(r, 200));
    const probe = (globalThis as {
      __zilventorSectionCutMs?: (
        n: number,
        opts: { mode: 'stepped'; segmentCount: number },
      ) => Promise<{ p95ms: number; mode: string }>;
    }).__zilventorSectionCutMs;
    expect(typeof probe).toBe('function');
    const result = await probe!(5, { mode: 'stepped', segmentCount: 4 });
    expect(result.mode).toBe('cut+stepped-project');
    expect(typeof result.p95ms).toBe('number');
    expect(result.p95ms).toBeGreaterThanOrEqual(0);
  });
});
