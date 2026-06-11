import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ShelfPinDialog } from '../ShelfPinDialog';
import { useAppStore } from '../../store/useAppStore';

describe('ShelfPinDialog — structural', () => {
  beforeEach(() => {
    useAppStore.getState().setShelfPinDialog(null);
  });

  it('renders nothing when shelfPinDialog state is null', () => {
    const { container } = render(<ShelfPinDialog />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the param controls with standard defaults', () => {
    useAppStore.getState().setShelfPinDialog({ mode: 'auto', onSubmit: vi.fn(), onCancel: vi.fn() });
    render(<ShelfPinDialog />);
    expect((screen.getByLabelText('Pitch (mm)') as HTMLInputElement).value).toBe('32');
    expect((screen.getByLabelText('Diameter (mm)') as HTMLInputElement).value).toBe('5');
    expect((screen.getByLabelText('Depth (mm)') as HTMLInputElement).value).toBe('13');
    expect((screen.getByLabelText('Front setback (mm)') as HTMLInputElement).value).toBe('37');
    expect((screen.getByLabelText('Back setback (mm)') as HTMLInputElement).value).toBe('37');
    expect((screen.getByLabelText('Top margin (mm)') as HTMLInputElement).value).toBe('64');
    expect((screen.getByLabelText('Bottom margin (mm)') as HTMLInputElement).value).toBe('64');
    expect((screen.getByLabelText('Columns') as HTMLSelectElement).value).toBe('2');
  });

  it('OK submits the params (numeric) and closes', () => {
    const onSubmit = vi.fn();
    useAppStore.getState().setShelfPinDialog({ mode: 'auto', onSubmit, onCancel: vi.fn() });
    render(<ShelfPinDialog />);
    fireEvent.change(screen.getByLabelText('Pitch (mm)'), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText('Columns'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      pitch: 25,
      diameter: 5,
      depth: 13,
      frontSetback: 37,
      backSetback: 37,
      topMargin: 64,
      bottomMargin: 64,
      columns: 1,
    });
    expect(useAppStore.getState().shelfPinDialog).toBeNull();
  });

  it('Cancel calls onCancel and closes', () => {
    const onCancel = vi.fn();
    useAppStore.getState().setShelfPinDialog({ mode: 'auto', onSubmit: vi.fn(), onCancel });
    render(<ShelfPinDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().shelfPinDialog).toBeNull();
  });
});
