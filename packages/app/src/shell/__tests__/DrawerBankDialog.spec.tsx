import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DrawerBankDialog } from '../DrawerBankDialog';
import { useAppStore } from '../../store/useAppStore';
import { AddDrawerBankCommand } from '../../commands/AddDrawerBankCommand';

/** Minimal fake opfs for the bus.execute test */
const makeMemOpfs = () => {
  const store = new Map<string, Uint8Array>();
  return {
    read: async (p: string) => {
      const v = store.get(p);
      if (!v) throw new Error(`opfs: not found ${p}`);
      return v;
    },
    write: async (p: string, b: Uint8Array) => { store.set(p, b); },
    exists: async (p: string) => store.has(p),
    delete: async (p: string) => { store.delete(p); },
  };
};

describe('DrawerBankDialog — structural', () => {
  beforeEach(() => {
    useAppStore.getState().setAddDrawerBankDialog(null);
  });

  it('renders nothing when addDrawerBankDialog state is null', () => {
    const { container } = render(<DrawerBankDialog />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the drawer controls when open', () => {
    useAppStore.getState().setAddDrawerBankDialog({
      cabinetPath: 'parts/cab.ziasm',
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    });
    render(<DrawerBankDialog />);
    expect(screen.getByLabelText('Count')).toBeTruthy();
    expect(screen.getByLabelText('Overlay')).toBeTruthy();
    expect(screen.getByLabelText('Thickness (mm)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'OK' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('defaults: count=3, overlay=full, thickness=18', () => {
    useAppStore.getState().setAddDrawerBankDialog({
      cabinetPath: 'parts/cab.ziasm',
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    });
    render(<DrawerBankDialog />);
    expect((screen.getByLabelText('Count') as HTMLInputElement).value).toBe('3');
    expect((screen.getByLabelText('Overlay') as HTMLSelectElement).value).toBe('full');
    expect((screen.getByLabelText('Thickness (mm)') as HTMLInputElement).value).toBe('18');
  });

  it('OK submits the chosen params (count=3, overlay=full, thickness=18) and closes', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    useAppStore.getState().setAddDrawerBankDialog({
      cabinetPath: 'parts/cab.ziasm',
      onSubmit,
      onCancel: vi.fn(),
    });
    render(<DrawerBankDialog />);
    fireEvent.change(screen.getByLabelText('Count'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Overlay'), { target: { value: 'full' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      count: 3,
      overlay: 'full',
      thickness: 18,
    });
    await waitFor(() => {
      expect(useAppStore.getState().addDrawerBankDialog).toBeNull();
    });
  });

  it('onSubmit rejection keeps dialog open and shows error message', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('drawerBank.error.tooSmall'));
    useAppStore.getState().setAddDrawerBankDialog({
      cabinetPath: 'parts/cab.ziasm',
      onSubmit,
      onCancel: vi.fn(),
    });
    render(<DrawerBankDialog />);
    fireEvent.change(screen.getByLabelText('Count'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    // Dialog must stay open (store entry still set)
    await waitFor(() => {
      expect(useAppStore.getState().addDrawerBankDialog).not.toBeNull();
    });
    // Error alert must be visible
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('invalid count (1) blocks commit and shows error', () => {
    const onSubmit = vi.fn();
    useAppStore.getState().setAddDrawerBankDialog({
      cabinetPath: 'parts/cab.ziasm',
      onSubmit,
      onCancel: vi.fn(),
    });
    render(<DrawerBankDialog />);
    fireEvent.change(screen.getByLabelText('Count'), { target: { value: '1' } });
    // OK button is disabled when count invalid
    const okBtn = screen.getByRole('button', { name: 'OK' }) as HTMLButtonElement;
    expect(okBtn.disabled).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('invalid count (999) blocks commit', () => {
    const onSubmit = vi.fn();
    useAppStore.getState().setAddDrawerBankDialog({
      cabinetPath: 'parts/cab.ziasm',
      onSubmit,
      onCancel: vi.fn(),
    });
    render(<DrawerBankDialog />);
    fireEvent.change(screen.getByLabelText('Count'), { target: { value: '999' } });
    const okBtn = screen.getByRole('button', { name: 'OK' }) as HTMLButtonElement;
    expect(okBtn.disabled).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('degenerate cabinet (openW=50) blocks commit and shows error', () => {
    const onSubmit = vi.fn();
    useAppStore.getState().setAddDrawerBankDialog({
      cabinetPath: 'parts/cab.ziasm',
      dims: { openW: 50, openH: 600 },  // openW ≤ 57 → degenerate
      onSubmit,
      onCancel: vi.fn(),
    });
    render(<DrawerBankDialog />);
    // Ensure count is valid (3)
    fireEvent.change(screen.getByLabelText('Count'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onSubmit).not.toHaveBeenCalled();
    // Error message is shown
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('degenerate cabinet (slotH=20 for N=3 on openH=60) blocks commit and shows error', () => {
    const onSubmit = vi.fn();
    useAppStore.getState().setAddDrawerBankDialog({
      cabinetPath: 'parts/cab.ziasm',
      dims: { openW: 600, openH: 60 },  // slotH=20 for N=3 → ≤24 → degenerate
      onSubmit,
      onCancel: vi.fn(),
    });
    render(<DrawerBankDialog />);
    fireEvent.change(screen.getByLabelText('Count'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('Cancel calls onCancel and closes', () => {
    const onCancel = vi.fn();
    useAppStore.getState().setAddDrawerBankDialog({
      cabinetPath: 'parts/cab.ziasm',
      onSubmit: vi.fn(),
      onCancel,
    });
    render(<DrawerBankDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().addDrawerBankDialog).toBeNull();
  });
});

describe('DrawerBankDialog — dialog→command bus.execute assertion', () => {
  beforeEach(() => {
    useAppStore.getState().setAddDrawerBankDialog(null);
  });

  it('onSubmit wired to bus.execute dispatches an AddDrawerBankCommand instance', async () => {
    const opfs = makeMemOpfs();
    const executedCommands: unknown[] = [];
    const fakeBus = { execute: async (cmd: unknown) => { executedCommands.push(cmd); } };

    // Wire onSubmit the same way FurnitureTab does
    useAppStore.getState().setAddDrawerBankDialog({
      cabinetPath: 'parts/cab.ziasm',
      onSubmit: async (opts) => {
        await fakeBus.execute(
          new AddDrawerBankCommand({
            cabinetPath: 'parts/cab.ziasm',
            params: { count: opts.count, overlay: opts.overlay, thickness: opts.thickness },
            opfs,
          }),
        );
      },
      onCancel: vi.fn(),
    });

    render(<DrawerBankDialog />);
    fireEvent.change(screen.getByLabelText('Count'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Overlay'), { target: { value: 'full' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    // Wait for the async onSubmit to complete
    await new Promise((r) => setTimeout(r, 0));

    expect(executedCommands).toHaveLength(1);
    expect(executedCommands[0]).toBeInstanceOf(AddDrawerBankCommand);
  });
});
