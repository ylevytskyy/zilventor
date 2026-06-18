import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FurnitureTab from '../FurnitureTab';
import { useAppStore } from '../../../store/useAppStore';
import { AddGrooveCommand } from '../../../commands/AddGrooveCommand';
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

describe('FurnitureTab — Groove wiring', () => {
  beforeEach(() => {
    useAppStore.getState().setGrooveDialog(null);
    useAppStore.getState().setOneComponentPickHandle(null);
    setActiveAssembly();
  });

  it('renders the Groove button in the Присадка ribbon panel', () => {
    render(<FurnitureTab />);
    expect(screen.getByRole('button', { name: 'Groove' })).toBeTruthy();
  });

  it('clicking Groove calls beginOneComponentPick and stores the handle', () => {
    const pickFn = vi.fn().mockReturnValue({ pick: vi.fn(), cancel: vi.fn() });
    useAppStore.setState({ viewport: { beginOneComponentPick: pickFn } as any });

    render(<FurnitureTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Groove' }));

    expect(pickFn).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().oneComponentPickHandle).not.toBeNull();
  });

  it('onPick callback sets grooveDialog with panelPath', () => {
    let capturedOnPick: ((panelPath: string) => void) | null = null;
    const pickFn = vi.fn().mockImplementation((_resolve: unknown, onPick: (p: string) => void) => {
      capturedOnPick = onPick;
      return { pick: vi.fn(), cancel: vi.fn() };
    });
    useAppStore.setState({ viewport: { beginOneComponentPick: pickFn } as any });

    render(<FurnitureTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Groove' }));

    // Simulate the user picking a panel
    capturedOnPick!('parts/panel.zipt');

    const dialog = useAppStore.getState().grooveDialog;
    expect(dialog).not.toBeNull();
    expect(dialog?.panelPath).toBe('parts/panel.zipt');
  });

  it('onSubmit in the groove dialog dispatches an AddGrooveCommand via bus', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Groove' }));

    capturedOnPick!('parts/panel.zipt');

    const dialog = useAppStore.getState().grooveDialog;
    expect(dialog).not.toBeNull();

    // Simulate onSubmit being called by the dialog with a GrooveSpec
    await dialog!.onSubmit({
      faceRole: 'Bottom',
      axis: 'u',
      position: 50,
      width: 6,
      depth: 9,
    });

    expect(fakeBus.execute).toHaveBeenCalledTimes(1);
    expect(executedCommands[0]).toBeInstanceOf(AddGrooveCommand);
  });
});
