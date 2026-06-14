// packages/app/src/shell/tabs/__tests__/DrawingTab.removeUnderlay.spec.tsx
// SLICE 2 RED: DrawingTab "Remove Underlay" ribbon button
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import DrawingTab from '../DrawingTab';
import { useAppStore } from '../../../store/useAppStore';
import type { DrawingDocument, DxfUnderlay } from '@zilventor/shared';

const EXISTING_UNDERLAY: DxfUnderlay = {
  name: 'floor-plan',
  entities: [{ kind: 'line', x1: 0, y1: 0, x2: 100, y2: 0 }],
};

function makeDrawingDoc(underlay?: DxfUnderlay): DrawingDocument {
  const sheet = {
    id: 'sh1',
    name: 'Sheet 1',
    size: { kind: 'iso' as const, size: 'A3' as const },
    orientation: 'landscape' as const,
    views: [],
    dimensions: [],
    dimensionGroups: [],
    annotations: [],
    titleBlock: {},
    ...(underlay !== undefined ? { underlay } : {}),
  };
  return {
    id: 'dw1',
    name: 'Test Drawing',
    units: 'mm',
    source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
    properties: {},
    activeSheetId: 'sh1',
    sheets: [sheet],
  };
}

describe('DrawingTab — Remove Underlay button', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a "Remove Underlay" button in the Reference panel when a drawing is active', () => {
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: makeDrawingDoc(EXISTING_UNDERLAY) },
    } as never);
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: 'Remove Underlay' })).toBeTruthy();
  });

  it('"Remove Underlay" button is ENABLED when the active sheet has an underlay', () => {
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: makeDrawingDoc(EXISTING_UNDERLAY) },
    } as never);
    render(<DrawingTab />);
    const btn = screen.getByRole('button', { name: 'Remove Underlay' });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it('"Remove Underlay" button is DISABLED when the active sheet has NO underlay', () => {
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: makeDrawingDoc(undefined) },
    } as never);
    render(<DrawingTab />);
    const btn = screen.getByRole('button', { name: 'Remove Underlay' });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('does NOT render "Remove Underlay" when no drawing is active', () => {
    useAppStore.setState({ activeDocument: null } as never);
    render(<DrawingTab />);
    expect(screen.queryByRole('button', { name: 'Remove Underlay' })).toBeNull();
  });

  it('clicking "Remove Underlay" executes RemoveDxfUnderlayCommand via bus', async () => {
    const executeMock = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: makeDrawingDoc(EXISTING_UNDERLAY) },
      bus: { execute: executeMock } as never,
    } as never);
    render(<DrawingTab />);
    const btn = screen.getByRole('button', { name: 'Remove Underlay' });
    fireEvent.click(btn);
    // Wait for the dynamic import + async execute to complete
    await waitFor(() => expect(executeMock).toHaveBeenCalledTimes(1), { timeout: 2000 });
    const [cmd] = executeMock.mock.calls[0] as [{ name: string }];
    expect(cmd.name).toBe('RemoveDxfUnderlay');
  });
});
