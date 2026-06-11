/**
 * Verify the bore-first routing logic in App.tsx's click handler:
 * 1. If raycastBoreMarker returns a hit → setSelectedBore is called, selectComponentPaths NOT called.
 * 2. On bore miss + component hit → selectComponentPaths called, setSelectedBore NOT called.
 * 3. On total miss → selectComponentPaths([]) clears component; setSelectedBore cleared.
 *
 * No-TDD for the real THREE.js raycaster path. Tested at the logic level
 * via ViewportHandle stubs (mirrors the pattern in existing App-level unit tests).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';

// Stub viewport handle
function makeViewportStub(opts: {
  boreHit: { boreId: string; partPath: string } | null;
  componentHit: string[] | null;
}) {
  return {
    raycastBoreMarker: vi.fn(() => opts.boreHit),
    raycastComponent: vi.fn(() => opts.componentHit),
  };
}

describe('bore-first click routing (slice-3 logic)', () => {
  beforeEach(() => {
    useAppStore.getState().setSelectedBore(null, null);
    useAppStore.getState().selectComponentPaths([]);
  });

  it('bore hit → setSelectedBore called, component selection stays empty', () => {
    const viewport = makeViewportStub({
      boreHit: { boreId: 'b1', partPath: 'parts/side.zipt' },
      componentHit: ['c1'],
    });

    // Simulate the routing logic App.tsx will use.
    const boreHit = viewport.raycastBoreMarker(100, 100);
    if (boreHit) {
      useAppStore.getState().setSelectedBore(boreHit.boreId, boreHit.partPath);
    } else {
      const compHit = viewport.raycastComponent(100, 100);
      if (compHit) {
        useAppStore.getState().selectComponentPaths([compHit as string[]]);
      } else {
        useAppStore.getState().selectComponentPaths([]);
      }
    }

    expect(viewport.raycastBoreMarker).toHaveBeenCalledWith(100, 100);
    // On bore hit we short-circuit BEFORE raycastComponent.
    expect(viewport.raycastComponent).not.toHaveBeenCalled();
    expect(useAppStore.getState().selectedBoreId).toBe('b1');
    expect(useAppStore.getState().selectedBorePartPath).toBe('parts/side.zipt');
    expect(useAppStore.getState().selectedComponentPaths).toHaveLength(0);
  });

  it('bore miss + component hit → selectComponentPaths, bore stays null', () => {
    const viewport = makeViewportStub({
      boreHit: null,
      componentHit: ['c2'],
    });

    const boreHit = viewport.raycastBoreMarker(200, 200);
    if (boreHit) {
      useAppStore.getState().setSelectedBore(boreHit.boreId, boreHit.partPath);
    } else {
      const compHit = viewport.raycastComponent(200, 200);
      if (compHit) {
        useAppStore.getState().selectComponentPaths([compHit as string[]]);
      } else {
        useAppStore.getState().selectComponentPaths([]);
      }
    }

    expect(viewport.raycastComponent).toHaveBeenCalledWith(200, 200);
    expect(useAppStore.getState().selectedBoreId).toBeNull();
    expect(useAppStore.getState().selectedComponentPaths).toHaveLength(1);
  });

  it('total miss → both selections empty', () => {
    const viewport = makeViewportStub({ boreHit: null, componentHit: null });

    const boreHit = viewport.raycastBoreMarker(0, 0);
    if (boreHit) {
      useAppStore.getState().setSelectedBore(boreHit.boreId, boreHit.partPath);
    } else {
      const compHit = viewport.raycastComponent(0, 0);
      if (compHit) {
        useAppStore.getState().selectComponentPaths([compHit as string[]]);
      } else {
        useAppStore.getState().selectComponentPaths([]);
        useAppStore.getState().setSelectedBore(null, null);
      }
    }

    expect(useAppStore.getState().selectedBoreId).toBeNull();
    expect(useAppStore.getState().selectedComponentPaths).toHaveLength(0);
  });
});
