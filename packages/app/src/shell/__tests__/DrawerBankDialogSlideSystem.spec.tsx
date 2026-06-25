// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { DrawerBankDialog } from '../DrawerBankDialog';
import { useAppStore } from '../../store/useAppStore';
import '../../test-setup';

describe('DrawerBankDialog — slideSystem dropdown', () => {
  it('renders a slide-system select defaulting to sideMount', () => {
    const onSubmit = vi.fn();
    useAppStore.getState().setAddDrawerBankDialog({
      cabinetPath: 'Cab.ziasm',
      dims: { openW: 600, openH: 500 },
      onSubmit,
      onCancel: vi.fn(),
    });
    render(<DrawerBankDialog />);
    const sel = screen.getByRole('combobox', { name: /slide system/i });
    expect(sel).toBeDefined();
    expect((sel as HTMLSelectElement).value).toBe('sideMount');
  });

  it('onSubmit receives slideSystem=tandem when tandem selected', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    useAppStore.getState().setAddDrawerBankDialog({
      cabinetPath: 'Cab.ziasm',
      dims: { openW: 600, openH: 500 },
      onSubmit,
      onCancel: vi.fn(),
    });
    render(<DrawerBankDialog />);
    const sel = screen.getByRole('combobox', { name: /slide system/i });
    fireEvent.change(sel, { target: { value: 'tandem' } });
    const okBtn = screen.getByRole('button', { name: /ok/i });
    fireEvent.click(okBtn);
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const call = onSubmit.mock.calls[0]![0];
    expect(call.slideSystem).toBe('tandem');
  });

  it('onSubmit receives slideSystem=sideMount by default', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    useAppStore.getState().setAddDrawerBankDialog({
      cabinetPath: 'Cab.ziasm',
      dims: { openW: 600, openH: 500 },
      onSubmit,
      onCancel: vi.fn(),
    });
    render(<DrawerBankDialog />);
    const okBtn = screen.getByRole('button', { name: /ok/i });
    fireEvent.click(okBtn);
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const call = onSubmit.mock.calls[0]![0];
    expect(call.slideSystem).toBe('sideMount');
  });
});
