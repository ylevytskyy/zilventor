import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BoringDialog } from '../BoringDialog';
import { useAppStore } from '../../store/useAppStore';

describe('BoringDialog — structural', () => {
  beforeEach(() => {
    useAppStore.getState().setBoringDialog(null);
  });

  it('renders nothing when boringDialog state is null', () => {
    const { container } = render(<BoringDialog />);
    expect(container.firstChild).toBeNull();
  });

  it('renders connector-type checkboxes when open', () => {
    useAppStore.getState().setBoringDialog({ onSubmit: vi.fn(), onCancel: vi.fn() });
    render(<BoringDialog />);
    expect(screen.getByLabelText('Confirmat')).toBeTruthy();
    expect(screen.getByLabelText('Minifix')).toBeTruthy();
    expect(screen.getByLabelText('Dowel')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'OK' })).toBeTruthy();
  });

  it('confirmat is checked by default; minifix and dowel are unchecked', () => {
    useAppStore.getState().setBoringDialog({ onSubmit: vi.fn(), onCancel: vi.fn() });
    render(<BoringDialog />);
    expect((screen.getByLabelText('Confirmat') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Minifix') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('Dowel') as HTMLInputElement).checked).toBe(false);
  });

  it('OK disabled when no connector type is selected', () => {
    useAppStore.getState().setBoringDialog({ onSubmit: vi.fn(), onCancel: vi.fn() });
    render(<BoringDialog />);
    // uncheck confirmat
    fireEvent.click(screen.getByLabelText('Confirmat'));
    expect(screen.getByRole('button', { name: 'OK' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('OK calls onSubmit with confirmat:true when only confirmat checked', () => {
    const onSubmit = vi.fn();
    useAppStore.getState().setBoringDialog({ onSubmit, onCancel: vi.fn() });
    render(<BoringDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      confirmat: true,
      minifix: false,
      dowel: false,
    });
  });

  it('OK calls onSubmit with minifix:true when minifix toggled on', () => {
    const onSubmit = vi.fn();
    useAppStore.getState().setBoringDialog({ onSubmit, onCancel: vi.fn() });
    render(<BoringDialog />);
    fireEvent.click(screen.getByLabelText('Confirmat')); // uncheck
    fireEvent.click(screen.getByLabelText('Minifix'));   // check
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      confirmat: false,
      minifix: true,
      dowel: false,
    });
  });

  it('Cancel calls onCancel and closes the dialog', () => {
    const onCancel = vi.fn();
    useAppStore.getState().setBoringDialog({ onSubmit: vi.fn(), onCancel });
    render(<BoringDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().boringDialog).toBeNull();
  });
});
