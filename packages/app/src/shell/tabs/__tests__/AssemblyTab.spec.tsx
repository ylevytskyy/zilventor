import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AssemblyTab } from '../AssemblyTab';
import { useAppStore } from '../../../store/useAppStore';
import type { AssemblyDocument } from '@zilventor/shared';

vi.mock('../../../commands/ImportStepAsComponentCommand', () => ({
  ImportStepAsComponentCommand: vi.fn().mockImplementation(() => ({
    name: 'ImportStepAsComponent',
    apply: vi.fn().mockResolvedValue(undefined),
    revert: vi.fn().mockResolvedValue(undefined),
  })),
}));
import { ImportStepAsComponentCommand } from '../../../commands/ImportStepAsComponentCommand';

vi.mock('@zilventor/kernel/src/storage/Opfs', () => ({
  Opfs: { forNavigator: vi.fn().mockResolvedValue({}) },
}));

vi.mock('../../../import/extractStepFromZip', () => ({
  extractStepFromZip: vi.fn(),
}));
import { extractStepFromZip } from '../../../import/extractStepFromZip';

describe('AssemblyTab', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().selectComponent(null);
    useAppStore.getState().resetPlaceComponentDialog();
    useAppStore.getState().resetEditComponentDialog();
  });

  it('Place button opens the place dialog', () => {
    const asm: AssemblyDocument = { id: 'A1', name: 'a', units: 'mm', parameters: {}, properties: {}, components: [], constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {}, materials: [] ,
    hardware: [],
    };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });
    render(<AssemblyTab />);
    fireEvent.click(screen.getByRole('button', { name: /^place$/i }));
    expect(useAppStore.getState().placeComponentDialogOpen).toBe(true);
  });

  it('Edit button is disabled until a component is selected', () => {
    const asm: AssemblyDocument = { id: 'A1', name: 'a', units: 'mm', parameters: {}, properties: {},
      components: [
        { id: 'C1', partPath: 'p', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
      constraints: [],
      groundedComponentPaths: [],
      colors: {},
      bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
      materials: [],
      hardware: [],
    };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });
    const { rerender } = render(<AssemblyTab />);
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeDisabled();
    useAppStore.getState().selectComponent('C1');
    rerender(<AssemblyTab />);
    expect(screen.getByRole('button', { name: /^edit$/i })).not.toBeDisabled();
  });
});

describe('AssemblyTab Constraint panel', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().selectComponent(null);
    useAppStore.getState().selectConstraint(null);
    useAppStore.getState().resetPlaceConstraintDialog();
    useAppStore.getState().resetEditConstraintDialog();
  });

  it('renders all 4 mode buttons (Mate / Flush / Angle / Insert)', () => {
    const asm: AssemblyDocument = { id: 'A1', name: 'a', units: 'mm', parameters: {}, properties: {}, components: [], constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {}, materials: [] ,
    hardware: [],
    };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });
    render(<AssemblyTab />);
    expect(screen.getByRole('button', { name: /^mate$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^flush$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^angle$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^insert$/i })).toBeInTheDocument();
  });

  it('Mate button opens placeConstraintDialog with mode=mate', () => {
    const asm: AssemblyDocument = { id: 'A1', name: 'a', units: 'mm', parameters: {}, properties: {}, components: [], constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {}, materials: [] ,
    hardware: [],
    };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });
    render(<AssemblyTab />);
    fireEvent.click(screen.getByRole('button', { name: /^mate$/i }));
    expect(useAppStore.getState().placeConstraintDialogOpen).toBe(true);
    expect(useAppStore.getState().placeConstraintMode).toBe('mate');
  });
});

describe('AssemblyTab BOM panel', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().selectComponent(null);
  });

  it('renders a BOM panel with BOM and Renumber buttons', () => {
    const asm: AssemblyDocument = { id: 'A1', name: 'a', units: 'mm', parameters: {}, properties: {}, components: [], constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {}, materials: [] ,
    hardware: [],
    };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });
    render(<AssemblyTab />);
    expect(screen.getByLabelText(/^BOM panel$/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^BOM$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Renumber$/i })).toBeInTheDocument();
  });

  it('BOM button sets bomTabActive=true', () => {
    const asm: AssemblyDocument = { id: 'A1', name: 'a', units: 'mm', parameters: {}, properties: {}, components: [], constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {}, materials: [] ,
    hardware: [],
    };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });
    useAppStore.setState({ bomTabActive: false } as any);
    render(<AssemblyTab />);
    fireEvent.click(screen.getByRole('button', { name: /^BOM$/i }));
    expect(useAppStore.getState().bomTabActive).toBe(true);
  });

  it('Renumber button assigns 1..N item numbers using provided partInfo', async () => {
    const asm: AssemblyDocument = {
      id: 'A1', name: 'a', units: 'mm', parameters: {}, properties: {},
      components: [
        { id: 'C1', partPath: 'parts/zelda.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        { id: 'C2', partPath: 'parts/alpha.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
      constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
      materials: [],
      hardware: [],
    };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });
    const partInfo = new Map([
      ['parts/alpha.zipt', { name: 'alpha' }],
      ['parts/zelda.zipt', { name: 'zelda' }],
    ]);
    render(<AssemblyTab partInfo={partInfo} />);
    fireEvent.click(screen.getByRole('button', { name: /^Renumber$/i }));
    await Promise.resolve();
    await Promise.resolve();
    const map = useAppStore.getState().activeAssembly!.bomItemNumbers;
    expect(map['parts/alpha.zipt::none']).toBe(1);
    expect(map['parts/zelda.zipt::none']).toBe(2);
  });
});

function makeDoc(name: string): AssemblyDocument {
  return {
    id: name, name, units: 'mm', parameters: {}, properties: {},
    components: [], constraints: [], groundedComponentPaths: [],
    colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [], hardware: [],
  };
}

describe('AssemblyTab — Insert From STEP… button', () => {
  beforeEach(() => {
    vi.mocked(ImportStepAsComponentCommand).mockClear();
    useAppStore.getState().setActiveDocument(null);
  });

  it('button is disabled when no active assembly', () => {
    render(<AssemblyTab />);
    const btn = screen.getByRole('button', { name: /insert from step/i });
    expect(btn).toBeDisabled();
  });

  it('button is enabled when an assembly is active', () => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: makeDoc('cabinet') });
    render(<AssemblyTab />);
    const btn = screen.getByRole('button', { name: /insert from step/i });
    expect(btn).not.toBeDisabled();
  });

  it('clicking the button calls ImportStepAsComponentCommand when a file is picked', async () => {
    useAppStore.setState((s) => ({ ...s, kernel: {} as any }));
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: makeDoc('cabinet') });

    const stepBytes = new Uint8Array([1, 2, 3]);
    const fakeFile = { name: 'hinge.step', arrayBuffer: async () => stepBytes.buffer };
    const fakeHandle = { getFile: async () => fakeFile } as unknown as FileSystemFileHandle;
    (window as any).showOpenFilePicker = vi.fn().mockResolvedValue([fakeHandle]);

    render(<AssemblyTab />);
    const btn = screen.getByRole('button', { name: /insert from step/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(vi.mocked(ImportStepAsComponentCommand)).toHaveBeenCalledOnce();
    });
    const args = vi.mocked(ImportStepAsComponentCommand).mock.calls[0]?.[0];
    expect(args?.fileName).toBe('hinge.step');
  });
});

describe('AssemblyTab — Insert From STEP… ZIP branch', () => {
  const FAKE_STEP_BYTES = new Uint8Array([1, 2, 3, 4]);

  beforeEach(() => {
    vi.mocked(ImportStepAsComponentCommand).mockClear();
    vi.mocked(extractStepFromZip).mockClear();
    useAppStore.setState((s) => ({ ...s, kernel: {} as any }));
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: makeDoc('cabinet') });
  });

  it('clicking Insert with a ZIP containing STEP dispatches ImportStepAsComponentCommand', async () => {
    vi.mocked(extractStepFromZip).mockReturnValue({
      fileName: 'Cadeira_preta.stp',
      stepBytes: FAKE_STEP_BYTES.buffer,
    });

    const zipBytes = new Uint8Array([80, 75, 3, 4]);
    const fakeFile = { name: 'Cadeira_preta.zip', arrayBuffer: async () => zipBytes.buffer };
    (window as any).showOpenFilePicker = vi.fn().mockResolvedValue([{ getFile: async () => fakeFile }]);

    render(<AssemblyTab />);
    const btn = screen.getByRole('button', { name: /insert from step/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(vi.mocked(ImportStepAsComponentCommand)).toHaveBeenCalledOnce();
    });
    const args = vi.mocked(ImportStepAsComponentCommand).mock.calls[0]?.[0];
    expect(args?.fileName).toBe('Cadeira_preta.stp');
  });

  it('clicking Insert with a ZIP without STEP sets the no-STEP status', async () => {
    vi.mocked(extractStepFromZip).mockReturnValue(null);

    const zipBytes = new Uint8Array([80, 75, 3, 4]);
    const fakeFile = { name: 'textures-only.zip', arrayBuffer: async () => zipBytes.buffer };
    (window as any).showOpenFilePicker = vi.fn().mockResolvedValue([{ getFile: async () => fakeFile }]);

    render(<AssemblyTab />);
    const btn = screen.getByRole('button', { name: /insert from step/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(useAppStore.getState().statusMessage).toMatch(/no step\/stp file found in archive/i);
    });
    expect(vi.mocked(ImportStepAsComponentCommand)).not.toHaveBeenCalled();
  });
});

