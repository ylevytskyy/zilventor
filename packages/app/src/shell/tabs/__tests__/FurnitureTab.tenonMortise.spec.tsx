import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FurnitureTab from '../FurnitureTab';
import { useAppStore } from '../../../store/useAppStore';
import { AddTenonMortiseCommand } from '../../../commands/AddTenonMortiseCommand';
import { unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { inferManualJoint } from '@zilventor/shared';
import type { AssemblyDocument, PanelInput } from '@zilventor/shared';

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

  it('picking two panels in sequence opens the dialog with both paths', async () => {
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

    // Second pick (panel B) opens the dialog with both captured paths — jointLength
    // preload (P11 S3) is async, so the dialog appears after a microtask flush.
    capturedOnPicks[1]!('parts/panelB.zipt');
    await waitFor(() => expect(useAppStore.getState().tenonMortiseDialog).not.toBeNull());

    const dialog = useAppStore.getState().tenonMortiseDialog;
    expect(dialog?.panelPathA).toBe('parts/panelA.zipt');
    expect(dialog?.panelPathB).toBe('parts/panelB.zipt');
  });

  it('computes and passes jointLength to the dialog from the two panels\' real dims when they form a butt joint (P11 S3)', async () => {
    const capturedOnPicks: Array<(p: string) => void> = [];
    const pickFn = vi.fn().mockImplementation((_resolve: unknown, onPick: (p: string) => void) => {
      capturedOnPicks.push(onPick);
      return { pick: vi.fn(), cancel: vi.fn() };
    });
    useAppStore.setState({ viewport: { beginOneComponentPick: pickFn } as any });
    // Same L/B butt-joint geometry convention as AddTenonMortiseCommand.spec.ts.
    useAppStore.setState({
      activeAssembly: {
        ...seedAsm,
        components: [
          { id: 'C1', partPath: 'parts/panelA.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
          { id: 'C2', partPath: 'parts/panelB.zipt', position: { x: 18, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        ],
      },
    } as any);
    vi.mocked(unpackProject)
      .mockResolvedValueOnce({ manifest: { document: { featureTree: [{ kind: 'panel', length: 18, width: 720, thickness: 560 }] } } } as any)
      .mockResolvedValueOnce({ manifest: { document: { featureTree: [{ kind: 'panel', length: 564, width: 560, thickness: 18 }] } } } as any);

    // Independently-derived expected value (same center-pose conversion FurnitureTab uses).
    const aInput: PanelInput = { dims: { length: 18, width: 720, thickness: 560 }, pose: { translation: { x: 9, y: 360, z: 280 }, quaternion: [0, 0, 0, 1] } };
    const bInput: PanelInput = { dims: { length: 564, width: 560, thickness: 18 }, pose: { translation: { x: 300, y: 280, z: 9 }, quaternion: [0, 0, 0, 1] } };
    const joint = inferManualJoint(aInput, bInput)!;
    const expectedLen = Math.hypot(joint.line.p1.x - joint.line.p0.x, joint.line.p1.y - joint.line.p0.y, joint.line.p1.z - joint.line.p0.z);

    render(<FurnitureTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Tenon/Mortise' }));
    capturedOnPicks[0]!('parts/panelA.zipt');
    capturedOnPicks[1]!('parts/panelB.zipt');

    await waitFor(() => expect(useAppStore.getState().tenonMortiseDialog).not.toBeNull());
    expect(useAppStore.getState().tenonMortiseDialog?.jointLength).toBeCloseTo(expectedLen, 6);
  });

  it('opens the dialog with jointLength=null (no crash) when the picked panels do not form a butt joint (P11 S3)', async () => {
    const capturedOnPicks: Array<(p: string) => void> = [];
    const pickFn = vi.fn().mockImplementation((_resolve: unknown, onPick: (p: string) => void) => {
      capturedOnPicks.push(onPick);
      return { pick: vi.fn(), cancel: vi.fn() };
    });
    useAppStore.setState({ viewport: { beginOneComponentPick: pickFn } as any });
    // Panels far apart — valid dims but geometrically not a butt joint.
    useAppStore.setState({
      activeAssembly: {
        ...seedAsm,
        components: [
          { id: 'C1', partPath: 'parts/panelA.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
          { id: 'C2', partPath: 'parts/panelB.zipt', position: { x: 5000, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        ],
      },
    } as any);
    vi.mocked(unpackProject)
      .mockResolvedValueOnce({ manifest: { document: { featureTree: [{ kind: 'panel', length: 18, width: 720, thickness: 560 }] } } } as any)
      .mockResolvedValueOnce({ manifest: { document: { featureTree: [{ kind: 'panel', length: 564, width: 560, thickness: 18 }] } } } as any);

    render(<FurnitureTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Tenon/Mortise' }));
    capturedOnPicks[0]!('parts/panelA.zipt');
    capturedOnPicks[1]!('parts/panelB.zipt');

    await waitFor(() => expect(useAppStore.getState().tenonMortiseDialog).not.toBeNull());
    expect(useAppStore.getState().tenonMortiseDialog?.jointLength).toBeNull();
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

    await waitFor(() => expect(useAppStore.getState().tenonMortiseDialog).not.toBeNull());
    const dialog = useAppStore.getState().tenonMortiseDialog;

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

    await waitFor(() => expect(useAppStore.getState().tenonMortiseDialog).not.toBeNull());
    const dialog = useAppStore.getState().tenonMortiseDialog;
    await dialog!.onSubmit({ width: 8, depth: 12, count: 3, spacing: 32, fitClearance: 0.2 });

    // The mocked command is a no-op (fakeBus never touches OPFS), so the mocked
    // unpackProject returns the identical feature count before and after → toast fires.
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it('shows a clamp-warning toast when the executed command reports clamped=true (P11 S5)', async () => {
    const capturedOnPicks: Array<(p: string) => void> = [];
    const pickFn = vi.fn().mockImplementation((_resolve: unknown, onPick: (p: string) => void) => {
      capturedOnPicks.push(onPick);
      return { pick: vi.fn(), cancel: vi.fn() };
    });
    // The real command mutates featureTree.length via unpackProject; since unpackProject
    // is globally mocked to a fixed empty featureTree, before/after counts are always
    // equal regardless of the command's real work — mirror the "no-op" test's own
    // reliance on that mock, but flag the command instance as clamped via the fakeBus.
    const fakeBus = {
      execute: vi.fn(async (cmd: unknown) => { (cmd as { clamped: boolean }).clamped = true; }),
      canUndo: false, canRedo: false,
    };
    useAppStore.setState({
      viewport: { beginOneComponentPick: pickFn } as any,
      bus: fakeBus as any,
    });

    const showToast = vi.fn();
    render(<FurnitureTab showToast={showToast} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tenon/Mortise' }));
    capturedOnPicks[0]!('parts/panelA.zipt');
    capturedOnPicks[1]!('parts/panelB.zipt');

    await waitFor(() => expect(useAppStore.getState().tenonMortiseDialog).not.toBeNull());
    const dialog = useAppStore.getState().tenonMortiseDialog;
    await dialog!.onSubmit({
      width: 8, depth: 12, fitClearance: 0.2, layout: { mode: 'count', value: 3 },
    });

    expect(showToast).toHaveBeenCalledWith(
      "Auto-layout adjusted to fit the joint — requested count/pitch didn't fit within the edge.",
    );
  });

  it('does not show the clamp-warning toast when clamped=false', async () => {
    const capturedOnPicks: Array<(p: string) => void> = [];
    const pickFn = vi.fn().mockImplementation((_resolve: unknown, onPick: (p: string) => void) => {
      capturedOnPicks.push(onPick);
      return { pick: vi.fn(), cancel: vi.fn() };
    });
    const fakeBus = {
      execute: vi.fn(async (cmd: unknown) => { (cmd as { clamped: boolean }).clamped = false; }),
      canUndo: false, canRedo: false,
    };
    useAppStore.setState({
      viewport: { beginOneComponentPick: pickFn } as any,
      bus: fakeBus as any,
    });

    const showToast = vi.fn();
    render(<FurnitureTab showToast={showToast} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tenon/Mortise' }));
    capturedOnPicks[0]!('parts/panelA.zipt');
    capturedOnPicks[1]!('parts/panelB.zipt');

    await waitFor(() => expect(useAppStore.getState().tenonMortiseDialog).not.toBeNull());
    const dialog = useAppStore.getState().tenonMortiseDialog;
    await dialog!.onSubmit({ width: 8, depth: 12, count: 3, spacing: 32, fitClearance: 0.2 });

    // The fake bus never touches real OPFS, so the pre-existing no-op/toast heuristic
    // still fires (same limitation the "no-op" test above relies on) — this test only
    // narrows to the clamp-specific toast never firing when clamped=false.
    expect(showToast).not.toHaveBeenCalledWith(
      "Auto-layout adjusted to fit the joint — requested count/pitch didn't fit within the edge.",
    );
  });
});
