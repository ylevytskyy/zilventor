import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FurnitureTab from '../FurnitureTab';
import { useAppStore } from '../../../store/useAppStore';
import { AddTenonMortiseCommand } from '../../../commands/AddTenonMortiseCommand';
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

// Feature-count-diff no-op detection reads project bytes via unpackProject; mock it so
// before/after counts are controllable and identical unless a test overrides it.
vi.mock('@zilventor/kernel/src/storage/ProjectPacker', () => ({
  unpackProject: vi.fn().mockResolvedValue({ manifest: { document: { featureTree: [] } } }),
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

describe('FurnitureTab — Tenon/Mortise wiring', () => {
  beforeEach(() => {
    useAppStore.getState().setTenonMortiseDialog(null);
    useAppStore.getState().setOneComponentPickHandle(null);
    setActiveAssembly();
  });

  it('renders the Tenon/Mortise button in the ribbon panel', () => {
    render(<FurnitureTab />);
    expect(screen.getByRole('button', { name: 'Tenon/Mortise' })).toBeTruthy();
  });

  it('clicking the button initiates the first beginOneComponentPick', () => {
    const pickFn = vi.fn().mockReturnValue({ pick: vi.fn(), cancel: vi.fn() });
    useAppStore.setState({ viewport: { beginOneComponentPick: pickFn } as any });

    render(<FurnitureTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Tenon/Mortise' }));

    expect(pickFn).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().oneComponentPickHandle).not.toBeNull();
  });

  it('picking two panels in sequence opens the dialog with both paths', () => {
    const capturedOnPicks: Array<(p: string) => void> = [];
    const pickFn = vi.fn().mockImplementation((_resolve: unknown, onPick: (p: string) => void) => {
      capturedOnPicks.push(onPick);
      return { pick: vi.fn(), cancel: vi.fn() };
    });
    useAppStore.setState({ viewport: { beginOneComponentPick: pickFn } as any });

    render(<FurnitureTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Tenon/Mortise' }));

    // First pick (panel A) should immediately begin a second pick.
    capturedOnPicks[0]!('parts/panelA.zipt');
    expect(pickFn).toHaveBeenCalledTimes(2);

    // Second pick (panel B) opens the dialog with both captured paths.
    capturedOnPicks[1]!('parts/panelB.zipt');

    const dialog = useAppStore.getState().tenonMortiseDialog;
    expect(dialog).not.toBeNull();
    expect(dialog?.panelPathA).toBe('parts/panelA.zipt');
    expect(dialog?.panelPathB).toBe('parts/panelB.zipt');
  });

  it('onSubmit dispatches an AddTenonMortiseCommand with the exact typed params', async () => {
    const capturedOnPicks: Array<(p: string) => void> = [];
    const pickFn = vi.fn().mockImplementation((_resolve: unknown, onPick: (p: string) => void) => {
      capturedOnPicks.push(onPick);
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
    fireEvent.click(screen.getByRole('button', { name: 'Tenon/Mortise' }));
    capturedOnPicks[0]!('parts/panelA.zipt');
    capturedOnPicks[1]!('parts/panelB.zipt');

    const dialog = useAppStore.getState().tenonMortiseDialog;
    expect(dialog).not.toBeNull();

    await dialog!.onSubmit({
      width: 8,
      depth: 12,
      count: 3,
      spacing: 32,
      fitClearance: 0.2,
      position: 40,
    });

    expect(fakeBus.execute).toHaveBeenCalledTimes(1);
    const cmd = executedCommands[0];
    expect(cmd).toBeInstanceOf(AddTenonMortiseCommand);
    const opts = (cmd as any).opts;
    expect(opts.panelPathA).toBe('parts/panelA.zipt');
    expect(opts.panelPathB).toBe('parts/panelB.zipt');
    expect(opts.params).toEqual({
      width: 8,
      depth: 12,
      count: 3,
      spacing: 32,
      fitClearance: 0.2,
      position: 40,
    });
  });

  it('shows a toast when the picked panels do not form a butt joint (no-op)', async () => {
    const capturedOnPicks: Array<(p: string) => void> = [];
    const pickFn = vi.fn().mockImplementation((_resolve: unknown, onPick: (p: string) => void) => {
      capturedOnPicks.push(onPick);
      return { pick: vi.fn(), cancel: vi.fn() };
    });
    const fakeBus = { execute: vi.fn(async () => {}), canUndo: false, canRedo: false };
    useAppStore.setState({
      viewport: { beginOneComponentPick: pickFn } as any,
      bus: fakeBus as any,
    });

    const showToast = vi.fn();
    render(<FurnitureTab showToast={showToast} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tenon/Mortise' }));
    capturedOnPicks[0]!('parts/panelA.zipt');
    capturedOnPicks[1]!('parts/panelB.zipt');

    const dialog = useAppStore.getState().tenonMortiseDialog;
    await dialog!.onSubmit({ width: 8, depth: 12, count: 3, spacing: 32, fitClearance: 0.2 });

    // The mocked command is a no-op (fakeBus never touches OPFS), so the mocked
    // unpackProject returns the identical feature count before and after → toast fires.
    expect(showToast).toHaveBeenCalledTimes(1);
  });
});
