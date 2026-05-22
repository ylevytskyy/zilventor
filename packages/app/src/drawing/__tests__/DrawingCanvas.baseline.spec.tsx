// packages/app/src/drawing/__tests__/DrawingCanvas.baseline.spec.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { DrawingCanvas } from '../DrawingCanvas';
import { useAppStore } from '../../store/useAppStore';
import { useToolModeStore } from '../toolMode';

// Minimal drawing fixture with one base view + one visible edge.
const edgeId = 'e-baseline-test';
const viewId = 'v-baseline-test';

const minimalDrawing = {
  id: 'drw-baseline',
  name: 'Baseline Drawing',
  units: 'mm' as const,
  source: { partPath: 'part.zipt', sourceKind: 'part' as const },
  properties: {},
  sheets: [{
    id: 'sheet-b',
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
      inputFingerprint: 'fp-b',
    }],
    dimensions: [],
    dimensionGroups: [],
    annotations: [],
    titleBlock: {},
  }],
  activeSheetId: 'sheet-b',
};

const mockBus = { execute: vi.fn().mockResolvedValue(undefined) };

describe('DrawingCanvas — baseline session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToolModeStore.getState().setMode('baseline');
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: minimalDrawing as never },
      activeDrawing: minimalDrawing as never,
      bus: mockBus as never,
    } as never, false);
  });

  it('dispatches AddDimensionGroupCommand on first click (datum pick)', () => {
    const { container } = render(<DrawingCanvas />);
    // Click on the rendered edge element (has data-edge-id attribute)
    const edgeEl = container.querySelector(`[data-edge-id="${edgeId}"]`);
    expect(edgeEl).not.toBeNull();

    // Fire click on edge element — bubbles up to SVG onClick handler
    // clientX=10,clientY=10 puts us inside the view (positionMm={0,0} + 200×150 coarse bbox)
    fireEvent.click(edgeEl!, { bubbles: true, clientX: 10, clientY: 10 });

    expect(mockBus.execute).toHaveBeenCalledTimes(1);
    const [cmd] = mockBus.execute.mock.calls[0] as [{ constructor: { name: string } }];
    expect(cmd.constructor.name).toBe('AddDimensionGroupCommand');
  });

  it('dispatches AddBaselineMemberCommand on second click (member pick)', () => {
    const { container } = render(<DrawingCanvas />);
    const edgeEl = container.querySelector(`[data-edge-id="${edgeId}"]`);
    expect(edgeEl).not.toBeNull();

    // First click: datum pick → AddDimensionGroupCommand
    fireEvent.click(edgeEl!, { bubbles: true, clientX: 10, clientY: 10 });
    // Second click: member pick → AddBaselineMemberCommand (same edge is fine)
    fireEvent.click(edgeEl!, { bubbles: true, clientX: 10, clientY: 10 });

    expect(mockBus.execute).toHaveBeenCalledTimes(2);
    const [, cmd2] = mockBus.execute.mock.calls as [[unknown], [{ constructor: { name: string } }]];
    expect(cmd2[0].constructor.name).toBe('AddBaselineMemberCommand');
  });
});
