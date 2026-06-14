/**
 * autosaveStatus.spec.tsx
 *
 * Verifies that autosave failures (including QuotaExceededError) surface in
 * the StatusBar indicator, and that the beforeunload guard fires when saveState
 * is not 'saved'.
 *
 * Harness follows App.spec.tsx conventions: same mocks for spawnKernel,
 * sketcherWorker, three.js, OrbitControls, and ResizeObserver.
 * The Opfs mock is overridden per-test to simulate write failures.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import App from '../App';
import { useAppStore } from '../store/useAppStore';
import type { AssemblyDocument, DrawingDocument } from '@zilventor/shared';

// ── kernel / worker mocks (same as App.spec.tsx) ────────────────────────────

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

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(global as unknown as { ResizeObserver: typeof MockResizeObserver }).ResizeObserver =
  MockResizeObserver;

// ── DrawingPacker mock — packDrawing returns a stub byte array ───────────────

vi.mock('../storage/DrawingPacker', () => ({
  packDrawing: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  unpackDrawing: vi.fn(),
}));

// ── Opfs mock — default succeeds; individual tests override write ────────────

// We keep a mutable ref so tests can override write() per-case.
let opfsWriteImpl: () => Promise<void> = async () => { /* success */ };

vi.mock('@zilventor/kernel/src/storage/Opfs', () => {
  class FakeOpfs {
    static async forNavigator(): Promise<FakeOpfs> {
      return new FakeOpfs();
    }
    async read(): Promise<Uint8Array> {
      throw new Error('ENOENT (mocked)');
    }
    async write(): Promise<void> {
      return opfsWriteImpl();
    }
    async exists(): Promise<boolean> {
      return false;
    }
    async list(): Promise<string[]> {
      return [];
    }
    async delete(): Promise<void> { /* swallow */ }
  }
  return { Opfs: FakeOpfs };
});

// ── helpers ──────────────────────────────────────────────────────────────────

/** Minimal AssemblyDocument — we use this rather than a PartDocument because
 *  the part autosave path short-circuits when kernel is null, so the write
 *  (and thus the error path) is never reached. The assembly path calls
 *  opfs.write directly without needing a kernel. */
function makeAsm(overrides: Partial<AssemblyDocument> = {}): AssemblyDocument {
  return {
    id: 'A1',
    name: 'TestAsm',
    units: 'mm',
    parameters: {},
    components: [],
    constraints: [],
    groundedComponentPaths: [],
    colors: {},
    bomItemNumbers: {},
    cutListItemNumbers: {},
    colorOverrides: {},
    properties: {},
    materials: [],
    hardware: [],
    ...overrides,
  } as unknown as AssemblyDocument;
}

/** Minimal DrawingDocument for seeding the drawing autosave path. */
function makeDrawingDoc(overrides: Partial<DrawingDocument> = {}): DrawingDocument {
  return {
    id: 'D1',
    name: 'TestDrawing',
    units: 'mm',
    source: { partPath: 'parts/test.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [],
    activeSheetId: '',
    ...overrides,
  } as DrawingDocument;
}

// Advance the 500 ms autosave debounce and flush all async microtasks.
// vi.advanceTimersByTimeAsync fires the setTimeout and awaits any pending
// microtasks/promises inside the callback before returning.
async function triggerAutosave() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('autosave status indicator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Reset store saveState to 'saved' before each test.
    useAppStore.setState({ saveState: 'saved' } as any);
    opfsWriteImpl = async () => { /* success */ };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('sets saveState to error and shows the save-error indicator when write throws QuotaExceededError', async () => {
    // Arrange: write will fail with QuotaExceededError.
    // We use an assembly doc because the part-save path short-circuits when kernel
    // is null (`if (!kernel) return`), so opfs.write is never reached for parts.
    opfsWriteImpl = async () => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    };

    render(<App />);

    // Seed an assembly document to trigger the autosave effect.
    const asm = makeAsm();
    act(() => {
      useAppStore.setState({
        activeDocument: { kind: 'assembly', document: asm },
        activeAssembly: asm,
        subAssemblyDocs: {},
      } as any);
    });

    // Advance past the 500 ms debounce and flush async work including the opfs.write.
    await triggerAutosave();

    // Assert (1): the store saveState transitioned to 'error'.
    expect(useAppStore.getState().saveState).toBe('error');

    // Assert (2): the statusMessage was set to the quota-full i18n text
    // ('Not saved — storage full' in English).
    expect(useAppStore.getState().statusMessage).toMatch(/Not saved — storage full/i);

    // Assert (3): the StatusBar renders the error indicator element.
    const indicator = document.querySelector('[data-testid="save-state-indicator"]');
    expect(indicator).toBeTruthy();
    expect(indicator?.textContent).toMatch(/Not saved|error/i);
  });

  it('sets saveState to error and stores the error message for generic write failures', async () => {
    opfsWriteImpl = async () => {
      throw new Error('disk I/O error');
    };

    render(<App />);

    const asm = makeAsm();
    act(() => {
      useAppStore.setState({
        activeDocument: { kind: 'assembly', document: asm },
        activeAssembly: asm,
        subAssemblyDocs: {},
      } as any);
    });

    await triggerAutosave();

    // The store saveState must be 'error' and the message must contain the error detail.
    expect(useAppStore.getState().saveState).toBe('error');
    expect(useAppStore.getState().statusMessage).toMatch(/Not saved — disk I\/O error/i);
  });

  it('StatusBar shows save-error indicator from store saveState directly', () => {
    render(<App />);

    act(() => {
      useAppStore.setState({ saveState: 'error' } as any);
    });

    // The StatusBar should render a save indicator for error state.
    // We look for the data-testid or any text that signals the error state.
    // (The indicator element carries data-testid="save-state-indicator")
    const indicator = document.querySelector('[data-testid="save-state-indicator"]');
    expect(indicator).toBeTruthy();
    expect(indicator?.textContent).toMatch(/Not saved|error/i);
  });

  it('StatusBar shows "Saved" indicator when saveState is saved', () => {
    render(<App />);

    act(() => {
      useAppStore.setState({ saveState: 'saved' } as any);
    });

    const indicator = document.querySelector('[data-testid="save-state-indicator"]');
    expect(indicator).toBeTruthy();
    expect(indicator?.textContent).toMatch(/Saved/i);
  });

  it('sets saveState to "saved" after a successful drawing autosave', async () => {
    // Arrange: drawing write succeeds (default opfsWriteImpl is a no-op success).
    render(<App />);

    // Seed a drawing document — this triggers the autosave debounce.
    const drawing = makeDrawingDoc();
    act(() => {
      useAppStore.setState({
        activeDocument: { kind: 'drawing', document: drawing },
      } as any);
    });

    // Advance past the 500 ms debounce and flush all async work.
    await triggerAutosave();

    // The drawing autosave path must transition saveState to 'saved', not leave
    // it stuck at 'saving'. This is the regression test for the bug where the
    // drawing branch returned early without calling setSaveState('saved').
    expect(useAppStore.getState().saveState).toBe('saved');
  });
});

describe('beforeunload guard', () => {
  beforeEach(() => {
    useAppStore.setState({ saveState: 'saved' } as any);
  });

  it('calls preventDefault on beforeunload when saveState is error', () => {
    render(<App />);

    act(() => {
      useAppStore.setState({ saveState: 'error' } as any);
    });

    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
    window.dispatchEvent(event);

    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it('calls preventDefault on beforeunload when saveState is saving', () => {
    render(<App />);

    act(() => {
      useAppStore.setState({ saveState: 'saving' } as any);
    });

    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
    window.dispatchEvent(event);

    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it('does NOT call preventDefault on beforeunload when saveState is saved', () => {
    render(<App />);

    act(() => {
      useAppStore.setState({ saveState: 'saved' } as any);
    });

    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
    window.dispatchEvent(event);

    expect(preventDefaultSpy).not.toHaveBeenCalled();
  });
});
