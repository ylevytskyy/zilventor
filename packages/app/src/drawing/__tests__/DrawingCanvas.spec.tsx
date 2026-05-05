// packages/app/src/drawing/__tests__/DrawingCanvas.spec.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { DrawingCanvas } from '../DrawingCanvas';
import { useAppStore } from '../../store/useAppStore';
import { AddDrawingDimensionCommand } from '../../commands/AddDrawingDimensionCommand';
import type { DrawingDocument, DrawingSheet } from '@zilventor/shared';

// Minimal drawing fixture
const makeSheet = (): DrawingSheet => ({
  id: 's1',
  name: 'Sheet 1',
  size: { kind: 'iso', size: 'A3' },
  orientation: 'landscape',
  views: [],
  dimensions: [],
  annotations: [],
  titleBlock: {},
});

const makeDrawing = (): DrawingDocument => ({
  id: 'd1',
  name: 'Test Drawing',
  units: 'mm',
  source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
  properties: {},
  sheets: [makeSheet()],
  activeSheetId: 's1',
});

vi.mock('../../commands/AddDrawingDimensionCommand', () => ({
  AddDrawingDimensionCommand: vi.fn().mockImplementation((opts) => ({
    name: 'AddDrawingDimension',
    opts,
  })),
}));

describe('DrawingCanvas', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeDrawing: makeDrawing(),
      drawingToolMode: 'idle',
      bus: { execute: vi.fn().mockResolvedValue(undefined) },
    } as never);
  });

  it('renders an <svg> element with A3-landscape viewBox', () => {
    render(<DrawingCanvas />);
    const svg = document.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('viewBox')).toBe('0 0 420 297');
  });

  it('renders a sheet border rect', () => {
    render(<DrawingCanvas />);
    const rect = document.querySelector('[data-sheet-border]');
    expect(rect).not.toBeNull();
  });

  it('tool-mode addLinearH + 2 click events → calls bus.execute with AddDrawingDimensionCommand', async () => {
    useAppStore.setState({ drawingToolMode: 'addLinearH' } as never);
    render(<DrawingCanvas />);
    const svg = document.querySelector('svg')!;

    // Simulate two clicks — the 2-click state machine dispatches AddDrawingDimensionCommand
    fireEvent.click(svg, { clientX: 10, clientY: 10 });
    fireEvent.click(svg, { clientX: 110, clientY: 10 });

    const bus = useAppStore.getState().bus;
    expect(bus.execute).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'AddDrawingDimension' })
    );
  });
});
