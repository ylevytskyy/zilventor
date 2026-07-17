import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import FurnitureTab from '../FurnitureTab';
import { useAppStore } from '../../../store/useAppStore';
import type { AssemblyDocument } from '@zilventor/shared';
import type { PanelManufacturingInput } from '../../../drawing/renderPanelManufacturingDxf';

// jsdom doesn't implement URL.createObjectURL — stub it for the DXF download fallback path.
Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:stub'), writable: true });
Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), writable: true });

const applyMock = vi.fn().mockResolvedValue(undefined);
const ctorSpy = vi.fn();
vi.mock('../../../commands/ExportViyarProFlattenDxfCommand', () => ({
  ExportViyarProFlattenDxfCommand: class {
    constructor(opts: unknown) { ctorSpy(opts); }
    apply() { return applyMock(); }
  },
}));

const stubInputs: PanelManufacturingInput[] = [
  { itemNumber: 1, partName: 'Side', materialName: 'White 18', qty: 1,
    spec: { length: 800, width: 600, thickness: 18, materialId: 'm', grain: 'length',
      edgeBands: { front: null, back: null, left: null, right: null } } as any,
    bores: [], grooves: [] },
];
vi.mock('../../usePanelManufacturingInputs', () => ({
  usePanelManufacturingInputs: () => stubInputs,
}));

const seedAsm: AssemblyDocument = {
  id: 'asm-1', name: 'cabinet', units: 'mm', parameters: {}, properties: {},
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

describe('FurnitureTab — ViyarPro flatten DXF export button', () => {
  beforeEach(() => {
    cleanup();
    ctorSpy.mockClear();
    applyMock.mockClear();
    useAppStore.setState({
      activePart: null,
      activeAssembly: null,
      activeDocument: null,
      panelDialog: null,
    } as Partial<ReturnType<typeof useAppStore.getState>>);
  });

  it('renders the Export DXF (ViyarPro) button, disabled with no active assembly', () => {
    render(<FurnitureTab />);
    const btn = screen.getByRole('button', { name: 'Export DXF (ViyarPro)' });
    expect(btn).toBeTruthy();
    expect(btn).toBeDisabled();
  });

  it('clicking the button (with an active assembly) constructs and applies ExportViyarProFlattenDxfCommand with the panel inputs and a -viyarpro.dxf suggested name', () => {
    setActiveAssembly();
    render(<FurnitureTab />);
    const btn = screen.getByRole('button', { name: 'Export DXF (ViyarPro)' });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(ctorSpy).toHaveBeenCalledWith({ inputs: stubInputs, suggestedName: 'cabinet-viyarpro.dxf' });
    expect(applyMock).toHaveBeenCalledTimes(1);
  });
});
