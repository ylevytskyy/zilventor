// packages/app/src/drawing/__tests__/DrawingCanvas.autoRegen.spec.tsx
//
// M3.2 Task 2 — auto-regen effect with attempted-ref guard
//
// Mock buildHandleRegenerate to spy on per-id dispatch calls without a real
// kernel projection. The real handleRegenerate calls buildHandleRegenerate(...),
// then calls the returned dispatcher with viewId. The mock short-circuits the
// dispatcher to a spy so we can assert call count + args.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { useAppStore } from '../../store/useAppStore';

// Mock the regenerate dispatcher so we observe per-id calls without a real kernel projection.
const regenSpy = vi.fn();
vi.mock('../handleRegenerateHelpers', async (orig) => {
  const actual = await orig<typeof import('../handleRegenerateHelpers')>();
  return { ...actual, buildHandleRegenerate: () => regenSpy };
});

import { DrawingCanvas } from '../DrawingCanvas';
import type { DrawingDocument, DrawingSheet } from '@zilventor/shared';

// A stale base view: has a projection + inputFingerprint 'old' that does NOT
// match the store's activeDrawingSourceFingerprint ('new').
// Shape mirrors computeStaleViewIds.spec.ts condition (b).
const STALE_VIEW_ID = 'v1';

function makeSheet(): DrawingSheet {
  return {
    id: 's1',
    name: 'Sheet 1',
    size: { kind: 'iso', size: 'A3' },
    orientation: 'landscape',
    views: [
      {
        id: STALE_VIEW_ID,
        kind: 'base' as const,
        positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 1 },
        orientation: 'front' as const,
        showHidden: false,
        inputFingerprint: 'old',
        projection: {
          visibleEdges: [],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
        },
      },
    ],
    dimensions: [],
    annotations: [],
    titleBlock: {},
    dimensionGroups: [],
  } as unknown as DrawingSheet;
}

function makeDrawing(): DrawingDocument {
  return {
    id: 'd1',
    name: 'Test Drawing',
    units: 'mm',
    source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [makeSheet()],
    activeSheetId: 's1',
  };
}

function seedStaleDrawing(autoRegen: boolean): void {
  // activeDrawingSourceFingerprint 'new' ≠ view inputFingerprint 'old' → stale
  useAppStore.setState({
    activeDrawing: makeDrawing(),
    activeDrawingSourceFingerprint: 'new',
    bus: { execute: vi.fn().mockResolvedValue(undefined) },
    autoRegen,
  } as never);
}

function renderCanvas() {
  return render(<DrawingCanvas />);
}

describe('DrawingCanvas auto-regen effect', () => {
  beforeEach(() => {
    regenSpy.mockClear();
    cleanup();
    // Clear localStorage so autoRegen default doesn't bleed across tests
    if (typeof localStorage !== 'undefined') localStorage.clear();
  });

  it('regenerates each stale view once when autoRegen is on', () => {
    seedStaleDrawing(true);
    renderCanvas();
    expect(regenSpy).toHaveBeenCalledTimes(1);
    expect(regenSpy).toHaveBeenCalledWith(STALE_VIEW_ID);
  });

  it('does NOT regenerate when autoRegen is off', () => {
    seedStaleDrawing(false);
    renderCanvas();
    expect(regenSpy).not.toHaveBeenCalled();
  });

  it('does not re-dispatch a still-stale view on re-render (attempted-ref guard)', () => {
    seedStaleDrawing(true);
    const { rerender } = renderCanvas();
    expect(regenSpy).toHaveBeenCalledTimes(1);
    // Force re-render with same props — guard must block second dispatch
    rerender(<DrawingCanvas />);
    expect(regenSpy).toHaveBeenCalledTimes(1);
  });

  it('re-dispatches after the source fingerprint changes (new episode resets the ref)', () => {
    seedStaleDrawing(true);
    renderCanvas();
    expect(regenSpy).toHaveBeenCalledTimes(1);
    // Change the source fingerprint — new episode; ref resets; view becomes stale again
    act(() => {
      useAppStore.setState({ activeDrawingSourceFingerprint: 'newer' } as never);
    });
    expect(regenSpy).toHaveBeenCalledTimes(2);
  });
});
