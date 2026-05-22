// packages/app/src/drawing/__tests__/DrawingCanvas.ordinate.spec.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { DrawingCanvas } from '../DrawingCanvas';
import { useAppStore } from '../../store/useAppStore';
import { useToolModeStore } from '../toolMode';

const edgeId = 'e-ordinate-test';
const viewId = 'v-ordinate-test';

const minimalDrawing = {
  id: 'drw-ordinate',
  name: 'Ordinate Drawing',
  units: 'mm' as const,
  source: { partPath: 'part.zipt', sourceKind: 'part' as const },
  properties: {},
  sheets: [{
    id: 'sheet-o',
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
        visibleEdges: [
          { id: edgeId, kind: 'outline' as const, points: [[-25, -15], [25, -15]] as readonly (readonly [number, number])[] },
          { id: 'e-member-o', kind: 'outline' as const, points: [[25, -15], [25, 15]] as readonly (readonly [number, number])[] },
        ],
        hiddenEdges: [],
        bbox: { minX: 0, minY: 0, maxX: 50, maxY: 30 },
      },
      inputFingerprint: 'fp-o',
    }],
    dimensions: [],
    dimensionGroups: [],
    annotations: [],
    titleBlock: {},
  }],
  activeSheetId: 'sheet-o',
};

const mockBus = { execute: vi.fn().mockResolvedValue(undefined) };

describe('DrawingCanvas — ordinate session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToolModeStore.getState().setMode('ordinate');
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: minimalDrawing as never },
      activeDrawing: minimalDrawing as never,
      bus: mockBus as never,
    } as never, false);
  });

  it('dispatches AddDimensionGroupCommand (kind ordinate) on origin pick', () => {
    const { container } = render(<DrawingCanvas />);
    const edgeEl = container.querySelector(`[data-edge-id="${edgeId}"]`);
    expect(edgeEl).not.toBeNull();

    fireEvent.click(edgeEl!, { bubbles: true, clientX: 10, clientY: 10 });

    expect(mockBus.execute).toHaveBeenCalledTimes(1);
    const [cmd] = mockBus.execute.mock.calls[0] as [{ constructor: { name: string } }];
    expect(cmd.constructor.name).toBe('AddDimensionGroupCommand');
  });

  it('dispatches AddOrdinateMemberCommand on member pick with axis inference', () => {
    const { container } = render(<DrawingCanvas />);
    const edgeEl = container.querySelector(`[data-edge-id="${edgeId}"]`);
    const memberEl = container.querySelector('[data-edge-id="e-member-o"]');
    expect(edgeEl).not.toBeNull();
    expect(memberEl).not.toBeNull();

    // Origin pick at (10, 10)
    fireEvent.click(edgeEl!, { bubbles: true, clientX: 10, clientY: 10 });
    // Member pick at (50, 12) — |dx|=40 > |dy|=2 → axis 'y'
    fireEvent.click(memberEl!, { bubbles: true, clientX: 50, clientY: 12 });

    expect(mockBus.execute).toHaveBeenCalledTimes(2);
    const [, cmd2] = mockBus.execute.mock.calls as [[unknown], [{ constructor: { name: string } }]];
    expect(cmd2[0].constructor.name).toBe('AddOrdinateMemberCommand');
  });
});
