// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LegLevelersDialog } from '../LegLevelersDialog';
import { useAppStore } from '../../store/useAppStore';
import { AddLegLevelersCommand } from '../../commands/AddLegLevelersCommand';

describe('LegLevelersDialog — structural', () => {
  beforeEach(() => {
    useAppStore.getState().setAddLegLevelersDialog(null);
  });

  it('renders nothing when addLegLevelersDialog state is null', () => {
    const { container } = render(<LegLevelersDialog />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the title when open', () => {
    useAppStore.getState().setAddLegLevelersDialog({
      cabinetPath: 'parts/cab.ziasm',
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    });
    render(<LegLevelersDialog />);
    expect(screen.getByText('Add Leg Levelers')).toBeTruthy();
  });

  it('renders legsPerRow and sku controls when open', () => {
    useAppStore.getState().setAddLegLevelersDialog({
      cabinetPath: 'parts/cab.ziasm',
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    });
    render(<LegLevelersDialog />);
    expect(screen.getByLabelText('Legs per row')).toBeTruthy();
    expect(screen.getByLabelText('Leg model')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'OK' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('defaults: legsPerRow=2, skuId=leg-leveler-100', () => {
    useAppStore.getState().setAddLegLevelersDialog({
      cabinetPath: 'parts/cab.ziasm',
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    });
    render(<LegLevelersDialog />);
    expect((screen.getByLabelText('Legs per row') as HTMLInputElement).value).toBe('2');
    expect((screen.getByLabelText('Leg model') as HTMLSelectElement).value).toBe('leg-leveler-100');
  });

  it('OK disabled when legsPerRow < 2 (set to 1)', () => {
    const onSubmit = vi.fn();
    useAppStore.getState().setAddLegLevelersDialog({
      cabinetPath: 'parts/cab.ziasm',
      onSubmit,
      onCancel: vi.fn(),
    });
    render(<LegLevelersDialog />);
    fireEvent.change(screen.getByLabelText('Legs per row'), { target: { value: '1' } });
    const okBtn = screen.getByRole('button', { name: 'OK' }) as HTMLButtonElement;
    expect(okBtn.disabled).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('OK submits { legsPerRow: 2, skuId: "leg-leveler-100" } and closes', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    useAppStore.getState().setAddLegLevelersDialog({
      cabinetPath: 'parts/cab.ziasm',
      onSubmit,
      onCancel: vi.fn(),
    });
    render(<LegLevelersDialog />);
    // legsPerRow default is 2, skuId default is leg-leveler-100
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onSubmit).toHaveBeenCalledWith({ legsPerRow: 2, skuId: 'leg-leveler-100' });
    await waitFor(() => {
      expect(useAppStore.getState().addLegLevelersDialog).toBeNull();
    });
  });

  it('shows total legs helper (2*legsPerRow) when legsPerRow valid', () => {
    useAppStore.getState().setAddLegLevelersDialog({
      cabinetPath: 'parts/cab.ziasm',
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    });
    render(<LegLevelersDialog />);
    // Default legsPerRow=2 → total=4
    expect(screen.getByText(/Total legs: 4/)).toBeTruthy();
  });

  it('onSubmit rejection keeps dialog open and shows error', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('legLeveler.error.tooSmall'));
    useAppStore.getState().setAddLegLevelersDialog({
      cabinetPath: 'parts/cab.ziasm',
      onSubmit,
      onCancel: vi.fn(),
    });
    render(<LegLevelersDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => {
      expect(useAppStore.getState().addLegLevelersDialog).not.toBeNull();
    });
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('Cancel calls onCancel and closes', () => {
    const onCancel = vi.fn();
    useAppStore.getState().setAddLegLevelersDialog({
      cabinetPath: 'parts/cab.ziasm',
      onSubmit: vi.fn(),
      onCancel,
    });
    render(<LegLevelersDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().addLegLevelersDialog).toBeNull();
  });
});

describe('LegLevelersDialog — dialog→command bus.execute assertion', () => {
  beforeEach(() => {
    useAppStore.getState().setAddLegLevelersDialog(null);
  });

  it('onSubmit wired to bus.execute dispatches an AddLegLevelersCommand instance', async () => {
    const store = new Map<string, Uint8Array>();
    const opfs = {
      read: async (p: string) => { const v = store.get(p); if (!v) throw new Error(`opfs: not found ${p}`); return v; },
      write: async (p: string, b: Uint8Array) => { store.set(p, b); },
      exists: async (p: string) => store.has(p),
      delete: async (p: string) => { store.delete(p); },
    };
    const executedCommands: unknown[] = [];
    const fakeBus = { execute: async (cmd: unknown) => { executedCommands.push(cmd); } };

    useAppStore.getState().setAddLegLevelersDialog({
      cabinetPath: 'parts/cab.ziasm',
      onSubmit: async (opts) => {
        await fakeBus.execute(
          new AddLegLevelersCommand({
            cabinetPath: 'parts/cab.ziasm',
            params: { legsPerRow: opts.legsPerRow, skuId: opts.skuId },
            opfs,
          }),
        );
      },
      onCancel: vi.fn(),
    });

    render(<LegLevelersDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    await waitFor(() => {
      expect(executedCommands).toHaveLength(1);
    });

    expect(executedCommands[0]).toBeInstanceOf(AddLegLevelersCommand);
  });
});
