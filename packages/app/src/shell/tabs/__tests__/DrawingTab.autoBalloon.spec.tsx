// packages/app/src/shell/tabs/__tests__/DrawingTab.autoBalloon.spec.tsx
// Task 8 RED: DrawingTab "Auto-balloon" ribbon button calls bus.execute(AutoBalloonCommand)
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import DrawingTab from '../DrawingTab';
import { useAppStore } from '../../../store/useAppStore';
import { useToolModeStore } from '../../../drawing/toolMode';
import type { DrawingDocument } from '@zilventor/shared';
import { AutoBalloonCommand } from '../../../commands/AutoBalloonCommand';

// The component path in edges must match pathKey([componentId]) = componentId (space-joined)
// For a top-level component with id 'c1', pathKey(['c1']) = 'c1'.
const FAKE_CP = 'c1';

function makeAssemblyDrawingWithProjection(): DrawingDocument {
  return {
    id: 'dw-auto-balloon',
    name: 'Cabinet — Drawing',
    units: 'mm',
    source: { partPath: 'asm/cabinet.ziasm', sourceKind: 'assembly' },
    properties: {},
    activeSheetId: 'sh1',
    sheets: [
      {
        id: 'sh1',
        name: 'Sheet 1',
        size: { kind: 'iso', size: 'A3' },
        orientation: 'landscape',
        views: [
          {
            id: 'bv1',
            kind: 'base' as const,
            positionMm: { x: 80, y: 80 },
            scale: { numerator: 1, denominator: 1 },
            orientation: 'front' as const,
            showHidden: false,
            projection: {
              visibleEdges: [
                {
                  id: 'e1',
                  kind: 'outline' as const,
                  componentPath: FAKE_CP,
                  points: [[0, 0], [100, 0], [100, 60], [0, 60], [0, 0]] as ReadonlyArray<readonly [number, number]>,
                  sourceFaceIds: [],
                },
              ],
              hiddenEdges: [],
              bbox: { minX: 0, minY: 0, maxX: 100, maxY: 60 },
            },
            inputFingerprint: 'fp-auto-balloon',
          },
        ],
        dimensions: [],
        dimensionGroups: [],
        annotations: [],
        titleBlock: {},
      },
    ],
  };
}

function makeAssemblyDocument() {
  return {
    id: 'asm-1',
    name: 'Cabinet',
    units: 'mm' as const,
    components: [
      {
        id: 'c1',
        partPath: 'parts/panel-A.zipt',
        name: 'Panel A',
        pose: {
          translation: { x: 0, y: 0, z: 0 },
          quaternion: { x: 0, y: 0, z: 0, w: 1 },
        },
      },
    ],
    groundedComponentPaths: [['c1']],
    constraints: [],
    properties: {},
    hardware: [],
    materials: [],
    // bomRowKey(partPath, undefined) = 'parts/panel-A.zipt::none'
    bomItemNumbers: { 'parts/panel-A.zipt::none': 1 },
    colors: {},
    colorOverrides: {},
  };
}

describe('DrawingTab — Auto-balloon ribbon button', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useAppStore.setState({
      activeDrawingSourceDocument: null,
      subAssemblyDocs: {},
    } as never);
  });

  it('renders an "Auto-balloon" button in the Annotate panel', () => {
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: makeAssemblyDrawingWithProjection() },
      activeAssembly: makeAssemblyDocument(),
    } as never);
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: /auto-balloon/i })).toBeInTheDocument();
  });

  it('Auto-balloon button is disabled when source is not an assembly', () => {
    const partDrawing: DrawingDocument = {
      ...makeAssemblyDrawingWithProjection(),
      source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
    };
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: partDrawing },
      activeAssembly: null,
    } as never);
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: /auto-balloon/i })).toBeDisabled();
  });

  it('Auto-balloon button is enabled for an assembly source drawing', () => {
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: makeAssemblyDrawingWithProjection() },
      activeAssembly: makeAssemblyDocument(),
    } as never);
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: /auto-balloon/i })).not.toBeDisabled();
  });

  it('clicking Auto-balloon dispatches AutoBalloonCommand via bus.execute', async () => {
    const asm = makeAssemblyDocument();
    const drw = makeAssemblyDrawingWithProjection();
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: drw },
      activeDrawing: drw,
      activeAssembly: asm,
      activeDrawingSourceDocument: asm as never,
      subAssemblyDocs: {},
    } as never);

    // Spy on bus.execute
    const executeSpy = vi.spyOn(useAppStore.getState().bus, 'execute');

    render(<DrawingTab />);
    const btn = screen.getByRole('button', { name: /auto-balloon/i });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);

    // Wait for the async onClick to resolve
    await vi.waitFor(() => {
      expect(executeSpy).toHaveBeenCalledWith(expect.any(AutoBalloonCommand));
    }, { timeout: 2000 });
  });
});
