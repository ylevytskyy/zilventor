import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AddDimensionDialog } from '../AddDimensionDialog';
import { useAppStore } from '../../store/useAppStore';

const mockExecute = vi.fn().mockResolvedValue(undefined);

const pendingDim = {
  sheetId: 'sh1',
  dim: {
    id: 'd1',
    kind: 'radial' as const,
    viewId: 'v1',
    edgeId: 'e1',
    offsetMm: 10,
    angleDeg: 45,
  },
  computedValue: 25.4,
};

describe('AddDimensionDialog', () => {
  beforeEach(() => {
    mockExecute.mockClear();
    useAppStore.setState({
      addDimensionDialogState: null,
      bus: { execute: mockExecute } as any,
    } as any);
  });

  it('renders nothing when addDimensionDialogState is null', () => {
    render(<AddDimensionDialog />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders the computed value and a decimal-places selector when open', () => {
    useAppStore.setState({ addDimensionDialogState: pendingDim } as any);
    render(<AddDimensionDialog />);
    expect(screen.getByRole('dialog', { name: /dimension/i })).toBeInTheDocument();
    expect(screen.getByText(/25\.4/)).toBeInTheDocument();
    expect(screen.getByLabelText(/decimal places/i)).toBeInTheDocument();
  });

  it('OK dispatches AddDrawingDimensionCommand with the pending dim and closes', async () => {
    useAppStore.setState({ addDimensionDialogState: pendingDim } as any);
    render(<AddDimensionDialog />);
    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }));
    await Promise.resolve();
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const [cmd] = mockExecute.mock.calls[0]!;
    expect((cmd as any).constructor.name).toBe('AddDrawingDimensionCommand');
    expect((cmd as any).opts.sheetId).toBe('sh1');
    expect((cmd as any).opts.dim.kind).toBe('radial');
    expect((useAppStore.getState() as any).addDimensionDialogState).toBeNull();
  });

  it('Cancel closes without executing command', () => {
    useAppStore.setState({ addDimensionDialogState: pendingDim } as any);
    render(<AddDimensionDialog />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(mockExecute).not.toHaveBeenCalled();
    expect((useAppStore.getState() as any).addDimensionDialogState).toBeNull();
  });

  it('bus.execute rejection keeps dialog open and shows an error alert', async () => {
    mockExecute.mockRejectedValueOnce(new Error('kernel exploded'));
    useAppStore.setState({ addDimensionDialogState: pendingDim } as any);
    render(<AddDimensionDialog />);
    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }));
    // Dialog must remain open (state not cleared)
    await waitFor(() => {
      expect((useAppStore.getState() as any).addDimensionDialogState).not.toBeNull();
    });
    // An error alert must be visible with the rejection message
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('alert').textContent).toContain('kernel exploded');
  });
});
