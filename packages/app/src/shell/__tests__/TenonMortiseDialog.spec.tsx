import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TenonMortiseDialog } from '../TenonMortiseDialog';
import { useAppStore } from '../../store/useAppStore';

describe('TenonMortiseDialog', () => {
  beforeEach(() => {
    useAppStore.getState().setTenonMortiseDialog(null);
  });

  it('renders nothing when the dialog state is null', () => {
    render(<TenonMortiseDialog />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders the dialog with panel paths when open', () => {
    useAppStore.getState().setTenonMortiseDialog({
      panelPathA: 'parts/a.zipt',
      panelPathB: 'parts/b.zipt',
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    });
    render(<TenonMortiseDialog />);
    expect(screen.getByTestId('tenon-mortise-dialog')).toBeTruthy();
  });

  it('submits typed field values via onSubmit, not just defaults', () => {
    const onSubmit = vi.fn();
    useAppStore.getState().setTenonMortiseDialog({
      panelPathA: 'parts/a.zipt',
      panelPathB: 'parts/b.zipt',
      onSubmit,
      onCancel: vi.fn(),
    });
    render(<TenonMortiseDialog />);

    fireEvent.change(screen.getByLabelText('Width (mm)'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Depth (mm)'), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText('Count'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Spacing (mm)'), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText('Fit clearance (mm)'), { target: { value: '0.3' } });
    fireEvent.change(screen.getByLabelText('Position (mm)'), { target: { value: '55' } });

    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      width: 10,
      depth: 15,
      count: 4,
      spacing: 40,
      fitClearance: 0.3,
      position: 55,
    });
  });

  it('Escape cancels and clears the dialog', () => {
    const onCancel = vi.fn();
    useAppStore.getState().setTenonMortiseDialog({
      panelPathA: 'parts/a.zipt',
      panelPathB: 'parts/b.zipt',
      onSubmit: vi.fn(),
      onCancel,
    });
    render(<TenonMortiseDialog />);
    fireEvent.keyDown(screen.getByTestId('tenon-mortise-dialog'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().tenonMortiseDialog).toBeNull();
  });
});
