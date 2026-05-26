// packages/app/src/shell/tabs/__tests__/DrawingTab.f5.spec.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { act } from 'react';
import DrawingTab from '../DrawingTab';
import { useAppStore } from '../../../store/useAppStore';
import { useToolModeStore } from '../../../drawing/toolMode';

// Minimal drawing doc stub required to bypass the StubTab early return.
const minimalDrawing = {
  id: 'drw-tab-test',
  name: 'Test Drawing',
  units: 'mm',
  source: { partPath: 'part.zipt', sourceKind: 'part' as const },
  properties: {},
  sheets: [{
    id: 'sheet-1',
    name: 'Sheet 1',
    size: { kind: 'iso' as const, size: 'A4' as const },
    orientation: 'landscape' as const,
    views: [],
    dimensions: [],
    dimensionGroups: [],
    annotations: [],
    titleBlock: {},
  }],
  activeSheetId: 'sheet-1',
};

describe('DrawingTab — F5 ribbon buttons', () => {
  beforeEach(() => {
    // Reset tool mode store
    useToolModeStore.getState().setMode('idle');

    // Inject a minimal drawing so the ribbon renders (not StubTab)
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: minimalDrawing as never },
      activeDrawing: minimalDrawing as never,
    } as never, false);
  });

  it('renders Baseline, Ordinate, Angular buttons in the Dimension panel', () => {
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: 'Baseline' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Ordinate' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Angular' })).toBeDefined();
  });

  it('clicking Baseline sets toolMode to "baseline"', () => {
    render(<DrawingTab />);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Baseline' }));
    });
    expect(useToolModeStore.getState().mode).toBe('baseline');
  });

  it('clicking Ordinate sets toolMode to "ordinate"', () => {
    render(<DrawingTab />);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Ordinate' }));
    });
    expect(useToolModeStore.getState().mode).toBe('ordinate');
  });

  it('clicking Angular sets toolMode to "angular"', () => {
    render(<DrawingTab />);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Angular' }));
    });
    expect(useToolModeStore.getState().mode).toBe('angular');
  });
});
