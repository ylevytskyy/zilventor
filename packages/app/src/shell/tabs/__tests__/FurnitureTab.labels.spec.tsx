import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FurnitureTab from '../FurnitureTab';
import { useAppStore } from '../../../store/useAppStore';
import type { AssemblyDocument } from '@zilventor/shared';
import type { CutListResult } from '@zilventor/shared/src/cutListRow';
import type { LabelHeaderPreset } from '../../../store/labelHeaderPreset';

let capturedExportOpts: Record<string, unknown> | null = null;
vi.mock('../../../commands/ExportPanelLabelsCommand', () => ({
  ExportPanelLabelsCommand: vi.fn().mockImplementation((opts: Record<string, unknown>) => {
    capturedExportOpts = opts;
    return { apply: vi.fn().mockResolvedValue(undefined) };
  }),
}));

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

// Stub useCutListResult to return a non-empty cut list (real hook needs OPFS/kernel)
const mockCutListResult: CutListResult = {
  rows: [
    {
      rowKey: 'r1',
      itemNumber: 1,
      qty: 1,
      length: 600,
      width: 400,
      thickness: 18,
      materialId: 'm1',
      materialName: 'Birch Ply',
      grain: 'length',
      edgeBands: { front: null, back: null, left: null, right: null },
      partPath: 'parts/panel.zipt',
      partName: 'Side Panel',
      componentPathKeys: ['c1'],
    },
  ],
  bandTotals: [],
  excluded: { componentCount: 0, partCount: 0 },
};
vi.mock('../../useCutListResult', () => ({
  useCutListResult: () => mockCutListResult,
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

function seedAssemblyMode(): void {
  useAppStore.setState({
    activeDocument: { kind: 'assembly', document: seedAsm },
    activeAssembly: seedAsm,
    activePart: null,
    bomTabActive: false,
    cutListTabActive: false,
    subAssemblyDocs: {},
    panelDialog: null,
    labelTemplate: 'rich',
    labelHeaderLine1: '',
    labelHeaderLine2: '',
    labelHeaderPresets: [],
    labelHeaderPresetsDialogOpen: false,
  } as any);
}

describe('FurnitureTab — Export Labels (PDF) ribbon button', () => {
  beforeEach(() => {
    capturedExportOpts = null;
    seedAssemblyMode();
  });

  it('renders an enabled "Export Labels (PDF)" button when the assembly has a cut-list', () => {
    render(<FurnitureTab />);
    const btn = screen.getByText('Export Labels (PDF)');
    expect(btn).toBeInTheDocument();
    expect(btn.closest('button')).not.toBeDisabled();
  });
});

describe('FurnitureTab — label template controls', () => {
  beforeEach(() => {
    capturedExportOpts = null;
    seedAssemblyMode();
  });

  it('renders Rich/Compact template toggle with Rich pressed by default', () => {
    render(<FurnitureTab />);
    const rich = screen.getByText('Rich').closest('button')!;
    const compact = screen.getByText('Compact').closest('button')!;
    expect(rich).toHaveAttribute('aria-pressed', 'true');
    expect(compact).toHaveAttribute('aria-pressed', 'false');
  });

  it('clicking Compact updates the store labelTemplate', () => {
    render(<FurnitureTab />);
    fireEvent.click(screen.getByText('Compact'));
    expect(useAppStore.getState().labelTemplate).toBe('compact');
  });

  it('renders two header-line text inputs bound to the store', () => {
    render(<FurnitureTab />);
    const line1 = screen.getByLabelText('Header line 1') as HTMLInputElement;
    const line2 = screen.getByLabelText('Header line 2') as HTMLInputElement;
    fireEvent.change(line1, { target: { value: 'Acme Cabinets' } });
    fireEvent.change(line2, { target: { value: 'Order #123' } });
    expect(useAppStore.getState().labelHeaderLine1).toBe('Acme Cabinets');
    expect(useAppStore.getState().labelHeaderLine2).toBe('Order #123');
  });

  it('selecting a preset copies its line1/line2 into the live fields without mutating the preset', () => {
    const preset: LabelHeaderPreset = { id: 'h1', name: 'Kitchen job', line1: 'Acme Cabinets', line2: 'Order #123' };
    useAppStore.setState({ labelHeaderPresets: [preset] });
    render(<FurnitureTab />);
    fireEvent.change(screen.getByLabelText('Load header preset'), { target: { value: 'h1' } });
    expect(useAppStore.getState().labelHeaderLine1).toBe('Acme Cabinets');
    expect(useAppStore.getState().labelHeaderLine2).toBe('Order #123');
    expect(useAppStore.getState().labelHeaderPresets).toEqual([preset]);
  });

  it('renders a manage-presets button that opens the presets dialog', () => {
    render(<FurnitureTab />);
    fireEvent.click(screen.getByText('Manage Header Presets'));
    expect(useAppStore.getState().labelHeaderPresetsDialogOpen).toBe(true);
  });

  it('forwards the current template and header lines to ExportPanelLabelsCommand', () => {
    useAppStore.setState({ labelTemplate: 'compact', labelHeaderLine1: 'Acme Cabinets', labelHeaderLine2: 'Order #123' });
    render(<FurnitureTab />);
    fireEvent.click(screen.getByText('Export Labels (PDF)'));
    expect(capturedExportOpts).toMatchObject({
      templateId: 'compact',
      headerLine1: 'Acme Cabinets',
      headerLine2: 'Order #123',
    });
  });
});
