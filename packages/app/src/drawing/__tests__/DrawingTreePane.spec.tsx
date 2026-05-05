// packages/app/src/drawing/__tests__/DrawingTreePane.spec.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DrawingTreePane } from '../DrawingTreePane';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument, DetailView } from '@zilventor/shared';

const makeDrawing = (): DrawingDocument => ({
  id: 'd1', name: 'Cabinet — Drawing', units: 'mm',
  source: { partPath: 'parts/cabinet.zipt', sourceKind: 'part' },
  properties: {},
  sheets: [
    { id: 's1', name: 'Sheet 1', size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [], dimensions: [], annotations: [], titleBlock: {} },
    { id: 's2', name: 'Sheet 2', size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [], dimensions: [], annotations: [], titleBlock: {} },
  ],
  activeSheetId: 's1',
});

describe('DrawingTreePane', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeDrawing: makeDrawing(),
      bus: { execute: vi.fn().mockResolvedValue(undefined) },
    } as never);
  });

  it('renders the drawing name as root node', () => {
    render(<DrawingTreePane />);
    expect(screen.getByText(/Cabinet — Drawing/i)).toBeInTheDocument();
  });

  it('renders both sheets in the tree', () => {
    render(<DrawingTreePane />);
    expect(screen.getByText('Sheet 1')).toBeInTheDocument();
    expect(screen.getByText('Sheet 2')).toBeInTheDocument();
  });

  it('clicking Sheet 2 dispatches SetActiveSheetCommand via bus.execute', () => {
    render(<DrawingTreePane />);
    const sheet2 = screen.getByText('Sheet 2');
    fireEvent.click(sheet2);
    const bus = useAppStore.getState().bus;
    expect(bus.execute).toHaveBeenCalledWith(
      expect.objectContaining({ sheetId: 's2' })
    );
  });

  it('renders source path label', () => {
    render(<DrawingTreePane />);
    expect(screen.getByText(/parts\/cabinet\.zipt/i)).toBeInTheDocument();
  });
});

const makeDrawingWithDetail = (): DrawingDocument => ({
  id: 'd1', name: 'Test Drawing', units: 'mm',
  source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
  properties: {},
  sheets: [
    {
      id: 's1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [
        {
          id: 'bv1', kind: 'base' as const,
          positionMm: { x: 20, y: 20 },
          scale: { numerator: 1, denominator: 1 },
          orientation: 'front' as const,
          showHidden: false,
        },
        {
          id: 'dv1', kind: 'detail' as const,
          parentViewId: 'bv1',
          regionParent: { center: { x: 10, y: 8 }, radiusMm: 5 },
          label: 'A',
          positionMm: { x: 200, y: 150 },
          scale: { numerator: 2, denominator: 1 },
          showHidden: false,
        } as DetailView,
      ],
      dimensions: [], annotations: [], titleBlock: {},
    },
  ],
  activeSheetId: 's1',
});

describe('DrawingTreePane — detail views in tree', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeDrawing: makeDrawingWithDetail(),
      bus: { execute: vi.fn().mockResolvedValue(undefined) },
    } as never);
  });

  it('renders detail view row with "Detail A (from Base — front)" label', () => {
    render(<DrawingTreePane />);
    // Click the sheet row to select it (fires SetActiveSheetCommand), then click expand toggle
    const sheet1Row = screen.getByText('Sheet 1');
    // The ▸ toggle is a sibling span; click the expand toggle
    const toggles = screen.getAllByText('▸');
    fireEvent.click(toggles[0]!); // expand first sheet
    expect(screen.getByText(/Detail A \(from Base — front\)/i)).toBeInTheDocument();
  });

  it('detail row shows scale "2:1"', () => {
    render(<DrawingTreePane />);
    const toggles = screen.getAllByText('▸');
    fireEvent.click(toggles[0]!);
    // The row text includes "· 2:1"
    expect(screen.getByText(/2:1/)).toBeInTheDocument();
  });
});
