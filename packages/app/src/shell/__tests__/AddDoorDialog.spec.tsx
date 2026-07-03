import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AddDoorDialog } from '../AddDoorDialog';
import { useAppStore } from '../../store/useAppStore';
import type { MachiningPreset } from '@zilventor/shared';

const CUP_PRESET: MachiningPreset = {
  id: 'cup-1', name: 'Cup 40mm', opType: 'hingeCup',
  diameter: 40, depth: 14, layerName: 'CUP-CAM', toolNumber: 3, speed: 12000,
};
const PLATE_PRESET: MachiningPreset = {
  id: 'plate-1', name: 'Plate 6mm', opType: 'hingePlate',
  diameter: 6, depth: 15, layerName: 'PLATE-CAM',
};

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

// ── P15: hinge-cup / hinge-plate machining-preset dropdowns ──

describe('AddDoorDialog — machining presets (P15)', () => {
  beforeEach(() => {
    useAppStore.getState().setAddDoorDialog(null);
    useAppStore.setState({ machiningPresets: [] });
  });

  it('does not render preset dropdowns when no matching presets exist', () => {
    useAppStore.getState().setAddDoorDialog({ cabinetPath: 'parts/cab.ziasm', onSubmit: vi.fn(), onCancel: vi.fn() });
    render(<AddDoorDialog />);
    expect(screen.queryAllByLabelText('Machining preset')).toHaveLength(0);
  });

  it('selecting a hinge-cup preset and submitting includes cupPresetValues but not platePresetValues', () => {
    useAppStore.setState({ machiningPresets: [CUP_PRESET] });
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    useAppStore.getState().setAddDoorDialog({ cabinetPath: 'parts/cab.ziasm', onSubmit, onCancel: vi.fn() });
    render(<AddDoorDialog />);

    const presetSelects = screen.getAllByLabelText('Machining preset');
    expect(presetSelects).toHaveLength(1);
    fireEvent.change(presetSelects[0]!, { target: { value: 'cup-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    expect(onSubmit.mock.calls[0]![0].cupPresetValues).toEqual({
      diameter: 40, depth: 14, layerName: 'CUP-CAM', toolNumber: 3, speed: 12000,
    });
    expect(onSubmit.mock.calls[0]![0].platePresetValues).toBeUndefined();
  });

  it('selecting a hinge-plate preset and submitting includes platePresetValues but not cupPresetValues', () => {
    useAppStore.setState({ machiningPresets: [PLATE_PRESET] });
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    useAppStore.getState().setAddDoorDialog({ cabinetPath: 'parts/cab.ziasm', onSubmit, onCancel: vi.fn() });
    render(<AddDoorDialog />);

    const presetSelects = screen.getAllByLabelText('Machining preset');
    expect(presetSelects).toHaveLength(1);
    fireEvent.change(presetSelects[0]!, { target: { value: 'plate-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    expect(onSubmit.mock.calls[0]![0].platePresetValues).toEqual({
      diameter: 6, depth: 15, layerName: 'PLATE-CAM',
    });
    expect(onSubmit.mock.calls[0]![0].cupPresetValues).toBeUndefined();
  });

  it('with both presets available, selecting each independently submits both presetValues', () => {
    useAppStore.setState({ machiningPresets: [CUP_PRESET, PLATE_PRESET] });
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    useAppStore.getState().setAddDoorDialog({ cabinetPath: 'parts/cab.ziasm', onSubmit, onCancel: vi.fn() });
    render(<AddDoorDialog />);

    const presetSelects = screen.getAllByLabelText('Machining preset');
    expect(presetSelects).toHaveLength(2);
    fireEvent.change(presetSelects[0]!, { target: { value: 'cup-1' } }); // cup dropdown first
    fireEvent.change(presetSelects[1]!, { target: { value: 'plate-1' } }); // plate dropdown second
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    expect(onSubmit.mock.calls[0]![0].cupPresetValues).toEqual({
      diameter: 40, depth: 14, layerName: 'CUP-CAM', toolNumber: 3, speed: 12000,
    });
    expect(onSubmit.mock.calls[0]![0].platePresetValues).toEqual({
      diameter: 6, depth: 15, layerName: 'PLATE-CAM',
    });
  });

  it('"None" selected (default) omits both presetValues fields', () => {
    useAppStore.setState({ machiningPresets: [CUP_PRESET, PLATE_PRESET] });
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    useAppStore.getState().setAddDoorDialog({ cabinetPath: 'parts/cab.ziasm', onSubmit, onCancel: vi.fn() });
    render(<AddDoorDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onSubmit.mock.calls[0]![0].cupPresetValues).toBeUndefined();
    expect(onSubmit.mock.calls[0]![0].platePresetValues).toBeUndefined();
  });
});
