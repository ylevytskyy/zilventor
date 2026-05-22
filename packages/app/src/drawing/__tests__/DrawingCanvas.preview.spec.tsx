// packages/app/src/drawing/__tests__/DrawingCanvas.preview.spec.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { DrawingCanvas } from '../DrawingCanvas';
import { useAppStore } from '../../store/useAppStore';
import { useToolModeStore } from '../toolMode';

const viewId = 'v-preview-test';
const edgeId = 'e-preview-test';

const minimalDrawing = {
  id: 'drw-preview',
  name: 'Preview Drawing',
  units: 'mm' as const,
  source: { partPath: 'part.zipt', sourceKind: 'part' as const },
  properties: {},
  sheets: [{
    id: 'sheet-p',
    name: 'Sheet 1',
    size: { kind: 'iso' as const, size: 'A4' as const },
    orientation: 'landscape' as const,
    views: [{
      id: viewId,
      kind: 'base' as const,
      positionMm: { x: 0, y: 0 },
      scale: { numerator: 1, denominator: 1 },
      orientation: 'front',
      showHidden: false,
      projection: {
        visibleEdges: [{ id: edgeId, kind: 'outline' as const, points: [[-25, -15], [25, -15]] as readonly (readonly [number, number])[] }],
        hiddenEdges: [],
        bbox: { minX: 0, minY: 0, maxX: 50, maxY: 30 },
      },
      inputFingerprint: 'fp-p',
    }],
    dimensions: [],
    dimensionGroups: [],
    annotations: [],
    titleBlock: {},
  }],
  activeSheetId: 'sheet-p',
};

const mockBus = { execute: vi.fn().mockResolvedValue(undefined) };

describe('DrawingCanvas — F5 live preview overlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: minimalDrawing as never },
      activeDrawing: minimalDrawing as never,
      bus: mockBus as never,
    } as never, false);
  });

  it('baseline pick-members: shows dim-preview element on mouse move', () => {
    useToolModeStore.getState().setMode('baseline');
    const { container } = render(<DrawingCanvas />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();

    const edgeEl = container.querySelector(`[data-edge-id="${edgeId}"]`);
    expect(edgeEl).not.toBeNull();

    // First click to advance to pick-members
    fireEvent.click(edgeEl!, { bubbles: true, clientX: 10, clientY: 10 });

    // Mouse move to trigger preview
    fireEvent.mouseMove(svg!, { clientX: 50, clientY: 50 });

    const preview = container.querySelector('[data-role="dim-preview"]');
    expect(preview).not.toBeNull();
  });

  it('angular pick-edge-2: shows dim-preview arc after edge1 picked', () => {
    useToolModeStore.getState().setMode('angular');
    const { container } = render(<DrawingCanvas />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();

    const edgeEl = container.querySelector(`[data-edge-id="${edgeId}"]`);
    expect(edgeEl).not.toBeNull();

    // Pick edge1 (line) — advances to pick-edge-2
    fireEvent.click(edgeEl!, { bubbles: true, clientX: 10, clientY: 10 });

    // Mouse move
    fireEvent.mouseMove(svg!, { clientX: 80, clientY: 80 });

    const preview = container.querySelector('[data-role="dim-preview"]');
    expect(preview).not.toBeNull();
  });
});
