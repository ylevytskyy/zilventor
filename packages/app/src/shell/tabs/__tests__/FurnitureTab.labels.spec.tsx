import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import FurnitureTab from '../FurnitureTab';
import { useAppStore } from '../../../store/useAppStore';
import type { AssemblyDocument } from '@zilventor/shared';
import type { CutListResult } from '@zilventor/shared/src/cutListRow';

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
  } as any);
}

describe('FurnitureTab — Export Labels (PDF) ribbon button', () => {
  beforeEach(() => {
    seedAssemblyMode();
  });

  it('renders an enabled "Export Labels (PDF)" button when the assembly has a cut-list', () => {
    render(<FurnitureTab />);
    const btn = screen.getByText('Export Labels (PDF)');
    expect(btn).toBeInTheDocument();
    expect(btn.closest('button')).not.toBeDisabled();
  });
});
