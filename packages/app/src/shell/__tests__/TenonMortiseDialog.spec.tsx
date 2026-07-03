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
      jointLength: null,
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
      jointLength: null,
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

  it('defaults to manual mode (count/spacing inputs visible, no auto fields)', () => {
    useAppStore.getState().setTenonMortiseDialog({
      panelPathA: 'parts/a.zipt',
      panelPathB: 'parts/b.zipt',
      jointLength: 400,
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    });
    render(<TenonMortiseDialog />);
    expect(screen.getByLabelText('Count')).toBeTruthy();
    expect(screen.getByLabelText('Spacing (mm)')).toBeTruthy();
    expect(screen.queryByLabelText('Auto')).toBeTruthy();
    expect(screen.queryByLabelText('Target count')).toBeNull();
  });

  it('auto mode (count sub-mode): switching hides manual count/spacing and shows a live-computed preview', () => {
    useAppStore.getState().setTenonMortiseDialog({
      panelPathA: 'parts/a.zipt',
      panelPathB: 'parts/b.zipt',
      jointLength: 400,
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    });
    render(<TenonMortiseDialog />);

    fireEvent.click(screen.getByLabelText('Auto'));

    expect(screen.queryByLabelText('Count')).toBeNull();
    expect(screen.queryByLabelText('Spacing (mm)')).toBeNull();
    expect(screen.getByLabelText('Target count')).toBeTruthy();

    // Default width=8, default target count=3, jointLength=400, default margin=width=8
    // → usableSpan=384, spacing=192 (layoutTenonsAlongJoint's own math, verified in S1).
    expect(screen.getByTestId('tenon-mortise-preview').textContent).toContain('192');
  });

  it('auto mode: submitting calls onSubmit with a layout descriptor, not literal count/spacing', () => {
    const onSubmit = vi.fn();
    useAppStore.getState().setTenonMortiseDialog({
      panelPathA: 'parts/a.zipt',
      panelPathB: 'parts/b.zipt',
      jointLength: 400,
      onSubmit,
      onCancel: vi.fn(),
    });
    render(<TenonMortiseDialog />);

    fireEvent.click(screen.getByLabelText('Auto'));
    fireEvent.change(screen.getByLabelText('Width (mm)'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Target count'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0]![0];
    expect(payload.layout).toEqual({ mode: 'count', value: 4 });
    expect(payload.width).toBe(10);
    expect('count' in payload).toBe(false);
    expect('spacing' in payload).toBe(false);
  });

  it('auto mode (pitch sub-mode): shows target pitch field and a clamped-preview warning when infeasible', () => {
    useAppStore.getState().setTenonMortiseDialog({
      panelPathA: 'parts/a.zipt',
      panelPathB: 'parts/b.zipt',
      jointLength: 50,
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    });
    render(<TenonMortiseDialog />);

    fireEvent.click(screen.getByLabelText('Auto'));
    fireEvent.click(screen.getByLabelText('Pitch'));
    expect(screen.getByLabelText('Target pitch (mm)')).toBeTruthy();

    // Default width=8, jointLength=50, margin=8 → usableSpan=34, maxCount=5.
    // Target pitch 1mm requests way more tenons than fit → clamped.
    fireEvent.change(screen.getByLabelText('Target pitch (mm)'), { target: { value: '1' } });
    expect(screen.getByText(/clamp/i)).toBeTruthy();
  });

  it('manual mode after visiting auto mode: onSubmit payload is still the flat literal shape (manual path unchanged)', () => {
    const onSubmit = vi.fn();
    useAppStore.getState().setTenonMortiseDialog({
      panelPathA: 'parts/a.zipt',
      panelPathB: 'parts/b.zipt',
      jointLength: 400,
      onSubmit,
      onCancel: vi.fn(),
    });
    render(<TenonMortiseDialog />);

    fireEvent.click(screen.getByLabelText('Auto'));
    fireEvent.click(screen.getByLabelText('Manual'));

    fireEvent.change(screen.getByLabelText('Width (mm)'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Depth (mm)'), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText('Count'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Spacing (mm)'), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText('Fit clearance (mm)'), { target: { value: '0.3' } });
    fireEvent.change(screen.getByLabelText('Position (mm)'), { target: { value: '55' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

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
      jointLength: null,
      onSubmit: vi.fn(),
      onCancel,
    });
    render(<TenonMortiseDialog />);
    fireEvent.keyDown(screen.getByTestId('tenon-mortise-dialog'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().tenonMortiseDialog).toBeNull();
  });
});
