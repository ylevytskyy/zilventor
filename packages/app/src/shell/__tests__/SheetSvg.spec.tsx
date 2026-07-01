import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SheetSvg } from '../SheetSvg';
import type { NestSheet } from '@zilventor/shared';
import type { MaterialEntry } from '@zilventor/shared/src/material';

const baseSheet: NestSheet = {
  materialId: 'm1',
  sheetIndex: 1,
  sheetLengthMm: 2440,
  sheetWidthMm: 1220,
  utilizationPct: 50.0,
  panels: [
    { itemNumber: 1, rowKey: 'r1', x: 0, y: 0, length: 600, width: 400, rotated: false, grain: 'none' },
  ],
};

const material: MaterialEntry = {
  id: 'm1', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896',
};

describe('SheetSvg', () => {
  it('renders sheet header with index and utilisation', () => {
    render(<SheetSvg sheet={baseSheet} material={material} grainByRowKey={new Map()} onExportPng={() => {}} />);
    expect(screen.getByText(/Sheet 1/)).toBeInTheDocument();
    expect(screen.getByText(/50/)).toBeInTheDocument();
  });

  it('renders one rect per placed panel and #itemNumber label', () => {
    const sheet: NestSheet = {
      ...baseSheet,
      panels: [
        { itemNumber: 3, rowKey: 'r3', x: 10, y: 20, length: 600, width: 400, rotated: false, grain: 'none' },
        { itemNumber: 7, rowKey: 'r7', x: 620, y: 20, length: 300, width: 200, rotated: false, grain: 'none' },
      ],
    };
    render(<SheetSvg sheet={sheet} material={material} grainByRowKey={new Map()} onExportPng={() => {}} />);
    expect(screen.getByText(/#3/)).toBeInTheDocument();
    expect(screen.getByText(/#7/)).toBeInTheDocument();
    const svg = document.querySelector('svg');
    // two panel rects + one sheet outline rect = 3 rects
    expect(svg?.querySelectorAll('rect').length).toBe(3);
  });

  it('omits the LxW label when length <= 200mm', () => {
    const smallSheet: NestSheet = {
      ...baseSheet,
      panels: [
        { itemNumber: 1, rowKey: 'r1', x: 0, y: 0, length: 150, width: 100, rotated: false, grain: 'none' },
      ],
    };
    render(<SheetSvg sheet={smallSheet} material={material} grainByRowKey={new Map()} onExportPng={() => {}} />);
    expect(screen.queryByText(/150×100/)).not.toBeInTheDocument();
  });

  it('renders grain arrow path when grain is not none', () => {
    const grainByRowKey = new Map([['r1', 'length' as const]]);
    render(<SheetSvg sheet={baseSheet} material={material} grainByRowKey={grainByRowKey} onExportPng={() => {}} />);
    const svg = document.querySelector('svg');
    const paths = svg?.querySelectorAll('path');
    expect(paths?.length).toBeGreaterThan(0);
  });

  it('clicking Export PNG calls onExportPng with the sheet', () => {
    const onExportPng = vi.fn();
    render(<SheetSvg sheet={baseSheet} material={material} grainByRowKey={new Map()} onExportPng={onExportPng} />);
    fireEvent.click(screen.getByRole('button', { name: /Export PNG sheet 1/i }));
    expect(onExportPng).toHaveBeenCalledTimes(1);
    expect(onExportPng).toHaveBeenCalledWith(baseSheet);
  });
});
