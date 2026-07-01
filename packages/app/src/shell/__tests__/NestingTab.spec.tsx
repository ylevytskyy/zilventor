import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { useAppStore } from '../../store/useAppStore';
import type { AssemblyDocument } from '@zilventor/shared';
import type { NestState } from '@zilventor/shared';

// Stub computeNestFingerprint so tests control the "current" fingerprint value
vi.mock('@zilventor/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zilventor/shared')>();
  return {
    ...actual,
    computeNestFingerprint: vi.fn().mockResolvedValue('current-fp'),
  };
});

import { computeNestFingerprint } from '@zilventor/shared';
import { NestingTab } from '../NestingTab';

// Stub GenerateNestCommand so bus.execute doesn't run real packing
vi.mock('../../commands/GenerateNestCommand', () => ({
  GenerateNestCommand: vi.fn().mockImplementation(() => ({
    name: 'GenerateNest',
    apply: vi.fn().mockResolvedValue(undefined),
    revert: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Stub ExportNestPngCommand so apply() doesn't run canvas/download logic
vi.mock('../../commands/ExportNestPngCommand', () => ({
  ExportNestPngCommand: vi.fn().mockImplementation(() => ({
    apply: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { GenerateNestCommand } from '../../commands/GenerateNestCommand';
import { ExportNestPngCommand } from '../../commands/ExportNestPngCommand';

const BASE_ASM: AssemblyDocument = {
  id: 'A1', name: 'Cabinet', units: 'mm',
  parameters: {}, properties: {},
  components: [], constraints: [], groundedComponentPaths: [],
  colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
  materials: [
    { id: 'm1', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896', sheetLengthMm: 2440, sheetWidthMm: 1220 },
  ],
  hardware: [],
};

const NEST_WITH_SHEETS: NestState = {
  params: { kerfMm: 3 },
  generatedAt: 1000,
  inputFingerprint: 'current-fp',
  sheets: [
    {
      materialId: 'm1', sheetIndex: 1, sheetLengthMm: 2440, sheetWidthMm: 1220,
      utilizationPct: 75.0,
      panels: [
        { itemNumber: 1, rowKey: 'r1', x: 0, y: 0, length: 600, width: 400, rotated: false, grain: 'none' },
      ],
    },
  ],
  excluded: [],
};

function seedAsm(nest?: NestState): void {
  const doc: AssemblyDocument = nest ? { ...BASE_ASM, nest } : BASE_ASM;
  useAppStore.getState().setActiveDocument({ kind: 'assembly', document: doc });
}

describe('NestingTab', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    vi.clearAllMocks();
    (computeNestFingerprint as ReturnType<typeof vi.fn>).mockResolvedValue('current-fp');
  });

  it('renders empty-state when activeAssembly.nest is undefined', () => {
    seedAsm(); // no nest
    render(<NestingTab />);
    expect(screen.getByText(/No nest generated yet/i)).toBeInTheDocument();
  });

  it('renders one section per material with sheet count and avg utilisation', async () => {
    seedAsm(NEST_WITH_SHEETS);
    render(<NestingTab />);
    // Material section header should appear with name + sheet count
    await waitFor(() => {
      expect(screen.getByText(/Birch 18mm/)).toBeInTheDocument();
      expect(screen.getByText(/1 sheet/)).toBeInTheDocument();
      expect(screen.getByText(/75\.0%/)).toBeInTheDocument();
    });
  });

  it('shows stale banner when current fingerprint differs from persisted', async () => {
    (computeNestFingerprint as ReturnType<typeof vi.fn>).mockResolvedValue('new-fp');
    const staleNest: NestState = { ...NEST_WITH_SHEETS, inputFingerprint: 'old-fp' };
    seedAsm(staleNest);
    render(<NestingTab />);
    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.getByText(/Cut list changed/i)).toBeInTheDocument();
    });
  });

  it('hides stale banner when fingerprints match', async () => {
    (computeNestFingerprint as ReturnType<typeof vi.fn>).mockResolvedValue('current-fp');
    seedAsm(NEST_WITH_SHEETS);
    render(<NestingTab />);
    // Wait for async fingerprint resolution
    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  it('clicking Regenerate dispatches GenerateNestCommand via bus', async () => {
    (computeNestFingerprint as ReturnType<typeof vi.fn>).mockResolvedValue('new-fp');
    const staleNest: NestState = { ...NEST_WITH_SHEETS, inputFingerprint: 'old-fp' };
    seedAsm(staleNest);
    render(<NestingTab />);
    await waitFor(() => {
      expect(screen.getByText(/Regenerate/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(/Regenerate/i));
    await waitFor(() => {
      expect(GenerateNestCommand).toHaveBeenCalledTimes(1);
    });
  });

  it('renders ExcludedSection when nest.excluded is non-empty', async () => {
    const nestWithExcluded: NestState = {
      ...NEST_WITH_SHEETS,
      excluded: [{ materialId: 'm2', reason: 'no-sheet-stock', itemNumbers: [5] }],
    };
    seedAsm(nestWithExcluded);
    render(<NestingTab />);
    await waitFor(() => {
      expect(screen.getByLabelText('Nest excluded section')).toBeInTheDocument();
      expect(screen.getByText(/no sheet stock defined/i)).toBeInTheDocument();
    });
  });

  it('clicking Export PNG button dispatches ExportNestPngCommand via .apply()', async () => {
    seedAsm(NEST_WITH_SHEETS);
    render(<NestingTab />);
    await waitFor(() => {
      expect(screen.getByLabelText('Export PNG sheet 1')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText('Export PNG sheet 1'));
    await waitFor(() => {
      expect(ExportNestPngCommand).toHaveBeenCalledTimes(1);
    });
  });
});
