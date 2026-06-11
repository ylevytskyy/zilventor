/**
 * Task-3 wiring test — §13.3-T6 (slice-6 review gap).
 *
 * Exercises the REAL FurnitureTab.handleAddHandles path
 * (not an inline closure in DrawerHandleDialog.wiring.spec.tsx).
 * This test would FAIL if handleAddHandles were stubbed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FurnitureTab from '../FurnitureTab';
import { useAppStore } from '../../../store/useAppStore';
import { AddDrawerHandlesCommand } from '../../../commands/AddDrawerHandlesCommand';
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

describe('FurnitureTab — slice-6 Add Handles wiring', () => {
  beforeEach(() => {
    useAppStore.getState().setAddDrawerHandleDialog(null);
    useAppStore.getState().setOneComponentPickHandle(null);
    setActiveAssembly();
  });

  it('renders the Add Handles button', () => {
    render(<FurnitureTab />);
    expect(screen.getByRole('button', { name: 'Add Handles' })).toBeTruthy();
  });

  it('clicking Add Handles calls beginOneComponentPick and stores the handle', () => {
    const pickFn = vi.fn().mockReturnValue({ pick: vi.fn(), cancel: vi.fn() });
    useAppStore.setState({ viewport: { beginOneComponentPick: pickFn } as any });

    render(<FurnitureTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Handles' }));

    expect(pickFn).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().oneComponentPickHandle).not.toBeNull();
  });

  it('onPick callback sets addDrawerHandleDialog with cabinetPath', () => {
    let capturedOnPick: ((cabinetPath: string) => void) | null = null;
    const pickFn = vi.fn().mockImplementation((_resolve: unknown, onPick: (p: string) => void) => {
      capturedOnPick = onPick;
      return { pick: vi.fn(), cancel: vi.fn() };
    });
    useAppStore.setState({ viewport: { beginOneComponentPick: pickFn } as any });

    render(<FurnitureTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Handles' }));

    capturedOnPick!('parts/cab.ziasm');

    const dialog = useAppStore.getState().addDrawerHandleDialog;
    expect(dialog).not.toBeNull();
    expect(dialog?.cabinetPath).toBe('parts/cab.ziasm');
  });

  /**
   * §13.3-T6 key assertion: the real handleAddHandles wiring.
   * Captures the onSubmit registered via setAddDrawerHandleDialog,
   * invokes it with cc=128, and asserts bus.execute was called with
   * an instanceof AddDrawerHandlesCommand whose cc===128 and
   * cabinetPath matches the picked path.
   *
   * Would FAIL if handleAddHandles were stubbed to skip AddDrawerHandlesCommand.
   */
  it('onSubmit in the dialog callback dispatches an AddDrawerHandlesCommand with cc===128 and matching cabinetPath', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Add Handles' }));

    const cabPath = 'parts/test-cab.ziasm';
    capturedOnPick!(cabPath);

    const dialog = useAppStore.getState().addDrawerHandleDialog;
    expect(dialog).not.toBeNull();
    expect(dialog?.cabinetPath).toBe(cabPath);

    // Invoke the real onSubmit registered by handleAddHandles with cc=128
    await dialog!.onSubmit(128);

    expect(fakeBus.execute).toHaveBeenCalledTimes(1);
    const cmd = executedCommands[0];
    expect(cmd).toBeInstanceOf(AddDrawerHandlesCommand);
    // Verify cc and cabinetPath via the opts field (private, accessed via cast)
    const opts = (cmd as unknown as { opts: { cc: number; cabinetPath: string } }).opts;
    expect(opts.cc).toBe(128);
    expect(opts.cabinetPath).toBe(cabPath);
  });
});
