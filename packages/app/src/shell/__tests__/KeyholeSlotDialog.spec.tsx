// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { KeyholeSlotDialog } from '../KeyholeSlotDialog';
import { useAppStore } from '../../store/useAppStore';

describe('KeyholeSlotDialog', () => {
  beforeEach(() => {
    useAppStore.getState().setKeyholeSlotDialog(null);
  });

  it('renders nothing when no dialog state is set', () => {
    const { container } = render(<KeyholeSlotDialog />);
    expect(container.firstChild).toBeNull();
  });

  it('renders as a dialog with the resolved English fields and defaults', () => {
    useAppStore.getState().setKeyholeSlotDialog({ panelPath: 'parts/back.zipt', onSubmit: vi.fn(), onCancel: vi.fn() });
    render(<KeyholeSlotDialog />);

    expect(screen.getByRole('dialog', { name: 'Keyhole Slot dialog' })).toBeTruthy();
    expect(screen.getByText('Keyhole Slot')).toBeTruthy();
    expect(screen.getByLabelText('Face')).toBeTruthy();
    expect(screen.getByLabelText('Axis')).toBeTruthy();
    expect(screen.getByLabelText('Direction')).toBeTruthy();
    expect(screen.getByLabelText('U (mm)')).toBeTruthy();
    expect(screen.getByLabelText('V (mm)')).toBeTruthy();
    expect(screen.getByLabelText('Entry Diameter (mm)')).toHaveValue(15);
    expect(screen.getByLabelText('Slot Width (mm)')).toHaveValue(8);
    expect(screen.getByLabelText('Slot Length (mm)')).toHaveValue(25);
    expect(screen.getByLabelText('Depth (mm)')).toHaveValue(6);
    // Default face is fixed to 'Bottom' — the large rear face (Top/Bottom
    // are the two large faces; Front/Back/Left/Right are the narrow edges).
    expect(screen.getByLabelText('Face')).toHaveValue('Bottom');
  });

  it('submits the typed KeyholeSlotSpec and closes the dialog', async () => {
    const onSubmit = vi.fn();
    useAppStore.getState().setKeyholeSlotDialog({ panelPath: 'parts/back.zipt', onSubmit, onCancel: vi.fn() });
    render(<KeyholeSlotDialog />);

    fireEvent.change(screen.getByLabelText('U (mm)'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('V (mm)'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    expect(onSubmit).toHaveBeenCalledWith({
      faceRole: 'Bottom', axis: 'u', direction: 1,
      u: 100, v: 50, entryDiameter: 15, slotWidth: 8, slotLength: 25, depth: 6,
    });
    await waitFor(() => expect(useAppStore.getState().keyholeSlotDialog).toBeNull());
  });

  it('cancels on Escape without submitting', () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    useAppStore.getState().setKeyholeSlotDialog({ panelPath: 'parts/back.zipt', onSubmit, onCancel });
    render(<KeyholeSlotDialog />);

    fireEvent.keyDown(screen.getByTestId('keyhole-slot-dialog'), { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(useAppStore.getState().keyholeSlotDialog).toBeNull();
  });
});
