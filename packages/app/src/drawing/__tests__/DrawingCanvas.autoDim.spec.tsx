// packages/app/src/drawing/__tests__/DrawingCanvas.autoDim.spec.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { DrawingCanvas } from '../DrawingCanvas';
import { useAppStore } from '../../store/useAppStore';
import { useToolModeStore } from '../toolMode';
import type { DrawingDocument, DrawingSheet, BaseView } from '@zilventor/shared';

// Mock AutoDimCommand so we can capture execute calls without real logic
vi.mock('../../commands/AutoDimCommand', () => ({
  AutoDimCommand: vi.fn().mockImplementation((payload) => ({
    name: 'AutoDimCommand',
    payload,
  })),
}));

// Also mock AddBreakCommand to avoid unresolved imports in DrawingCanvas
vi.mock('../../commands/AddBreakCommand', () => ({
  AddBreakCommand: vi.fn().mockImplementation((payload) => ({
    name: 'AddBreakCommand',
    payload,
  })),
}));

function makeViewWithProjection(): BaseView {
  return {
    id: 'view1',
    kind: 'base',
    positionMm: { x: 10, y: 10 },
    scale: { numerator: 1, denominator: 1 },
    orientation: 'front',
    showHidden: false,
    projection: {
      visibleEdges: [
        {
          id: 'e1',
          kind: 'outline',
          points: [
            [0, 0],
            [50, 0],
            [50, 30],
            [0, 30],
            [0, 0],
          ] as ReadonlyArray<readonly [number, number]>,
        },
      ],
      hiddenEdges: [],
      bbox: { minX: 0, minY: 0, maxX: 50, maxY: 30 },
    },
    inputFingerprint: 'fp1',
  };
}

function makeSheet(): DrawingSheet {
  return {
    id: 's1',
    name: 'Sheet 1',
    size: { kind: 'iso', size: 'A3' },
    orientation: 'landscape',
    views: [makeViewWithProjection()],
    dimensions: [],
    annotations: [],
    titleBlock: {},
    dimensionGroups: [],
  };
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

describe('DrawingCanvas — autoDim mode click dispatch', () => {
  let mockExecute: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockExecute = vi.fn().mockResolvedValue(undefined);
    useToolModeStore.setState({ mode: 'idle' });
    useAppStore.setState({
      activeDrawing: makeDrawing(),
      bus: { execute: mockExecute },
    } as never);
  });

  it('HS-UI-2: clicking inside view bbox with mode=autoDim dispatches AutoDimCommand and resets to idle', () => {
    useToolModeStore.setState({ mode: 'autoDim' });
    const { container } = render(<DrawingCanvas />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();

    // Click at clientX=35, clientY=25 — inside view1's bbox.
    // view1 positionMm={10,10}, bbox maxX=50 → sheet X: 10..60, Y: 10..40
    // In JSDOM, getBoundingClientRect returns zeros so svgX = clientX, svgY = clientY.
    // The getViewAtPoint coarse hit-test checks: x >= posX && x <= posX + 200 && y >= posY && y <= posY + 150
    // At (35,25): 35 >= 10 && 35 <= 210 && 25 >= 10 && 25 <= 160 → HIT
    fireEvent.click(svg!, { clientX: 35, clientY: 25 });

    expect(mockExecute).toHaveBeenCalledOnce();
    const firstCall = mockExecute.mock.calls[0];
    expect(firstCall).toBeDefined();
    const cmdArg = firstCall![0] as { name: string; payload: { drawingId: string; sheetId: string; viewId: string } };
    expect(cmdArg.name).toBe('AutoDimCommand');
    expect(cmdArg.payload).toMatchObject({
      drawingId: 'd1',
      sheetId: 's1',
      viewId: 'view1',
    });

    expect(useToolModeStore.getState().mode).toBe('idle');
  });

  it('HS-UI-2b: clicking empty space (far outside view) with mode=autoDim does NOT dispatch and stays in autoDim', () => {
    useToolModeStore.setState({ mode: 'autoDim' });
    const { container } = render(<DrawingCanvas />);
    const svg = container.querySelector('svg');

    // Click at (500, 500) — far outside the coarse bbox (posX=10, posY=10 + 200×150 = up to 210×160)
    fireEvent.click(svg!, { clientX: 500, clientY: 500 });

    expect(mockExecute).not.toHaveBeenCalled();
    expect(useToolModeStore.getState().mode).toBe('autoDim');
  });
});
