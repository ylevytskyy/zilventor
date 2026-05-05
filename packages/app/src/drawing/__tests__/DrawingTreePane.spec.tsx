// packages/app/src/drawing/__tests__/DrawingTreePane.spec.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DrawingTreePane } from '../DrawingTreePane';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument } from '@zilventor/shared';

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
