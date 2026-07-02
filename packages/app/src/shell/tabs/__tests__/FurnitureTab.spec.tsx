import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import FurnitureTab from '../FurnitureTab';
import { useAppStore } from '../../../store/useAppStore';
import { newPart } from '@zilventor/kernel/src/adapter/PartDocument';
import type { AssemblyDocument, PanelPreflightDiagnostic } from '@zilventor/shared';
import { CutListCacheContext } from '../../CutListCacheContext';

// jsdom doesn't implement URL.createObjectURL — stub it for the DXF download fallback path.
Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:stub'), writable: true });
Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), writable: true });

const seedAsm: AssemblyDocument = {
  id: 'A1', name: 'cabinet', units: 'mm', parameters: {}, properties: {},
  components: [],
  constraints: [],
  groundedComponentPaths: [],
  colors: {},
  bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
  materials: [],
  hardware: [],
};

function seedAssemblyMode() {
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

describe('FurnitureTab', () => {
  beforeEach(() => {
    cleanup();
    useAppStore.setState({
      activePart: null,
      activeAssembly: null,
      activeDocument: null,
      panelDialog: null,
    } as Partial<ReturnType<typeof useAppStore.getState>>);
  });

  it('renders the Create panel with a Panel button', () => {
    render(<FurnitureTab />);
    expect(screen.getByText('Create')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Panel/i })).toBeInTheDocument();
  });

  it('clicking Panel dispatches OpenPanelDialogCommand (panelDialog slot populated)', async () => {
    useAppStore.getState().setActivePart(newPart('P1'));
    render(<FurnitureTab />);
    fireEvent.click(screen.getByRole('button', { name: /Panel/i }));
    await waitFor(() => {
      expect(useAppStore.getState().panelDialog).not.toBeNull();
    });
    expect(useAppStore.getState().panelDialog!.mode).toBe('part');
  });

  it('Panel button is disabled when no part and no assembly is active', () => {
    render(<FurnitureTab />);
    const btn = screen.getByRole('button', { name: /Panel/i });
    expect(btn).toBeDisabled();
  });
});

describe('FurnitureTab Cut List panel (5d T21)', () => {
  beforeEach(() => {
    cleanup();
    seedAssemblyMode();
  });

  it('renders the Cut List ribbon panel with three buttons', () => {
    render(<FurnitureTab />);
    expect(screen.getByLabelText('Cut List panel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cut List' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Renumber' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeInTheDocument();
  });

  it('clicking Cut List dispatches OpenCutListTabCommand', async () => {
    render(<FurnitureTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Cut List' }));
    await waitFor(() => expect(useAppStore.getState().cutListTabActive).toBe(true));
  });

  it('clicking Renumber dispatches RenumberCutListCommand', async () => {
    render(<FurnitureTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Renumber' }));
    await waitFor(() => expect(useAppStore.getState().activeAssembly!.cutListItemNumbers).toEqual({}));
  });
});

// R1: production UI wiring — the boring/manufacturing DXF export commands must
// receive a live showToast so preflight diagnostics surface as visible toasts,
// not just a console.warn dropped upstream.
describe('FurnitureTab — R1 preflight toast wiring (production UI)', () => {
  const asmWithPanels: AssemblyDocument = {
    id: 'asm-r1', name: 'R1Cabinet', units: 'mm', parameters: {}, properties: {},
    components: [
      { id: 'C1', partPath: 'parts/bad.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      { id: 'C2', partPath: 'parts/ok.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ],
    constraints: [],
    groundedComponentPaths: [],
    colors: {},
    bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [],
    hardware: [],
  };

  const cutListDiagnostics: PanelPreflightDiagnostic[] = [
    { partPath: 'parts/bad.zipt', reasonKey: 'panel.preflight.missingMaterial', params: { name: 'BadPanel' } },
  ];

  function renderWithCache(showToast: (message: string) => void) {
    const ctxValue = {
      panelSpecCacheRef: {
        current: new Map<string, any>([
          ['parts/bad.zipt', null],
          ['parts/ok.zipt', {
            length: 600, width: 400, thickness: 18, materialId: 'm1', grain: 'length',
            edgeBands: { front: null, back: null, left: null, right: null },
          }],
        ]),
      },
      partInfoCacheRef: {
        current: new Map([
          ['parts/bad.zipt', { name: 'BadPanel' }],
          ['parts/ok.zipt', { name: 'OkPanel' }],
        ]),
      },
      partBoresCacheRef: {
        current: new Map([
          ['parts/bad.zipt', [{ id: 'b1', face: { featureId: 'panel', role: 'Front', instance: 0 },
            u: 10, v: 10, diameter: 5, depth: 10, role: 'confirmat-face', connectorId: 'c1', connectorKind: 'confirmat' }]],
        ]),
      },
      partGroovesCacheRef: { current: new Map() },
      diagnosticsCacheRef: { current: cutListDiagnostics },
      warmCache: async () => {},
      invalidatePartPaths: async () => {},
    };
    return render(
      <CutListCacheContext.Provider value={ctxValue as any}>
        <FurnitureTab showToast={showToast} />
      </CutListCacheContext.Provider>,
    );
  }

  beforeEach(() => {
    cleanup();
    useAppStore.setState({
      activeDocument: { kind: 'assembly', document: asmWithPanels },
      activeAssembly: asmWithPanels,
      activePart: null,
      bomTabActive: false,
      cutListTabActive: false,
      subAssemblyDocs: {},
      panelDialog: null,
    } as any);
  });

  it('clicking Export DXF (Boring) shows a toast for a preflight-failed panel', () => {
    const toasts: string[] = [];
    renderWithCache((msg) => toasts.push(msg));
    fireEvent.click(screen.getByRole('button', { name: 'Export DXF (Boring)' }));
    expect(toasts.some((m) => /BadPanel/.test(m) && /material/i.test(m))).toBe(true);
  });

  it('clicking Export DXF (Manufacturing) shows a toast for a diagnostic sourced from the cut-list result', () => {
    const toasts: string[] = [];
    renderWithCache((msg) => toasts.push(msg));
    fireEvent.click(screen.getByRole('button', { name: 'Export DXF (Manufacturing)' }));
    expect(toasts.some((m) => /BadPanel/.test(m) && /material/i.test(m))).toBe(true);
  });
});
