import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CutListTable } from '../CutListTable';
import type { CutListResult } from '@zilventor/shared/src/cutListRow';

const result: CutListResult = {
  rows: [
    {
      rowKey: 'k1', itemNumber: 1, qty: 3,
      length: 600, width: 400, thickness: 18,
      materialId: 'm-birch', materialName: 'Birch 18mm',
      grain: 'length',
      edgeBands: {
        front: { materialId: 'm-pvc', materialName: 'PVC 1mm white', thickness: 0.4 },
        back: null, left: null, right: null,
      },
      partPath: 'parts/side.zipt', partName: 'Side',
      componentPathKeys: ['p1', 'p2', 'p3'],
    },
  ],
  bandTotals: [{ materialId: 'm-pvc', materialName: 'PVC 1mm white', totalLengthMm: 1800 }],
  excluded: { componentCount: 2, partCount: 1 },
};

describe('CutListTable', () => {
  it('renders panel rows from CutListResult', () => {
    render(<CutListTable result={result} onSelectRow={() => {}} onEditItemNumber={() => {}} onExportCsv={() => {}} />);
    expect(screen.getByText('Birch 18mm')).toBeInTheDocument();
    expect(screen.getAllByText('PVC 1mm white').length).toBeGreaterThan(0);
    expect(screen.getByText('Side')).toBeInTheDocument();
  });

  it('renders the band-totals subsection when non-empty', () => {
    render(<CutListTable result={result} onSelectRow={() => {}} onEditItemNumber={() => {}} onExportCsv={() => {}} />);
    expect(screen.getByText('1800 mm')).toBeInTheDocument();
  });

  it('hides band-totals subsection when empty', () => {
    const r = { ...result, bandTotals: [] };
    render(<CutListTable result={r} onSelectRow={() => {}} onEditItemNumber={() => {}} onExportCsv={() => {}} />);
    expect(screen.queryByText(/Total Length/)).not.toBeInTheDocument();
  });

  it('renders the exclusion footer always', () => {
    render(<CutListTable result={result} onSelectRow={() => {}} onEditItemNumber={() => {}} onExportCsv={() => {}} />);
    expect(screen.getByText(/Excluded from cut list: 2 components/)).toBeInTheDocument();
  });

  it('shows "No panels" placeholder when rows is empty', () => {
    const r: CutListResult = { rows: [], bandTotals: [], excluded: { componentCount: 0, partCount: 0 } };
    render(<CutListTable result={r} onSelectRow={() => {}} onEditItemNumber={() => {}} onExportCsv={() => {}} />);
    expect(screen.getByText('No panels')).toBeInTheDocument();
  });

  it('row click calls onSelectRow with componentPathKeys', () => {
    const onSelectRow = vi.fn();
    render(<CutListTable result={result} onSelectRow={onSelectRow} onEditItemNumber={() => {}} onExportCsv={() => {}} />);
    fireEvent.click(screen.getByText('Birch 18mm'));
    expect(onSelectRow).toHaveBeenCalledWith(['p1', 'p2', 'p3']);
  });

  it('Item# inline edit calls onEditItemNumber on blur', () => {
    const onEditItemNumber = vi.fn();
    render(<CutListTable result={result} onSelectRow={() => {}} onEditItemNumber={onEditItemNumber} onExportCsv={() => {}} />);
    const cell = screen.getByLabelText('Item# 1');
    fireEvent.dblClick(cell);
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.blur(input);
    expect(onEditItemNumber).toHaveBeenCalledWith('k1', 7);
  });

  it('missing-material row carries aria-invalid="true"', () => {
    const r: CutListResult = {
      ...result,
      rows: [{ ...result.rows[0]!, materialName: '(missing material)' }],
    };
    render(<CutListTable result={r} onSelectRow={() => {}} onEditItemNumber={() => {}} onExportCsv={() => {}} />);
    expect(screen.getByText('(missing material)').closest('tr')).toHaveAttribute('aria-invalid', 'true');
  });

  it('Export CSV button is disabled when nothing to export', () => {
    const r: CutListResult = { rows: [], bandTotals: [], excluded: { componentCount: 0, partCount: 0 } };
    render(<CutListTable result={r} onSelectRow={() => {}} onEditItemNumber={() => {}} onExportCsv={() => {}} />);
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
  });

  it('Export CSV button is enabled when rows exist', () => {
    render(<CutListTable result={result} onSelectRow={() => {}} onEditItemNumber={() => {}} onExportCsv={() => {}} />);
    expect(screen.getByRole('button', { name: 'Export CSV' })).not.toBeDisabled();
  });
});
