// packages/app/src/drawing/__tests__/DrawingCanvas.angular.spec.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { DrawingCanvas } from '../DrawingCanvas';
import { useAppStore } from '../../store/useAppStore';
import { useToolModeStore } from '../toolMode';

const edge1Id = 'e-ang-1';
const edge2Id = 'e-ang-2';
const viewId = 'v-ang-test';

const minimalDrawing = {
  id: 'drw-angular',
  name: 'Angular Drawing',
  units: 'mm' as const,
  source: { partPath: 'part.zipt', sourceKind: 'part' as const },
  properties: {},
  sheets: [{
    id: 'sheet-a',
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
          { id: edge1Id, kind: 'outline' as const, points: [[0, 0], [30, 0]] as readonly (readonly [number, number])[] },
          { id: edge2Id, kind: 'outline' as const, points: [[0, 0], [0, 30]] as readonly (readonly [number, number])[] },
        ],
        hiddenEdges: [],
        bbox: { minX: 0, minY: 0, maxX: 30, maxY: 30 },
      },
      inputFingerprint: 'fp-a',
    }],
    dimensions: [],
    dimensionGroups: [],
    annotations: [],
    titleBlock: {},
  }],
  activeSheetId: 'sheet-a',
};

const mockBus = { execute: vi.fn().mockResolvedValue(undefined) };

describe('DrawingCanvas — angular session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToolModeStore.getState().setMode('angular');
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: minimalDrawing as never },
      activeDrawing: minimalDrawing as never,
      bus: mockBus as never,
    } as never, false);
  });

  it('two-edges: dispatches AddAngularDimCommand after two line edge clicks', () => {
    const { container } = render(<DrawingCanvas />);
    const edge1El = container.querySelector(`[data-edge-id="${edge1Id}"]`);
    const edge2El = container.querySelector(`[data-edge-id="${edge2Id}"]`);
    expect(edge1El).not.toBeNull();
    expect(edge2El).not.toBeNull();

    // First click: pick edge 1 (line) — should NOT dispatch yet
    fireEvent.click(edge1El!, { bubbles: true, clientX: 10, clientY: 10 });
    expect(mockBus.execute).not.toHaveBeenCalled();

    // Second click: pick edge 2 (line) — dispatches AddAngularDimCommand
    fireEvent.click(edge2El!, { bubbles: true, clientX: 10, clientY: 10 });
    expect(mockBus.execute).toHaveBeenCalledTimes(1);
    const [cmd] = mockBus.execute.mock.calls[0] as [{ constructor: { name: string } }];
    expect(cmd.constructor.name).toBe('AddAngularDimCommand');
  });

  it('arc: dispatches AddAngularDimCommand immediately on arc-kind click', () => {
    const { container } = render(<DrawingCanvas />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();

    // Inject a synthetic arc edge element into the SVG for testing the arc shortcut
    // (ViewElement does not currently emit data-edge-kind="arc" for visible edges,
    //  so we need to simulate the attribute manually in tests)
    const arcEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    arcEl.setAttribute('data-edge-id', 'e-arc-synthetic');
    arcEl.setAttribute('data-view-id', viewId);
    arcEl.setAttribute('data-edge-kind', 'arc');
    svg!.appendChild(arcEl);

    // Fire click — React's synthetic onClick fires on the SVG but target is arcEl
    // We fire directly on arcEl which bubbles up to the svg onClick
    fireEvent.click(arcEl, { bubbles: true, clientX: 5, clientY: 5 });

    svg!.removeChild(arcEl);

    expect(mockBus.execute).toHaveBeenCalledTimes(1);
    const [cmd] = mockBus.execute.mock.calls[0] as [{ constructor: { name: string } }];
    expect(cmd.constructor.name).toBe('AddAngularDimCommand');
  });
});
