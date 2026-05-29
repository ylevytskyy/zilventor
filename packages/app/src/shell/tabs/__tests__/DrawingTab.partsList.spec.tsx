// packages/app/src/shell/tabs/__tests__/DrawingTab.partsList.spec.tsx
// SLICE 3 RED: DrawingTab "Parts List" ribbon button enters partsList mode
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import DrawingTab from '../DrawingTab';
import { useAppStore } from '../../../store/useAppStore';
import { useToolModeStore } from '../../../drawing/toolMode';
import type { DrawingDocument } from '@zilventor/shared';

function makeDrawingDoc(sourceKind: 'part' | 'assembly' = 'assembly'): DrawingDocument {
  return {
    id: 'dw1',
    name: 'Test Drawing',
    units: 'mm',
    source: { partPath: 'asm/cabinet.ziasm', sourceKind },
    properties: {},
    activeSheetId: 'sh1',
    sheets: [
      {
        id: 'sh1',
        name: 'Sheet 1',
        size: { kind: 'iso', size: 'A3' },
        orientation: 'landscape',
        views: [],
        dimensions: [],
        dimensionGroups: [],
        annotations: [],
        titleBlock: {},
      },
    ],
  };
}

describe('DrawingTab — Parts List ribbon button', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
  });

  it('renders a "Parts List" button in the Annotate panel', () => {
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: makeDrawingDoc() },
    } as never);
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: 'Parts List' })).toBeTruthy();
  });

  it('clicking the button sets the tool mode to "partsList"', () => {
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: makeDrawingDoc() },
    } as never);
    render(<DrawingTab />);
    const btn = screen.getByRole('button', { name: 'Parts List' });
    fireEvent.click(btn);
    expect(useToolModeStore.getState().mode).toBe('partsList');
  });

  it('Parts List button is present for part drawings too', () => {
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: makeDrawingDoc('part') },
    } as never);
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: 'Parts List' })).toBeTruthy();
  });
});
