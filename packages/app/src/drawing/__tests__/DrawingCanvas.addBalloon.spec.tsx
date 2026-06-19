// packages/app/src/drawing/__tests__/DrawingCanvas.addBalloon.spec.tsx
//
// Task 5 — addBalloon click handler
//
// Test strategy: render DrawingCanvas with a seeded store (assembly with one
// component → BOM item 1; sheet with one base view whose projection has a
// visible edge tagged with componentPath = pathKey(['c1'])), then fire a click
// on the rendered <polyline data-edge-id="v1_e1_0"> element so the REAL canvas
// handler runs (not a direct command stub). Mirrors the harness established in
// DrawingCanvas.spec.tsx (same store seed shape, same bus spy, same fireEvent).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { DrawingCanvas } from '../DrawingCanvas';
import { useAppStore } from '../../store/useAppStore';
import { useToolModeStore } from '../toolMode';
import { AddDrawingAnnotationCommand } from '../../commands/AddDrawingAnnotationCommand';
import type { AssemblyDocument } from '@zilventor/shared';
import type { DrawingDocument, DrawingSheet } from '@zilventor/shared';

// Mock the AddDrawingAnnotationCommand so we can inspect calls
vi.mock('../../commands/AddDrawingAnnotationCommand', () => ({
  AddDrawingAnnotationCommand: vi.fn().mockImplementation((opts) => ({
    name: 'AddDrawingAnnotationCommand',
    opts,
  })),
}));

// pathKey(['c1']) === 'c1' (single-segment path, separator is space)
const COMPONENT_PATH = 'c1';
const EDGE_ID = 'v1_e1_0';
const UNTAGGED_EDGE_ID = 'v1_untagged_0';
const VIEW_ID = 'v1';

const makeAssembly = (): AssemblyDocument => ({
  id: 'asm1',
  name: 'Test Assembly',
  units: 'mm',
  parameters: {},
  constraints: [],
  groundedComponentPaths: [],
  colors: {},
  bomItemNumbers: { 'parts/box.zipt::none': 1 },
  cutListItemNumbers: {},
  colorOverrides: {},
  properties: {},
  materials: [],
  hardware: [],
  components: [
    {
      id: 'c1',
      partPath: 'parts/box.zipt',
      position: { x: 0, y: 0, z: 0 },
      rotation: { rx: 0, ry: 0, rz: 0 },
      visible: true,
    },
  ],
});

const makeSheet = (): DrawingSheet => ({
  id: 's1',
  name: 'Sheet 1',
  size: { kind: 'iso', size: 'A3' },
  orientation: 'landscape',
  views: [
    {
      id: VIEW_ID,
      kind: 'base' as const,
      positionMm: { x: 0, y: 0 },
      scale: { numerator: 1, denominator: 1 },
      orientation: 'front' as const,
      showHidden: false,
      projection: {
        visibleEdges: [
          {
            id: EDGE_ID,
            kind: 'feature' as const,
            points: [[50, 50], [100, 50]] as ReadonlyArray<readonly [number, number]>,
            componentPath: COMPONENT_PATH,
          },
          {
            id: UNTAGGED_EDGE_ID,
            kind: 'feature' as const,
            points: [[10, 10], [20, 10]] as ReadonlyArray<readonly [number, number]>,
            // No componentPath → unresolvable
          },
        ],
        hiddenEdges: [],
        bbox: { minX: 0, minY: 0, maxX: 200, maxY: 150 },
      },
    },
  ],
  dimensions: [],
  annotations: [],
  titleBlock: {},
  dimensionGroups: [],
});

const makeDrawing = (): DrawingDocument => ({
  id: 'd1',
  name: 'Test Drawing',
  units: 'mm',
  source: { partPath: 'asm/box.ziasm', sourceKind: 'assembly' },
  properties: {},
  sheets: [makeSheet()],
  activeSheetId: 's1',
});

describe('DrawingCanvas — addBalloon tool mode', () => {
  let busExecuteSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    busExecuteSpy = vi.fn().mockResolvedValue(undefined);

    useToolModeStore.setState({ mode: 'idle' } as never);
    useAppStore.setState({
      activeDrawing: makeDrawing(),
      activeDrawingSourceDocument: makeAssembly(),
      activeAssembly: makeAssembly(),
      subAssemblyDocs: {},
      bus: { execute: busExecuteSpy },
    } as never);
  });

  it('addBalloon click on a tagged edge dispatches a balloon annotation with itemNumber: 1', async () => {
    useToolModeStore.setState({ mode: 'addBalloon' } as never);
    const { container } = render(<DrawingCanvas />);

    // Find the rendered polyline for the tagged edge and click it
    const edgeEl = container.querySelector(`[data-edge-id="${EDGE_ID}"]`) as Element | null;
    expect(edgeEl).not.toBeNull(); // sanity: edge must be rendered

    fireEvent.click(edgeEl!, { clientX: 50, clientY: 50 });

    // Flush microtasks (bus.execute is awaited with void)
    await Promise.resolve();

    expect(busExecuteSpy).toHaveBeenCalledTimes(1);
    expect(AddDrawingAnnotationCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        sheetId: 's1',
        ann: expect.objectContaining({
          kind: 'balloon',
          viewId: VIEW_ID,
          itemNumber: 1,
          targetMm: expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
        }),
      }),
    );
  });

  it('addBalloon click on an untagged/unresolvable edge does not dispatch', async () => {
    useToolModeStore.setState({ mode: 'addBalloon' } as never);
    const { container } = render(<DrawingCanvas />);

    const edgeEl = container.querySelector(`[data-edge-id="${UNTAGGED_EDGE_ID}"]`) as Element | null;
    expect(edgeEl).not.toBeNull();

    fireEvent.click(edgeEl!, { clientX: 10, clientY: 10 });
    await Promise.resolve();

    expect(busExecuteSpy).not.toHaveBeenCalled();
  });
});
