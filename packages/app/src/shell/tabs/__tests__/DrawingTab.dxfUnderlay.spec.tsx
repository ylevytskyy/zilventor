// packages/app/src/shell/tabs/__tests__/DrawingTab.dxfUnderlay.spec.tsx
// F5b RED: DrawingTab "Import DXF Underlay…" ribbon button
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import DrawingTab from '../DrawingTab';
import { useAppStore } from '../../../store/useAppStore';
import type { DrawingDocument } from '@zilventor/shared';

function makeDrawingDoc(): DrawingDocument {
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
        views: [],
        dimensions: [],
        dimensionGroups: [],
        annotations: [],
        titleBlock: {},
      },
    ],
  };
}

describe('DrawingTab — Import DXF Underlay ribbon button', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: makeDrawingDoc() },
    } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders an "Import DXF Underlay…" button when a drawing is active', () => {
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: 'Import DXF Underlay…' })).toBeTruthy();
  });

  it('"Import DXF Underlay…" button is enabled when a drawing is active', () => {
    render(<DrawingTab />);
    const btn = screen.getByRole('button', { name: 'Import DXF Underlay…' });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it('does NOT render "Import DXF Underlay…" when no drawing is active', () => {
    useAppStore.setState({ activeDocument: null } as never);
    render(<DrawingTab />);
    // When no drawing active, the component renders a StubTab — button absent
    expect(screen.queryByRole('button', { name: 'Import DXF Underlay…' })).toBeNull();
  });
});
