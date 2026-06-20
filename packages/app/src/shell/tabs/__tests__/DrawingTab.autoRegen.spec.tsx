// packages/app/src/shell/tabs/__tests__/DrawingTab.autoRegen.spec.tsx
// Task 3 (M3.2) RED: DrawingTab "Auto-update views" toggle button reflects + flips autoRegen
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import DrawingTab from '../DrawingTab';
import { useAppStore } from '../../../store/useAppStore';
import { useToolModeStore } from '../../../drawing/toolMode';
import type { DrawingDocument } from '@zilventor/shared';

function seedDrawing(): DrawingDocument {
  return {
    id: 'dw-autoregen',
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

describe('DrawingTab — Auto-update views toggle button', () => {
  beforeEach(() => {
    localStorage.clear();
    useToolModeStore.getState().reset();
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: seedDrawing() },
      activeAssembly: null,
      activeDrawingSourceDocument: null,
      subAssemblyDocs: {},
    } as never);
    // Explicitly set autoRegen to true so localStorage.clear() has no race
    useAppStore.getState().setAutoRegen(true);
  });

  it('renders an "Auto-update views" toggle button', () => {
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: /auto-update views/i })).toBeInTheDocument();
  });

  it('reflects autoRegen=true via aria-pressed="true"', () => {
    useAppStore.getState().setAutoRegen(true);
    render(<DrawingTab />);
    const btn = screen.getByRole('button', { name: /auto-update views/i });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
  });

  it('reflects autoRegen=false via aria-pressed="false"', () => {
    useAppStore.getState().setAutoRegen(false);
    render(<DrawingTab />);
    const btn = screen.getByRole('button', { name: /auto-update views/i });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
  });

  it('clicking the toggle flips autoRegen from true to false', () => {
    useAppStore.getState().setAutoRegen(true);
    render(<DrawingTab />);
    const btn = screen.getByRole('button', { name: /auto-update views/i });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(btn);
    expect(useAppStore.getState().autoRegen).toBe(false);
    expect(btn).toHaveAttribute('aria-pressed', 'false');
  });

  it('clicking the toggle flips autoRegen from false to true', () => {
    useAppStore.getState().setAutoRegen(false);
    render(<DrawingTab />);
    const btn = screen.getByRole('button', { name: /auto-update views/i });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(btn);
    expect(useAppStore.getState().autoRegen).toBe(true);
    expect(btn).toHaveAttribute('aria-pressed', 'true');
  });
});
