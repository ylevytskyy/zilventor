/**
 * kernelInitFailure.spec.tsx
 *
 * Verifies that when spawnKernel() rejects on first boot, the StatusBar shows
 * the kernel-failure message (not the perpetual "Loading CAD kernel…" string)
 * and a Retry button is present in the DOM.
 *
 * Harness follows App.spec.tsx / autosaveStatus.spec.tsx conventions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import App from '../App';
import { useAppStore } from '../store/useAppStore';

// ── kernel mock — rejects so we exercise the failure path ───────────────────

vi.mock('../kernel-client/KernelClient', () => ({
  spawnKernel: vi.fn().mockRejectedValue(new Error('WASM 404')),
}));

// ── sketcher worker mock ─────────────────────────────────────────────────────

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

// ── three.js / OrbitControls mocks (jsdom has no WebGL) ─────────────────────

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

// ── ResizeObserver stub ──────────────────────────────────────────────────────

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(global as unknown as { ResizeObserver: typeof MockResizeObserver }).ResizeObserver =
  MockResizeObserver;

// ── Opfs mock ────────────────────────────────────────────────────────────────

vi.mock('@zilventor/kernel/src/storage/Opfs', () => {
  class FakeOpfs {
    static async forNavigator(): Promise<FakeOpfs> {
      return new FakeOpfs();
    }
    async read(): Promise<Uint8Array> {
      throw new Error('ENOENT (mocked)');
    }
    async write(): Promise<void> { /* swallow */ }
    async exists(): Promise<boolean> { return false; }
    async list(): Promise<string[]> { return []; }
    async delete(): Promise<void> { /* swallow */ }
  }
  return { Opfs: FakeOpfs };
});

// ── tests ────────────────────────────────────────────────────────────────────

describe('kernel init failure', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Ensure kernelReady is false (default) before each test.
    useAppStore.setState({ kernelReady: false, statusMessage: 'Loading…' } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows the kernel-failed message in the StatusBar (not "Loading CAD kernel…")', async () => {
    render(<App />);

    // Let the bootstrap useEffect fire and the rejected spawnKernel promise settle.
    // Use a bounded timer advance (not runAllTimers — that hits the Viewport RAF loop).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    // The StatusBar must contain the failure text, not the loading placeholder.
    const statusBar = document.getElementById('region-statusbar');
    expect(statusBar).toBeTruthy();
    const text = statusBar!.textContent ?? '';

    // The English translation for kernelFailed is "Kernel failed: {{message}}"
    expect(text).toMatch(/Kernel failed/i);
    expect(text).not.toMatch(/Loading CAD kernel/i);
  });

  it('shows a Retry button in the StatusBar when the kernel failed', async () => {
    render(<App />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    // There must be a Retry affordance in the status bar region.
    const statusBar = document.getElementById('region-statusbar');
    expect(statusBar).toBeTruthy();

    // Look for a button with accessible text matching retry/повтор (en or uk).
    const retryButton = statusBar!.querySelector('button[data-testid="retry-kernel"]');
    expect(retryButton).toBeTruthy();
  });

  it('keeps kernel-failed state and Retry visible when the retry itself also fails', async () => {
    // spawnKernel rejects on every call (initial boot AND the retry).
    render(<App />);

    // Let the initial boot fail.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    const statusBar = document.getElementById('region-statusbar');
    expect(statusBar).toBeTruthy();

    // Confirm failure is shown before the retry.
    expect(statusBar!.textContent).toMatch(/Kernel failed/i);
    const retryButton = statusBar!.querySelector('button[data-testid="retry-kernel"]') as HTMLButtonElement | null;
    expect(retryButton).toBeTruthy();

    // Click Retry — spawnKernel still rejects.
    await act(async () => {
      fireEvent.click(retryButton!);
      await vi.advanceTimersByTimeAsync(200);
    });

    // After the failed retry, the UI must NOT have reverted to "Loading CAD kernel…"
    // and the Retry button must still be present.
    expect(statusBar!.textContent).toMatch(/Kernel failed/i);
    expect(statusBar!.textContent).not.toMatch(/Loading CAD kernel/i);
    const retryButtonAfter = statusBar!.querySelector('button[data-testid="retry-kernel"]');
    expect(retryButtonAfter).toBeTruthy();
  });
});
