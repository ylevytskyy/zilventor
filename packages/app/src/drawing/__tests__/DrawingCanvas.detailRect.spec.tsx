// packages/app/src/drawing/__tests__/DrawingCanvas.detailRect.spec.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import { DrawingCanvas } from '../DrawingCanvas';
import { useToolModeStore } from '../toolMode';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument, DrawingSheet, BaseView } from '@zilventor/shared';

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

function makeDrawing(): DrawingDocument {
  const sheet: DrawingSheet = {
    id: 's1', name: 'S1', size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
    views: [PARENT_VIEW],
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

describe('DrawingCanvas — detailRect mode ESC resets to idle', () => {
  it('pressing Escape while in detailRect/pickFirstCorner resets to idle', () => {
    useToolModeStore.getState().enterDetailRectMode();
    useToolModeStore.getState().detailRectPickParent('pv1'); // stage → pickFirstCorner
    expect(useToolModeStore.getState().detailRectState.stage).toBe('pickFirstCorner');

    render(<DrawingCanvas />);
    fireEvent.keyDown(document, { key: 'Escape' });
    // After ESC: detailRectCancel() resets stage to idle (mirroring circle 'detail' behaviour)
    const state = useToolModeStore.getState();
    expect(state.detailRectState.stage).toBe('idle');
  });

  it('pressing Escape twice from detailRect/idle exits the tool mode', () => {
    useToolModeStore.getState().enterDetailRectMode();
    expect(useToolModeStore.getState().mode).toBe('detailRect');

    render(<DrawingCanvas />);
    // First ESC: stage idle, mode stays 'detailRect' → detailRectCancel goes to idle on mode too
    fireEvent.keyDown(document, { key: 'Escape' });
    // Second ESC (stage already idle): exits mode entirely
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useToolModeStore.getState().mode).toBe('idle');
  });
});

describe('DrawingCanvas — detailRect click routing', () => {
  it('click in detailRect/idle with a hit view advances to pickFirstCorner', () => {
    useToolModeStore.getState().enterDetailRectMode();
    const { container } = render(<DrawingCanvas />);
    const svg = container.querySelector('svg')!;
    // Click at coords that fall inside the coarse hit-test for PARENT_VIEW (positionMm={20,20}, 200×150 bbox)
    // x=50 y=50 is inside the coarse bbox (20 to 220, 20 to 170)
    fireEvent.click(svg, { clientX: 50, clientY: 50, target: svg });
    // In jsdom, getBoundingClientRect returns zeros → coords pass through as mm directly.
    expect(useToolModeStore.getState().detailRectState.stage).toBe('pickFirstCorner');
  });
});
