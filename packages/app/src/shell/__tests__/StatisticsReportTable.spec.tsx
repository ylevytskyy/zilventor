import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { AssemblyDocument } from '@zilventor/shared';
import { useAppStore } from '../../store/useAppStore';
import { StatisticsReportTable } from '../StatisticsReportTable';
import type { StatisticsReport } from '../../commands/buildStatisticsReport';
import { SetUnitPriceCommand } from '../../commands/SetUnitPriceCommand';

function makeAsm(overrides: Partial<AssemblyDocument> = {}): AssemblyDocument {
  return {
    id: 'A', name: 'demo', units: 'mm', parameters: {}, properties: {},
    components: [], constraints: [], groundedComponentPaths: [], colors: {},
    bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [], hardware: [],
    ...overrides,
  };
}

const report: StatisticsReport = {
  sections: [
    { category: 'hardware', lines: [
      { key: 'hardware:hinge-35mm-cup-full', label: 'Blum 35mm cup hinge', qty: 4, unit: 'ea', unitPrice: 1.5, lineTotal: 6 },
    ], subtotal: 6 },
    { category: 'connectors', lines: [
      { key: 'connector:confirmat', label: 'Confirmat', qty: 8, unit: 'ea' },
    ], subtotal: 0 },
    { category: 'edgeband', lines: [
      { key: 'edgeband:m-pvc', label: 'PVC 1mm white', qty: 3600, unit: 'mm' },
    ], subtotal: 0 },
    { category: 'linear', lines: [
      { key: 'linear:m-rod', label: 'Oak trim rod', qty: 1890, unit: 'mm', pieces: [{ lengthMm: 958, qty: 1 }, { lengthMm: 466, qty: 2 }] },
    ], subtotal: 0 },
    { category: 'panels', lines: [
      { key: 'material:m-birch', label: 'Birch 18mm', qty: 0.72, unit: 'm2' },
    ], subtotal: 0 },
  ],
  grandTotal: 6,
  unpricedLineCount: 4,
};

describe('StatisticsReportTable', () => {
  beforeEach(() => {
    const asm = makeAsm();
    useAppStore.setState({
      activeDocument: { kind: 'assembly', document: asm },
      activeAssembly: asm,
      defaultPriceBook: {},
    });
  });

  it('renders all five category section headers', () => {
    render(<StatisticsReportTable report={report} suggestedName="demo-statistics" />);
    expect(screen.getByText('Hardware')).toBeInTheDocument();
    expect(screen.getByText('Connectors')).toBeInTheDocument();
    expect(screen.getByText('Edge Band')).toBeInTheDocument();
    expect(screen.getByText('Linear Material')).toBeInTheDocument();
    expect(screen.getByText('Panels')).toBeInTheDocument();
  });

  it('renders line label, qty, unit and the pieces breakdown for linear lines', () => {
    render(<StatisticsReportTable report={report} suggestedName="demo-statistics" />);
    expect(screen.getByText('Oak trim rod')).toBeInTheDocument();
    expect(screen.getByText(/1×958mm, 2×466mm/)).toBeInTheDocument();
  });

  it('shows subtotal and grand total, rounded to 2 decimals', () => {
    render(<StatisticsReportTable report={report} suggestedName="demo-statistics" />);
    expect(screen.getByText(/Grand Total: 6/)).toBeInTheDocument();
  });

  it('shows the unpriced-line-count badge', () => {
    render(<StatisticsReportTable report={report} suggestedName="demo-statistics" />);
    expect(screen.getByText('4 unpriced line(s)')).toBeInTheDocument();
  });

  it('editing a unit-price input commits SetUnitPriceCommand into activeAssembly.unitPrices', () => {
    render(<StatisticsReportTable report={report} suggestedName="demo-statistics" />);
    const input = screen.getByLabelText('unit-price-connector:confirmat') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '0.08' } });
    fireEvent.blur(input);
    expect(useAppStore.getState().activeAssembly!.unitPrices).toEqual({ 'connector:confirmat': 0.08 });
  });

  it('editing a unit-price input dispatches SetUnitPriceCommand via bus.execute() (undoable)', () => {
    render(<StatisticsReportTable report={report} suggestedName="demo-statistics" />);
    const input = screen.getByLabelText('unit-price-connector:confirmat') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '0.08' } });
    const bus = useAppStore.getState().bus;
    const executeSpy = vi.spyOn(bus, 'execute');
    fireEvent.blur(input);
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(executeSpy.mock.calls[0]![0]).toBeInstanceOf(SetUnitPriceCommand);
    executeSpy.mockRestore();
  });

  it('checking "save as default" also writes the app-global defaultPriceBook', () => {
    render(<StatisticsReportTable report={report} suggestedName="demo-statistics" />);
    const checkbox = screen.getByLabelText('set-default-connector:confirmat') as HTMLInputElement;
    fireEvent.click(checkbox);
    const input = screen.getByLabelText('unit-price-connector:confirmat') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '0.1' } });
    fireEvent.blur(input);
    expect(useAppStore.getState().defaultPriceBook).toEqual({ 'connector:confirmat': 0.1 });
  });
});
