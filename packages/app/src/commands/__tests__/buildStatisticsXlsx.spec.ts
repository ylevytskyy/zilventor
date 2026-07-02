// @vitest-environment node
/**
 * buildStatisticsXlsxBuffer — TDD spec (P4 W4, true multi-sheet .xlsx export
 * of StatisticsReport, decision D3). Round-trips the produced buffer back
 * through exceljs to assert sheet names + key cell values.
 */
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildStatisticsXlsxBuffer } from '../buildStatisticsXlsx';
import type { StatisticsReport } from '../buildStatisticsReport';

function makeReport(): StatisticsReport {
  return {
    sections: [
      {
        category: 'hardware',
        lines: [{ key: 'hardware:h1', label: 'Hinge 110deg', qty: 4, unit: 'ea', unitPrice: 5.5, lineTotal: 22 }],
        subtotal: 22,
      },
      {
        category: 'connectors',
        lines: [{ key: 'connector:confirmat', label: 'Confirmat 7x50', qty: 10, unit: 'ea', unitPrice: 0.8, lineTotal: 8 }],
        subtotal: 8,
      },
      {
        category: 'edgeband',
        lines: [{ key: 'edgeband:eb1', label: 'PVC White', qty: 1200, unit: 'mm', unitPrice: 0.02, lineTotal: 24 }],
        subtotal: 24,
      },
      {
        category: 'linear',
        lines: [
          {
            key: 'linear:lm1',
            label: 'Aluminium rod',
            qty: 1890,
            unit: 'mm',
            unitPrice: 0.01,
            lineTotal: 18.9,
            pieces: [{ lengthMm: 958, qty: 1 }, { lengthMm: 466, qty: 2 }],
          },
        ],
        subtotal: 18.9,
      },
      {
        category: 'panels',
        lines: [{ key: 'material:m1', label: 'Birch', qty: 0.54, unit: 'm2', unitPrice: 50, lineTotal: 27 }],
        subtotal: 27,
      },
    ],
    grandTotal: 22 + 8 + 24 + 18.9 + 27,
    unpricedLineCount: 2,
  };
}

describe('buildStatisticsXlsxBuffer', () => {
  it('produces a workbook with 6 sheets: 5 categories + Summary', async () => {
    const buffer = await buildStatisticsXlsxBuffer(makeReport());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const names = wb.worksheets.map((ws) => ws.name);
    expect(names).toEqual(['Hardware', 'Connectors', 'Edge Band', 'Linear Material', 'Panels', 'Summary']);
  });

  it('writes header + data row on the Hardware sheet', async () => {
    const buffer = await buildStatisticsXlsxBuffer(makeReport());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Hardware')!;
    const header = ws.getRow(1).values as unknown[];
    expect(header).toContain('Label');
    expect(header).toContain('Qty');
    const dataRow = ws.getRow(2).values as unknown[];
    expect(dataRow).toContain('Hinge 110deg');
    expect(dataRow).toContain(4);
    expect(dataRow).toContain(22);
  });

  it('emits linear-material piece breakdown as sub-rows on the Linear Material sheet', async () => {
    const buffer = await buildStatisticsXlsxBuffer(makeReport());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Linear Material')!;
    const values: string[] = [];
    ws.eachRow((row) => {
      values.push(String(row.getCell(1).value ?? ''));
    });
    expect(values.some((v) => v.includes('958'))).toBe(true);
    expect(values.some((v) => v.includes('466'))).toBe(true);
  });

  it('Summary sheet lists per-section subtotals, grand total, and unpriced count', async () => {
    const report = makeReport();
    const buffer = await buildStatisticsXlsxBuffer(report);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Summary')!;
    const allText: string[] = [];
    ws.eachRow((row) => {
      row.eachCell({ includeEmpty: false }, (cell) => allText.push(String(cell.value)));
    });
    expect(allText).toContain('Hardware');
    expect(allText.some((v) => v === '22')).toBe(true);
    expect(allText).toContain('Grand Total');
    expect(allText.some((v) => Number(v) === report.grandTotal)).toBe(true);
    expect(allText.some((v) => v.includes('2'))).toBe(true); // unpricedLineCount
  });
});
