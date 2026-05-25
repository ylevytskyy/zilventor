// packages/app/src/shell/tabs/__tests__/DrawingTab.holeTable.spec.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import DrawingTab from '../DrawingTab';
import { useAppStore } from '../../../store/useAppStore';
import { useToolModeStore } from '../../../drawing/toolMode';
import type { DrawingDocument } from '@zilventor/shared';

function makeDrawingDoc(withProjectedView: boolean): DrawingDocument {
  return {
    id: 'dw1',
    name: 'Test Drawing',
    units: 'mm',
    source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
    properties: {},
    activeSheetId: 'sh1',
    sheets: [
      {
        id: 'sh1',
        name: 'Sheet 1',
        size: { kind: 'iso', size: 'A3' },
        orientation: 'landscape',
        views: withProjectedView
          ? [
              {
                id: 'v1',
                kind: 'base' as const,
                positionMm: { x: 20, y: 20 },
                scale: { numerator: 1, denominator: 1 },
                showHidden: false,
                projection: {
                  visibleEdges: [],
                  hiddenEdges: [],
                  bbox: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
                },
                orientation: 'front' as const,
              },
            ]
          : [],
        dimensions: [],
        dimensionGroups: [],
        annotations: [],
        titleBlock: {},
      },
    ],
  };
}

describe('DrawingTab — Hole Table ribbon button', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
  });

  it('renders a "Hole Table" button in the Annotate panel', () => {
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: makeDrawingDoc(false) },
    } as never);
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: 'Hole Table' })).toBeTruthy();
  });

  it('button is disabled when no sheet view has a projection', () => {
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: makeDrawingDoc(false) },
    } as never);
    render(<DrawingTab />);
    const btn = screen.getByRole('button', { name: 'Hole Table' });
    expect(btn).toBeDisabled();
  });

  it('button is enabled when at least one sheet view has a projection', () => {
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: makeDrawingDoc(true) },
    } as never);
    render(<DrawingTab />);
    const btn = screen.getByRole('button', { name: 'Hole Table' });
    expect(btn).not.toBeDisabled();
  });

  it('clicking the button calls enterHoleTableMode() and sets mode to "holeTable"', () => {
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: makeDrawingDoc(true) },
    } as never);
    render(<DrawingTab />);
    const btn = screen.getByRole('button', { name: 'Hole Table' });
    fireEvent.click(btn);
    expect(useToolModeStore.getState().mode).toBe('holeTable');
  });
});
