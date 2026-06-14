// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FaceFrameDialog } from '../FaceFrameDialog';
import { useAppStore } from '../../store/useAppStore';

// Covers the keep-open-on-error guard (the slice-6 silent-swallow false-green class):
// when onSubmit rejects (e.g. layoutFaceFrame's degenerate-opening throw bubbling up
// through the command + bus), the dialog must display the error AND stay open.
describe('FaceFrameDialog', () => {
  beforeEach(() => {
    useAppStore.getState().setAddFaceFrameDialog(null);
  });

  it('keeps the dialog open and shows the error when onSubmit rejects (no silent swallow)', async () => {
    const onSubmit = vi.fn(async () => {
      throw new Error('face frame: opening collapses — too many columns for the cabinet width');
    });
    useAppStore.getState().setAddFaceFrameDialog({ cabinetPath: 'c.ziasm', onSubmit, onCancel: vi.fn() });

    render(<FaceFrameDialog />);
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));

    // Error surfaces via t(msg, { defaultValue: msg }) → the raw thrown message.
    expect(await screen.findByText(/opening collapses/i)).toBeTruthy();
    // Dialog stays open — the store state was NOT cleared.
    expect(useAppStore.getState().addFaceFrameDialog).not.toBeNull();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('closes the dialog when onSubmit resolves', async () => {
    const onSubmit = vi.fn(async () => {});
    useAppStore.getState().setAddFaceFrameDialog({ cabinetPath: 'c.ziasm', onSubmit, onCancel: vi.fn() });

    render(<FaceFrameDialog />);
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));

    await waitFor(() => expect(useAppStore.getState().addFaceFrameDialog).toBeNull());
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
