import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ShelfPinDialog } from '../ShelfPinDialog';
import { useAppStore } from '../../store/useAppStore';

describe('ShelfPinDialog — structural', () => {
  beforeEach(() => {
    useAppStore.getState().setShelfPinDialog(null);
    useAppStore.setState({ machiningPresets: [] });
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

  it('renders a start offset field defaulting to 0 and submits it', () => {
    const onSubmit = vi.fn();
    useAppStore.getState().setShelfPinDialog({ mode: 'auto', onSubmit, onCancel: vi.fn() });
    render(<ShelfPinDialog />);
    const field = screen.getByLabelText('Start offset (mm)') as HTMLInputElement;
    expect(field.value).toBe('0'); // default 0 = current centered behavior
    fireEvent.change(field, { target: { value: '16' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ startOffset: 16 });
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

describe('ShelfPinDialog — machining preset picker (P9 W2a)', () => {
  beforeEach(() => {
    useAppStore.getState().setShelfPinDialog(null);
    useAppStore.setState({ machiningPresets: [] });
  });

  it('lists only shelfPin-system32 presets, defaulting to None, and submits no presetValues key when None stays selected', () => {
    useAppStore.setState({
      machiningPresets: [
        { id: 'p1', name: 'Shop Ø6', opType: 'shelfPin-system32', diameter: 6, depth: 14, layerName: 'SHELF', toolNumber: 3, speed: 12000 },
        { id: 'p2', name: 'Wrong opType', opType: 'legLeveler', diameter: 4, depth: 10, layerName: 'LEG' },
      ],
    });
    const onSubmit = vi.fn();
    useAppStore.getState().setShelfPinDialog({ mode: 'auto', onSubmit, onCancel: vi.fn() });
    render(<ShelfPinDialog />);
    const select = screen.getByLabelText('Machining preset') as HTMLSelectElement;
    expect(select.value).toBe('');
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toContain('p1');
    expect(optionValues).not.toContain('p2');

    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0]).not.toHaveProperty('presetValues');
  });

  it('selecting a preset snapshots its values into presetValues on submit', () => {
    useAppStore.setState({
      machiningPresets: [
        { id: 'p1', name: 'Shop Ø6', opType: 'shelfPin-system32', diameter: 6, depth: 14, layerName: 'SHELF', toolNumber: 3, speed: 12000 },
      ],
    });
    const onSubmit = vi.fn();
    useAppStore.getState().setShelfPinDialog({ mode: 'auto', onSubmit, onCancel: vi.fn() });
    render(<ShelfPinDialog />);
    fireEvent.change(screen.getByLabelText('Machining preset'), { target: { value: 'p1' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onSubmit.mock.calls[0]![0].presetValues).toEqual({
      diameter: 6, depth: 14, layerName: 'SHELF', toolNumber: 3, speed: 12000,
    });
  });
});
