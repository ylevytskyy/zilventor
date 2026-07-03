import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FurnitureTab from '../FurnitureTab';
import { useAppStore } from '../../../store/useAppStore';
import { AddKeyholeSlotCommand } from '../../../commands/AddKeyholeSlotCommand';
import type { AssemblyDocument } from '@zilventor/shared';

// Mock Opfs.forNavigator — not available in jsdom
vi.mock('@zilventor/kernel/src/storage/Opfs', () => ({
  Opfs: {
    forNavigator: vi.fn().mockResolvedValue({
      read: vi.fn(),
      write: vi.fn(),
      exists: vi.fn().mockResolvedValue(false),
      delete: vi.fn(),
    }),
  },
}));

const seedAsm: AssemblyDocument = {
  id: 'asm-1', name: 'Test', units: 'mm', parameters: {}, properties: {},
  components: [],
  constraints: [],
  groundedComponentPaths: [],
  colors: {},
  bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
  materials: [],
  hardware: [],
};

function setActiveAssembly(): void {
  useAppStore.setState({
    activeDocument: { kind: 'assembly', document: seedAsm },
    activeAssembly: seedAsm,
    activePart: null,
    bomTabActive: false,
    cutListTabActive: false,
    subAssemblyDocs: {},
    panelDialog: null,
  } as any);
}

describe('FurnitureTab — Keyhole Slot wiring', () => {
  beforeEach(() => {
    useAppStore.getState().setKeyholeSlotDialog(null);
    useAppStore.getState().setOneComponentPickHandle(null);
    setActiveAssembly();
  });

  it('renders the Keyhole Slot button in the Присадка ribbon panel', () => {
    render(<FurnitureTab />);
    expect(screen.getByRole('button', { name: 'Keyhole Slot' })).toBeTruthy();
  });

  it('clicking Keyhole Slot calls beginOneComponentPick and stores the handle', () => {
    const pickFn = vi.fn().mockReturnValue({ pick: vi.fn(), cancel: vi.fn() });
    useAppStore.setState({ viewport: { beginOneComponentPick: pickFn } as any });

    render(<FurnitureTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Keyhole Slot' }));

    expect(pickFn).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().oneComponentPickHandle).not.toBeNull();
  });

  it('onPick callback sets keyholeSlotDialog with panelPath', () => {
    let capturedOnPick: ((panelPath: string) => void) | null = null;
    const pickFn = vi.fn().mockImplementation((_resolve: unknown, onPick: (p: string) => void) => {
      capturedOnPick = onPick;
      return { pick: vi.fn(), cancel: vi.fn() };
    });
    useAppStore.setState({ viewport: { beginOneComponentPick: pickFn } as any });

    render(<FurnitureTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Keyhole Slot' }));

    // Simulate the user picking a panel
    capturedOnPick!('parts/back.zipt');

    const dialog = useAppStore.getState().keyholeSlotDialog;
    expect(dialog).not.toBeNull();
    expect(dialog?.panelPath).toBe('parts/back.zipt');
  });

  it('onSubmit in the keyhole slot dialog dispatches an AddKeyholeSlotCommand via bus', async () => {
    let capturedOnPick: ((panelPath: string) => void) | null = null;
    const pickFn = vi.fn().mockImplementation((_resolve: unknown, onPick: (p: string) => void) => {
      capturedOnPick = onPick;
      return { pick: vi.fn(), cancel: vi.fn() };
    });

    const executedCommands: unknown[] = [];
    const fakeBus = {
      execute: vi.fn(async (cmd: unknown) => { executedCommands.push(cmd); }),
      canUndo: false, canRedo: false,
    };
    useAppStore.setState({
      viewport: { beginOneComponentPick: pickFn } as any,
      bus: fakeBus as any,
    });

    render(<FurnitureTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Keyhole Slot' }));

    capturedOnPick!('parts/back.zipt');

    const dialog = useAppStore.getState().keyholeSlotDialog;
    expect(dialog).not.toBeNull();

    // Simulate onSubmit being called by the dialog with a KeyholeSlotSpec
    await dialog!.onSubmit({
      faceRole: 'Back',
      axis: 'u',
      direction: 1,
      u: 100,
      v: 50,
      entryDiameter: 15,
      slotWidth: 8,
      slotLength: 25,
      depth: 6,
    });

    expect(fakeBus.execute).toHaveBeenCalledTimes(1);
    const cmd = executedCommands[0];
    expect(cmd).toBeInstanceOf(AddKeyholeSlotCommand);
    const opts = (cmd as any).opts;
    expect(opts.partPath).toBe('parts/back.zipt');
    expect(opts.keyholeSlot).toEqual({
      faceRole: 'Back', axis: 'u', direction: 1, u: 100, v: 50,
      entryDiameter: 15, slotWidth: 8, slotLength: 25, depth: 6,
    });
  });
});
