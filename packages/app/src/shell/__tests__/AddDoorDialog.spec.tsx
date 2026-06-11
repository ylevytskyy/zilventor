import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

  it('OK submits the chosen params and closes', () => {
    const onSubmit = vi.fn();
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
    expect(useAppStore.getState().addDoorDialog).toBeNull();
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
