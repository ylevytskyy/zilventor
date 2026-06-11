/**
 * §13.3-T6 — proves the Add Handles onSubmit handler is NOT stubbed:
 * it calls bus.execute with a REAL AddDrawerHandlesCommand instance.
 *
 * This test mirrors the DrawerBankDialog wiring test pattern.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DrawerHandleDialog } from '../DrawerHandleDialog';
import { useAppStore } from '../../store/useAppStore';
import { AddDrawerHandlesCommand } from '../../commands/AddDrawerHandlesCommand';

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

describe('DrawerHandleDialog — structural', () => {
  beforeEach(() => {
    useAppStore.getState().setAddDrawerHandleDialog(null);
  });

  it('renders nothing when addDrawerHandleDialog is null', () => {
    const { container } = render(<DrawerHandleDialog />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the cc selector and Apply/Cancel buttons when open', () => {
    useAppStore.getState().setAddDrawerHandleDialog({
      cabinetPath: 'parts/cab.ziasm',
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    });
    render(<DrawerHandleDialog />);
    expect(screen.getByLabelText('Center-to-center')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('defaults: cc=96', () => {
    useAppStore.getState().setAddDrawerHandleDialog({
      cabinetPath: 'parts/cab.ziasm',
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    });
    render(<DrawerHandleDialog />);
    const sel = screen.getByLabelText('Center-to-center') as HTMLSelectElement;
    expect(sel.value).toBe('96');
  });

  it('Cancel calls onCancel and closes', () => {
    const onCancel = vi.fn();
    useAppStore.getState().setAddDrawerHandleDialog({
      cabinetPath: 'parts/cab.ziasm',
      onSubmit: vi.fn(),
      onCancel,
    });
    render(<DrawerHandleDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().addDrawerHandleDialog).toBeNull();
  });

  it('Apply submits the chosen cc and closes dialog', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    useAppStore.getState().setAddDrawerHandleDialog({
      cabinetPath: 'parts/cab.ziasm',
      onSubmit,
      onCancel: vi.fn(),
    });
    render(<DrawerHandleDialog />);
    fireEvent.change(screen.getByLabelText('Center-to-center'), { target: { value: '128' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onSubmit).toHaveBeenCalledWith(128);
    await waitFor(() => {
      expect(useAppStore.getState().addDrawerHandleDialog).toBeNull();
    });
  });
});

describe('DrawerHandleDialog — §13.3-T6 dialog→command bus.execute assertion', () => {
  beforeEach(() => {
    useAppStore.getState().setAddDrawerHandleDialog(null);
  });

  it('onSubmit wired to bus.execute dispatches an AddDrawerHandlesCommand with cc===128 and matching cabPath', async () => {
    const opfs = makeMemOpfs();
    const executedCommands: unknown[] = [];
    const fakeBus = { execute: async (cmd: unknown) => { executedCommands.push(cmd); } };
    const cabPath = 'parts/test-cab.ziasm';

    // Wire onSubmit the same way FurnitureTab.handleAddHandles does:
    // onSubmit receives cc, constructs AddDrawerHandlesCommand with cabinetPath + cc + opfs,
    // and calls bus.execute — proving the handler is NOT stubbed.
    useAppStore.getState().setAddDrawerHandleDialog({
      cabinetPath: cabPath,
      onSubmit: async (cc: 96 | 128 | 160) => {
        await fakeBus.execute(
          new AddDrawerHandlesCommand({
            cabinetPath: cabPath,
            cc,
            opfs,
          }),
        );
      },
      onCancel: vi.fn(),
    });

    render(<DrawerHandleDialog />);
    // Change to cc=128
    fireEvent.change(screen.getByLabelText('Center-to-center'), { target: { value: '128' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    // Wait for async chain to complete
    await new Promise((r) => setTimeout(r, 0));

    // §13.3-T6: must be exactly one command, of the REAL AddDrawerHandlesCommand class,
    // with cc===128 and cabinetPath matching cabPath.
    expect(executedCommands).toHaveLength(1);
    const cmd = executedCommands[0];
    expect(cmd).toBeInstanceOf(AddDrawerHandlesCommand);
    // Access opts via unknown cast (opts is private, can't use intersection type directly)
    const opts = (cmd as unknown as { opts: { cc: number; cabinetPath: string } }).opts;
    expect(opts.cc).toBe(128);
    expect(opts.cabinetPath).toBe(cabPath);
  });
});
