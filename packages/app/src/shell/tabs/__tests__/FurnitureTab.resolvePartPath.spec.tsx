/**
 * Locking test for the resolvePartPath cabinet-vs-leaf bug.
 *
 * FurnitureTab's shared `resolvePartPath` helper resolves a viewport pick's
 * ComponentPath to a LEAF panel's .zipt path — but 5 handlers (Add Door, Add
 * Drawers, Add Leg Levelers, Add Handles, Add Face Frame) need the CONTAINING
 * CABINET's .ziasm path, since they feed it to unpackAssembly (which throws
 * on a leaf .zipt). This test captures the REAL resolver closure each handler
 * passes to viewport.beginOneComponentPick and invokes it directly with a
 * 2-element path [cabinetComponentId, panelComponentId] — reproducing what a
 * raycast hit on a panel nested inside a cabinet actually resolves to.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FurnitureTab from '../FurnitureTab';
import { useAppStore } from '../../../store/useAppStore';
import type { AssemblyDocument, ComponentPath } from '@zilventor/shared';

// Mock Opfs.forNavigator — not available in jsdom
vi.mock('@zilventor/kernel/src/storage/Opfs', () => ({
  Opfs: {
    forNavigator: vi.fn().mockResolvedValue({
      read: vi.fn().mockResolvedValue(new Uint8Array()),
      write: vi.fn(),
      exists: vi.fn().mockResolvedValue(false),
      delete: vi.fn(),
    }),
  },
}));

// Mock unpackAssembly and deriveCabinetDims used by handleAddDrawers' pick callback
vi.mock('@zilventor/kernel/src/storage/AssemblyPacker', () => ({
  packAssembly: vi.fn(),
  unpackAssembly: vi.fn().mockResolvedValue({
    id: 'cab1', name: 'Cabinet', units: 'mm', parameters: {}, properties: {},
    components: [], constraints: [], groundedComponentPaths: [],
    colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [], hardware: [],
  }),
}));

vi.mock('../../../commands/cabinetDims', () => ({
  deriveCabinetDims: vi.fn().mockResolvedValue({
    width: 600, height: 760, depth: 560, Tc: 18, toekickHeight: 100,
  }),
}));

const seedAsm: AssemblyDocument = {
  id: 'asm-1', name: 'Test', units: 'mm', parameters: {}, properties: {},
  components: [
    {
      id: 'cab1',
      partPath: 'proj/cab1.ziasm',
      position: { x: 0, y: 0, z: 0 },
      rotation: { rx: 0, ry: 0, rz: 0 },
      visible: true,
    },
  ],
  constraints: [],
  groundedComponentPaths: [],
  colors: {},
  bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
  materials: [],
  hardware: [],
};

const seedSubAssemblyDocs: Record<string, AssemblyDocument> = {
  'proj/cab1.ziasm': {
    id: 'cab1', name: 'Cabinet', units: 'mm', parameters: {}, properties: {},
    components: [
      {
        id: 'panel1',
        partPath: 'proj/panel1.zipt',
        position: { x: 0, y: 0, z: 0 },
        rotation: { rx: 0, ry: 0, rz: 0 },
        visible: true,
      },
    ],
    constraints: [],
    groundedComponentPaths: [],
    colors: {},
    bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [],
    hardware: [],
  },
};

function setActiveAssembly(): void {
  useAppStore.setState({
    activeDocument: { kind: 'assembly', document: seedAsm },
    activeAssembly: seedAsm,
    activePart: null,
    bomTabActive: false,
    cutListTabActive: false,
    subAssemblyDocs: seedSubAssemblyDocs,
    panelDialog: null,
  } as any);
}

// A clicked panel nested inside a cabinet raycasts to this 2-element path:
// [cabinetComponentId, panelComponentId].
const clickedPanelPath: ComponentPath = ['cab1', 'panel1'] as unknown as ComponentPath;

type Resolver = (path: ComponentPath) => string;

function captureResolver(buttonName: string): Resolver {
  let captured: Resolver | null = null;
  const pickFn = vi.fn().mockImplementation((resolve: Resolver) => {
    captured = resolve;
    return { pick: vi.fn(), cancel: vi.fn() };
  });
  useAppStore.setState({ viewport: { beginOneComponentPick: pickFn } as any });

  render(<FurnitureTab />);
  fireEvent.click(screen.getByRole('button', { name: buttonName }));

  expect(captured).not.toBeNull();
  return captured!;
}

describe('FurnitureTab — cabinet-picker resolvers must resolve to the CABINET .ziasm path, not the leaf panel', () => {
  beforeEach(() => {
    useAppStore.getState().setOneComponentPickHandle(null);
    useAppStore.getState().setAddDoorDialog(null);
    useAppStore.getState().setAddDrawerBankDialog(null);
    useAppStore.getState().setAddLegLevelersDialog(null);
    useAppStore.getState().setAddDrawerHandleDialog(null);
    useAppStore.getState().setAddFaceFrameDialog(null);
    setActiveAssembly();
  });

  it('Add Door resolver returns the cabinet .ziasm path for a nested-panel pick', () => {
    const resolver = captureResolver('Add Door');
    expect(resolver(clickedPanelPath)).toBe('proj/cab1.ziasm');
  });

  it('Add Drawers resolver returns the cabinet .ziasm path for a nested-panel pick', () => {
    const resolver = captureResolver('Add Drawers');
    expect(resolver(clickedPanelPath)).toBe('proj/cab1.ziasm');
  });

  it('Add Leg Levelers resolver returns the cabinet .ziasm path for a nested-panel pick', () => {
    const resolver = captureResolver('Add Leg Levelers');
    expect(resolver(clickedPanelPath)).toBe('proj/cab1.ziasm');
  });

  it('Add Handles resolver returns the cabinet .ziasm path for a nested-panel pick', () => {
    const resolver = captureResolver('Add Handles');
    expect(resolver(clickedPanelPath)).toBe('proj/cab1.ziasm');
  });

  it('Add Face Frame resolver returns the cabinet .ziasm path for a nested-panel pick', () => {
    const resolver = captureResolver('Add Face Frame');
    expect(resolver(clickedPanelPath)).toBe('proj/cab1.ziasm');
  });
});
