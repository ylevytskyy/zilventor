// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FurnitureTab from '../FurnitureTab';
import { useAppStore } from '../../../store/useAppStore';
import { AddFaceFrameCommand } from '../../../commands/AddFaceFrameCommand';
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
} as unknown as AssemblyDocument;

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

describe('FurnitureTab — Add Face Frame wiring', () => {
  beforeEach(() => {
    useAppStore.getState().setAddFaceFrameDialog(null);
    useAppStore.getState().setOneComponentPickHandle(null);
    setActiveAssembly();
  });

  it('renders the Add Face Frame button', () => {
    render(<FurnitureTab />);
    expect(screen.getByRole('button', { name: /add.face.frame/i })).toBeTruthy();
  });

  it('clicking Add Face Frame calls beginOneComponentPick and stores the handle', () => {
    const pickFn = vi.fn().mockReturnValue({ pick: vi.fn(), cancel: vi.fn() });
    useAppStore.setState({ viewport: { beginOneComponentPick: pickFn } as any });

    render(<FurnitureTab />);
    fireEvent.click(screen.getByRole('button', { name: /add.face.frame/i }));

    expect(pickFn).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().oneComponentPickHandle).not.toBeNull();
  });

  it('onPick callback sets addFaceFrameDialog with cabinetPath', () => {
    let capturedOnPick: ((cabinetPath: string) => void) | null = null;
    const pickFn = vi.fn().mockImplementation((_resolve: unknown, onPick: (p: string) => void) => {
      capturedOnPick = onPick;
      return { pick: vi.fn(), cancel: vi.fn() };
    });
    useAppStore.setState({ viewport: { beginOneComponentPick: pickFn } as any });

    render(<FurnitureTab />);
    fireEvent.click(screen.getByRole('button', { name: /add.face.frame/i }));

    capturedOnPick!('proj/cab1.ziasm');

    const dialog = useAppStore.getState().addFaceFrameDialog;
    expect(dialog).not.toBeNull();
    expect(dialog?.cabinetPath).toBe('proj/cab1.ziasm');
  });

  it('button → pick → dialog onSubmit executes a real AddFaceFrameCommand on the bus', async () => {
    // Stub viewport: beginOneComponentPick immediately invokes the pick callback with a cabinet path.
    let capturedOnPick: ((cabinetPath: string) => void) | null = null;
    const pickFn = vi.fn().mockImplementation((_resolve: unknown, onPick: (p: string) => void) => {
      capturedOnPick = onPick;
      return { pick: vi.fn(), cancel: vi.fn() };
    });
    useAppStore.setState({ viewport: { beginOneComponentPick: pickFn } as any });

    const executedCommands: unknown[] = [];
    const execute = vi.fn(async (cmd: unknown) => { executedCommands.push(cmd); });
    // @ts-expect-error partial bus for test
    useAppStore.setState({ bus: { execute, undo: async () => {}, redo: async () => {} } });

    render(<FurnitureTab />);
    fireEvent.click(screen.getByRole('button', { name: /add.face.frame/i }));

    // Simulate pick completing with a cabinet path
    capturedOnPick!('proj/cab1.ziasm');

    // The handler opened the dialog with a REAL onSubmit; capture and invoke it.
    const dlg = useAppStore.getState().addFaceFrameDialog;
    expect(dlg).toBeTruthy();
    await dlg!.onSubmit({ rows: 1, cols: 1, stileWidth: 38, railWidth: 38, thickness: 19 });

    // Must have been called exactly once with a real AddFaceFrameCommand instance
    expect(execute).toHaveBeenCalledTimes(1);
    expect(executedCommands[0]).toBeInstanceOf(AddFaceFrameCommand);
  });
});
