import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HardwareDialog } from '../HardwareDialog';
import { useAppStore } from '../../store/useAppStore';

beforeEach(() => {
  useAppStore.getState().setHardwareDialog(null);
});

function openDialog(onSubmit = vi.fn(), onCancel = vi.fn()) {
  useAppStore.getState().setHardwareDialog({ onSubmit, onCancel });
}

describe('HardwareDialog', () => {
  it('renders nothing when hardwareDialog is null', () => {
    render(<HardwareDialog />);
    expect(screen.queryByRole('dialog', { name: /hardware/i })).toBeNull();
  });

  it('renders when hardwareDialog is set', () => {
    openDialog();
    render(<HardwareDialog />);
    expect(screen.getByRole('dialog', { name: /hardware/i })).toBeTruthy();
  });

  it('shows category dropdown defaulting to Hinges', () => {
    openDialog();
    render(<HardwareDialog />);
    const select = screen.getByRole('combobox', { name: /category/i });
    expect((select as HTMLSelectElement).value).toBe('hinges');
  });

  it('variant grid shows 4 hinge entries by default', () => {
    openDialog();
    render(<HardwareDialog />);
    const items = screen.getAllByRole('radio');
    expect(items).toHaveLength(4);
  });

  it('switching category to Shelf Pins shows 3 SKUs', () => {
    openDialog();
    render(<HardwareDialog />);
    const select = screen.getByRole('combobox', { name: /category/i });
    fireEvent.change(select, { target: { value: 'shelfPins' } });
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('Esc key calls onCancel', () => {
    const onCancel = vi.fn();
    openDialog(vi.fn(), onCancel);
    render(<HardwareDialog />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('OK calls onSubmit with selected SKU and qty=1 by default', () => {
    const onSubmit = vi.fn();
    openDialog(onSubmit);
    render(<HardwareDialog />);
    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }));
    expect(onSubmit).toHaveBeenCalledWith('hinge-35mm-cup-full', 1);
  });

  it('incrementing qty to 2 passes qty=2 to onSubmit', () => {
    const onSubmit = vi.fn();
    openDialog(onSubmit);
    render(<HardwareDialog />);
    fireEvent.click(screen.getByRole('button', { name: /increment qty/i }));
    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }));
    expect(onSubmit).toHaveBeenCalledWith('hinge-35mm-cup-full', 2);
  });
});
