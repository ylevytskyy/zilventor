// packages/app/src/shell/tabs/__tests__/DrawingTab.autoDim.spec.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DrawingTab from '../DrawingTab';
import { useAppStore } from '../../../store/useAppStore';
import { useToolModeStore } from '../../../drawing/toolMode';
import type { DrawingDocument } from '@zilventor/shared';

function seedDrawing(): DrawingDocument {
  return {
    id: 'dw-autodim-ui-1',
    name: 'AutoDim Test Drawing',
    units: 'mm',
    source: { partPath: 'parts/part.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [
      {
        id: 'sh1',
        name: 'Sheet 1',
        size: { kind: 'iso', size: 'A3' },
        orientation: 'landscape',
        views: [],
        dimensions: [],
        annotations: [],
        titleBlock: {},
      },
    ],
    activeSheetId: 'sh1',
  };
}

describe('DrawingTab — Auto-Dim button', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useAppStore.getState().setActiveDocument(null);
  });

  it('HS-UI-1: clicking Auto-Dim button sets mode to "autoDim"', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawing() });
    render(<DrawingTab />);
    const btn = screen.getByRole('button', { name: 'Auto-Dim' });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(useToolModeStore.getState().mode).toBe('autoDim');
  });
});
