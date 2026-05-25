// packages/app/src/drawing/__tests__/DrawingCanvas.editDetailRegion.spec.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import { DrawingCanvas } from '../DrawingCanvas';
import { useToolModeStore } from '../toolMode';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument, DrawingSheet, DetailView, BaseView } from '@zilventor/shared';

// Minimal mocks to allow DrawingCanvas to render
vi.mock('../ViewElement', () => ({ ViewElement: () => <g data-testid="view-element" /> }));
vi.mock('../SectionLineOverlay', () => ({ SectionLineOverlay: () => null }));
vi.mock('../DimensionElement', () => ({ DimensionElement: () => null }));
vi.mock('../AnnotationElement', () => ({ AnnotationElement: () => null }));
vi.mock('../TitleBlock', () => ({ TitleBlock: () => null }));
vi.mock('../AddBreakDialog', () => ({ AddBreakDialog: () => null }));
vi.mock('../HalfSectionSidePreview', () => ({ HalfSectionSidePreview: () => null }));
vi.mock('../DetailRegionOverlay', () => ({ DetailRegionOverlay: () => null }));
vi.mock('../DetailRegionEditHandles', () => ({
  DetailRegionEditHandles: ({ detailView }: { detailView: { id: string } }) => (
    <g data-testid={`edit-handles-${detailView.id}`} />
  ),
}));

const PARENT_PROJ = {
  visibleEdges: [], hiddenEdges: [],
  bbox: { minX: 0, minY: 0, maxX: 100, maxY: 60 },
};
const PARENT_VIEW: BaseView = {
  id: 'pv1', kind: 'base', positionMm: { x: 20, y: 20 },
  scale: { numerator: 1, denominator: 1 }, orientation: 'front', showHidden: false,
  projection: PARENT_PROJ, inputFingerprint: 'pv1-fp',
};
const DETAIL_VIEW: DetailView = {
  id: 'dv1', kind: 'detail', parentViewId: 'pv1',
  regionParent: { kind: 'circle', center: { x: 20, y: 15 }, radiusMm: 8 },
  label: 'A', positionMm: { x: 200, y: 100 },
  scale: { numerator: 2, denominator: 1 }, showHidden: false,
  projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 } },
  inputFingerprint: 'dv1-fp',
};

function makeDrawing(): DrawingDocument {
  const sheet: DrawingSheet = {
    id: 's1', name: 'S1', size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
    views: [PARENT_VIEW, { ...DETAIL_VIEW }],
    dimensions: [], dimensionGroups: [], annotations: [], titleBlock: {},
  };
  return {
    id: 'd1', name: 'D', units: 'mm',
    source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
    properties: {}, sheets: [sheet], activeSheetId: 's1',
  };
}

beforeEach(() => {
  useToolModeStore.getState().reset();
  useAppStore.setState({
    activeDocument: { kind: 'drawing', document: makeDrawing() },
    activePart: null,
    activeAssembly: null,
    activeDrawing: makeDrawing(),
  } as never);
});

describe('DrawingCanvas — editDetailRegion mode renders handles', () => {
  it('handles are NOT rendered when mode is idle', () => {
    const { queryByTestId } = render(<DrawingCanvas />);
    expect(queryByTestId('edit-handles-dv1')).toBeNull();
  });

  it('handles ARE rendered for each detail view when mode is editDetailRegion', () => {
    useToolModeStore.getState().enterEditDetailRegionMode();
    const { getByTestId } = render(<DrawingCanvas />);
    expect(getByTestId('edit-handles-dv1')).toBeTruthy();
  });
});

describe('DrawingCanvas — editDetailRegion ESC during draggingCorner', () => {
  it('ESC while draggingCorner calls editDetailCancel without throwing', () => {
    // Simulate toolMode store in draggingCorner state
    useToolModeStore.setState({
      mode: 'editDetailRegion',
      editDetailRegionState: {
        stage: 'draggingCorner',
        detailViewId: 'dv1',
        startRegion: {
          kind: 'rect',
          center: { x: 20, y: 15 },
          widthMm: 30,
          heightMm: 20,
        },
        oppositeCorner: { x: 30, y: 25 },
        center: { x: 20, y: 15 },
        widthMm: 30,
        heightMm: 20,
      } as never,
    } as never);

    render(<DrawingCanvas />);
    // Should not throw; editDetailCancel resets state
    expect(() => fireEvent.keyDown(document, { key: 'Escape' })).not.toThrow();
    expect(useToolModeStore.getState().editDetailRegionState.stage).toBe('idle');
  });
});
