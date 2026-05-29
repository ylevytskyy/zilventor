// packages/app/src/drawing/__tests__/DrawingCanvas.radial.spec.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { DrawingCanvas } from '../DrawingCanvas';
import { useAppStore } from '../../store/useAppStore';
import { useToolModeStore } from '../toolMode';

// A circular edge: 8+ points approximating a circle arc (enough for circumcenter to work)
// Points trace a semicircle of radius 10 centred at (20, 20)
const circularEdgeId = 'e-radial-circle';
// A line edge (2 points only) — should be IGNORED by radial/diametric tools
const lineEdgeId = 'e-radial-line';
const viewId = 'v-radial-test';

function makeCirclePoints(cx: number, cy: number, r: number, n = 12): readonly (readonly [number, number])[] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * 2 * Math.PI;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

const circlePoints = makeCirclePoints(20, 20, 10);

const minimalDrawing = {
  id: 'drw-radial',
  name: 'Radial Drawing',
  units: 'mm' as const,
  source: { partPath: 'part.zipt', sourceKind: 'part' as const },
  properties: {},
  sheets: [{
    id: 'sheet-r',
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
          { id: circularEdgeId, kind: 'feature' as const, points: circlePoints },
          { id: lineEdgeId, kind: 'outline' as const, points: [[0, 0], [30, 0]] as readonly (readonly [number, number])[] },
        ],
        hiddenEdges: [],
        bbox: { minX: 0, minY: 0, maxX: 50, maxY: 50 },
      },
      inputFingerprint: 'fp-r',
    }],
    dimensions: [],
    dimensionGroups: [],
    annotations: [],
    titleBlock: {},
  }],
  activeSheetId: 'sheet-r',
};

const mockBus = { execute: vi.fn().mockResolvedValue(undefined) };

describe('DrawingCanvas — addRadial tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToolModeStore.getState().setMode('addRadial');
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: minimalDrawing as never },
      activeDrawing: minimalDrawing as never,
      bus: mockBus as never,
    } as never, false);
  });

  it('dispatches AddDrawingDimensionCommand with kind:radial on single circular-edge click', () => {
    const { container } = render(<DrawingCanvas />);
    const circEl = container.querySelector(`[data-edge-id="${circularEdgeId}"]`);
    expect(circEl).not.toBeNull();

    fireEvent.click(circEl!, { bubbles: true, clientX: 20, clientY: 20 });

    expect(mockBus.execute).toHaveBeenCalledTimes(1);
    const [cmd] = mockBus.execute.mock.calls[0] as [{ constructor: { name: string }; opts?: unknown }];
    expect(cmd.constructor.name).toBe('AddDrawingDimensionCommand');
    // Verify payload shape
    const opts = (cmd as unknown as { opts: { sheetId: string; dim: { kind: string; edgeId: string; viewId: string; offsetMm: number; angleDeg: number } } }).opts;
    expect(opts.sheetId).toBe('sheet-r');
    expect(opts.dim.kind).toBe('radial');
    expect(opts.dim.edgeId).toBe(circularEdgeId);
    expect(opts.dim.viewId).toBe(viewId);
    expect(typeof opts.dim.offsetMm).toBe('number');
    expect(typeof opts.dim.angleDeg).toBe('number');
  });

  it('ignores a click on a non-circular (2-point) edge', () => {
    const { container } = render(<DrawingCanvas />);
    const lineEl = container.querySelector(`[data-edge-id="${lineEdgeId}"]`);
    expect(lineEl).not.toBeNull();

    fireEvent.click(lineEl!, { bubbles: true, clientX: 10, clientY: 0 });

    expect(mockBus.execute).not.toHaveBeenCalled();
  });
});

describe('DrawingCanvas — addDiametric tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToolModeStore.getState().setMode('addDiametric');
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: minimalDrawing as never },
      activeDrawing: minimalDrawing as never,
      bus: mockBus as never,
    } as never, false);
  });

  it('dispatches AddDrawingDimensionCommand with kind:diametric on single circular-edge click', () => {
    const { container } = render(<DrawingCanvas />);
    const circEl = container.querySelector(`[data-edge-id="${circularEdgeId}"]`);
    expect(circEl).not.toBeNull();

    fireEvent.click(circEl!, { bubbles: true, clientX: 20, clientY: 20 });

    expect(mockBus.execute).toHaveBeenCalledTimes(1);
    const [cmd] = mockBus.execute.mock.calls[0] as [{ constructor: { name: string }; opts?: unknown }];
    expect(cmd.constructor.name).toBe('AddDrawingDimensionCommand');
    const opts = (cmd as unknown as { opts: { sheetId: string; dim: { kind: string; edgeId: string; viewId: string; offsetMm: number; angleDeg: number } } }).opts;
    expect(opts.sheetId).toBe('sheet-r');
    expect(opts.dim.kind).toBe('diametric');
    expect(opts.dim.edgeId).toBe(circularEdgeId);
    expect(opts.dim.viewId).toBe(viewId);
    expect(typeof opts.dim.offsetMm).toBe('number');
    expect(typeof opts.dim.angleDeg).toBe('number');
  });

  it('ignores a click on a non-circular (2-point) edge', () => {
    const { container } = render(<DrawingCanvas />);
    const lineEl = container.querySelector(`[data-edge-id="${lineEdgeId}"]`);
    expect(lineEl).not.toBeNull();

    fireEvent.click(lineEl!, { bubbles: true, clientX: 10, clientY: 0 });

    expect(mockBus.execute).not.toHaveBeenCalled();
  });
});
