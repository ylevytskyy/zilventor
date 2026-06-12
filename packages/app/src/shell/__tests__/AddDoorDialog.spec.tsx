import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AddDoorDialog } from '../AddDoorDialog';
import { useAppStore } from '../../store/useAppStore';

describe('AddDoorDialog — structural', () => {
  beforeEach(() => {
    useAppStore.getState().setAddDoorDialog(null);
  });

  it('renders nothing when addDoorDialog state is null', () => {
    const { container } = render(<AddDoorDialog />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the door controls when open', () => {
    useAppStore.getState().setAddDoorDialog({ cabinetPath: 'parts/cab.ziasm', onSubmit: vi.fn(), onCancel: vi.fn() });
    render(<AddDoorDialog />);
    expect(screen.getByLabelText('Count')).toBeTruthy();
    expect(screen.getByLabelText('Hinge side')).toBeTruthy();
    expect(screen.getByLabelText('Overlay')).toBeTruthy();
    expect(screen.getByLabelText('Thickness (mm)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'OK' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('defaults: single / left / full / thickness 18 / reveal 2 / clearance 2 / centerReveal 3', () => {
    useAppStore.getState().setAddDoorDialog({ cabinetPath: 'parts/cab.ziasm', onSubmit: vi.fn(), onCancel: vi.fn() });
    render(<AddDoorDialog />);
    expect((screen.getByLabelText('Count') as HTMLSelectElement).value).toBe('single');
    expect((screen.getByLabelText('Hinge side') as HTMLSelectElement).value).toBe('left');
    expect((screen.getByLabelText('Overlay') as HTMLSelectElement).value).toBe('full');
    expect((screen.getByLabelText('Thickness (mm)') as HTMLInputElement).value).toBe('18');
    expect((screen.getByLabelText('Reveal (mm)') as HTMLInputElement).value).toBe('2');
    expect((screen.getByLabelText('Clearance (mm)') as HTMLInputElement).value).toBe('2');
    expect((screen.getByLabelText('Center reveal (mm)') as HTMLInputElement).value).toBe('3');
  });

  it('hinge-side control is disabled when count is double', () => {
    useAppStore.getState().setAddDoorDialog({ cabinetPath: 'parts/cab.ziasm', onSubmit: vi.fn(), onCancel: vi.fn() });
    render(<AddDoorDialog />);
    fireEvent.change(screen.getByLabelText('Count'), { target: { value: 'double' } });
    expect((screen.getByLabelText('Hinge side') as HTMLSelectElement).disabled).toBe(true);
  });

  it('OK submits the chosen params and closes', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    useAppStore.getState().setAddDoorDialog({ cabinetPath: 'parts/cab.ziasm', onSubmit, onCancel: vi.fn() });
    render(<AddDoorDialog />);
    fireEvent.change(screen.getByLabelText('Overlay'), { target: { value: 'inset' } });
    fireEvent.change(screen.getByLabelText('Hinge side'), { target: { value: 'right' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      count: 'single',
      overlay: 'inset',
      hingeSide: 'right',
      thickness: 18,
      reveal: 2,
      clearance: 2,
      centerReveal: 3,
    });
    // handleOk is now async — wait for the promise microtask to settle before checking state
    await waitFor(() => {
      expect(useAppStore.getState().addDoorDialog).toBeNull();
    });
  });

  it('onSubmit rejection keeps dialog open and shows an error alert', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('door geometry failed'));
    useAppStore.getState().setAddDoorDialog({ cabinetPath: 'parts/cab.ziasm', onSubmit, onCancel: vi.fn() });
    render(<AddDoorDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    // Dialog must remain open
    await waitFor(() => {
      expect(useAppStore.getState().addDoorDialog).not.toBeNull();
    });
    // Error alert must be visible with the rejection message
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('alert').textContent).toContain('door geometry failed');
  });

  it('Cancel calls onCancel and closes', () => {
    const onCancel = vi.fn();
    useAppStore.getState().setAddDoorDialog({ cabinetPath: 'parts/cab.ziasm', onSubmit: vi.fn(), onCancel });
    render(<AddDoorDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().addDoorDialog).toBeNull();
  });
});
