import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProductionTab } from '../ProductionTab';
import { useAppStore } from '../../store/useAppStore';
import type { AssemblyDocument } from '@zilventor/shared';
import type { CutListResult } from '@zilventor/shared/src/cutListRow';

// Stub useCutListResult to return a non-empty cut list (real hook needs OPFS/kernel)
const mockCutListResult: CutListResult = {
  rows: [
    {
      rowKey: 'r1',
      itemNumber: 1,
      qty: 2,
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
vi.mock('../useCutListResult', () => ({
  useCutListResult: () => mockCutListResult,
}));

let capturedExportOpts: Record<string, unknown> | null = null;
vi.mock('../../commands/ExportPackingSlipPdfCommand', () => ({
  ExportPackingSlipPdfCommand: vi.fn().mockImplementation((opts: Record<string, unknown>) => {
    capturedExportOpts = opts;
    return { apply: vi.fn().mockResolvedValue(undefined) };
  }),
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
  } as any);
}

const ROW1_QR = 'Z|1|1/2|600x400x18|Birch Ply';

describe('ProductionTab', () => {
  beforeEach(() => {
    capturedExportOpts = null;
    seedAssemblyMode();
  });

  it('renders one row per physical panel copy, all not-produced initially', () => {
    render(<ProductionTab />);
    expect(screen.getByTestId('production-status-1:1')).toHaveTextContent('Not produced');
    expect(screen.getByTestId('production-status-1:2')).toHaveTextContent('Not produced');
    expect(screen.getByTestId('production-progress')).toHaveTextContent('0 / 2 produced');
  });

  it('clicking the toggle button marks that copy produced via SetProducedCommand (correct key only)', () => {
    render(<ProductionTab />);
    fireEvent.click(screen.getAllByText('Mark produced')[0]!);
    expect(useAppStore.getState().activeAssembly?.producedPanels?.['1:1']).toBe(true);
    expect(useAppStore.getState().activeAssembly?.producedPanels?.['1:2']).toBeUndefined();
  });

  it('manual-entry happy path: exact QR payload marks the matching copy produced', () => {
    render(<ProductionTab />);
    fireEvent.change(screen.getByLabelText('Enter panel code'), { target: { value: ROW1_QR } });
    fireEvent.click(screen.getByText('Submit Code'));
    expect(useAppStore.getState().activeAssembly?.producedPanels?.['1:1']).toBe(true);
    expect(screen.getByTestId('production-feedback')).toHaveTextContent('Panel marked produced.');
  });

  it('invalid code shows an error and does not mark anything produced', () => {
    render(<ProductionTab />);
    fireEvent.change(screen.getByLabelText('Enter panel code'), { target: { value: 'not-a-qr-code' } });
    fireEvent.click(screen.getByText('Submit Code'));
    expect(screen.getByTestId('production-feedback')).toHaveTextContent(
      'Invalid code — not a recognized panel QR payload.',
    );
    expect(useAppStore.getState().activeAssembly?.producedPanels).toBeUndefined();
  });

  it('a code with mismatched dimensions shows codeMismatch and does not mark produced', () => {
    render(<ProductionTab />);
    const mismatched = 'Z|1|1/2|601x400x18|Birch Ply'; // valid format, wrong length
    fireEvent.change(screen.getByLabelText('Enter panel code'), { target: { value: mismatched } });
    fireEvent.click(screen.getByText('Submit Code'));
    expect(screen.getByTestId('production-feedback')).toHaveTextContent(
      "This code's dimensions or material don't match the panel on file.",
    );
    expect(useAppStore.getState().activeAssembly?.producedPanels?.['1:1']).toBeUndefined();
  });

  it('re-scanning an already-produced copy shows an informational message, not an error', () => {
    render(<ProductionTab />);
    fireEvent.change(screen.getByLabelText('Enter panel code'), { target: { value: ROW1_QR } });
    fireEvent.click(screen.getByText('Submit Code'));
    fireEvent.change(screen.getByLabelText('Enter panel code'), { target: { value: ROW1_QR } });
    fireEvent.click(screen.getByText('Submit Code'));
    expect(screen.getByTestId('production-feedback')).toHaveTextContent(
      'This panel copy was already marked produced.',
    );
    expect(useAppStore.getState().activeAssembly?.producedPanels?.['1:1']).toBe(true);
  });

  it('clicking Export Packing Slip forwards computed rows and a suggested name', () => {
    render(<ProductionTab />);
    fireEvent.click(screen.getByText('Export Packing Slip (PDF)'));
    expect(capturedExportOpts).toMatchObject({ suggestedName: 'cabinet-packing-slip.pdf' });
    expect((capturedExportOpts!.rows as unknown[]).length).toBe(1);
  });
});
