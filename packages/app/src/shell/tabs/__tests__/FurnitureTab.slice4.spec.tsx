import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FurnitureTab from '../FurnitureTab';
import { useAppStore } from '../../../store/useAppStore';
import { AddDrawerBankCommand } from '../../../commands/AddDrawerBankCommand';
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

describe('FurnitureTab — slice-4 Add Drawers wiring', () => {
  beforeEach(() => {
    useAppStore.getState().setAddDrawerBankDialog(null);
    useAppStore.getState().setOneComponentPickHandle(null);
    setActiveAssembly();
  });

  it('renders the Add Drawers button next to Add Door', () => {
    render(<FurnitureTab />);
    expect(screen.getByRole('button', { name: 'Add Drawers' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add Door' })).toBeTruthy();
  });

  it('clicking Add Drawers calls beginOneComponentPick and stores the handle', () => {
    const pickFn = vi.fn().mockReturnValue({ pick: vi.fn(), cancel: vi.fn() });
    useAppStore.setState({ viewport: { beginOneComponentPick: pickFn } as any });

    render(<FurnitureTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Drawers' }));

    expect(pickFn).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().oneComponentPickHandle).not.toBeNull();
  });

  it('onPick callback sets addDrawerBankDialog with cabinetPath', () => {
    let capturedOnPick: ((cabinetPath: string) => void) | null = null;
    const pickFn = vi.fn().mockImplementation((_resolve: unknown, onPick: (p: string) => void) => {
      capturedOnPick = onPick;
      return { pick: vi.fn(), cancel: vi.fn() };
    });
    useAppStore.setState({ viewport: { beginOneComponentPick: pickFn } as any });

    render(<FurnitureTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Drawers' }));

    // Simulate the user picking a cabinet
    capturedOnPick!('parts/cab.ziasm');

    const dialog = useAppStore.getState().addDrawerBankDialog;
    expect(dialog).not.toBeNull();
    expect(dialog?.cabinetPath).toBe('parts/cab.ziasm');
  });

  it('onSubmit in the dialog callback dispatches an AddDrawerBankCommand via bus', async () => {
    let capturedOnPick: ((cabinetPath: string) => void) | null = null;
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
    fireEvent.click(screen.getByRole('button', { name: 'Add Drawers' }));

    capturedOnPick!('parts/cab.ziasm');

    const dialog = useAppStore.getState().addDrawerBankDialog;
    expect(dialog).not.toBeNull();

    // Simulate onSubmit being called by the dialog
    await dialog!.onSubmit({ count: 3, overlay: 'full', thickness: 18 });

    expect(fakeBus.execute).toHaveBeenCalledTimes(1);
    expect(executedCommands[0]).toBeInstanceOf(AddDrawerBankCommand);
  });
});
