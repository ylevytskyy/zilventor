import { describe, it, expect, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { ExportStatisticsXlsxCommand } from '../ExportStatisticsXlsxCommand';
import type { StatisticsReport } from '../buildStatisticsReport';

function makeReport(): StatisticsReport {
  return {
    sections: [
      {
        category: 'hardware',
        lines: [{ key: 'hardware:h1', label: 'Hinge 110deg', qty: 4, unit: 'ea', unitPrice: 5.5, lineTotal: 22 }],
        subtotal: 22,
      },
      { category: 'connectors', lines: [], subtotal: 0 },
      { category: 'edgeband', lines: [], subtotal: 0 },
      { category: 'linear', lines: [], subtotal: 0 },
      { category: 'panels', lines: [], subtotal: 0 },
    ],
    grandTotal: 22,
    unpricedLineCount: 0,
  };
}

describe('ExportStatisticsXlsxCommand', () => {
  it('writes a valid multi-sheet workbook through showSaveFilePicker when available', async () => {
    const writes: Uint8Array[] = [];
    const mockHandle = {
      createWritable: async () => ({
        write: async (b: Uint8Array) => { writes.push(b); },
        close: async () => {},
      }),
    };
    (globalThis as any).showSaveFilePicker = vi.fn(async (_opts: any) => mockHandle);
    try {
      await new ExportStatisticsXlsxCommand({ report: makeReport(), suggestedName: 'stats.xlsx' }).apply();
      expect(writes).toHaveLength(1);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(writes[0] as unknown as ArrayBuffer);
      expect(wb.worksheets.map((ws) => ws.name)).toContain('Hardware');
      expect(wb.worksheets.map((ws) => ws.name)).toContain('Summary');
    } finally {
      delete (globalThis as any).showSaveFilePicker;
    }
  });

  it('silently no-ops when the user cancels the save dialog', async () => {
    (globalThis as any).showSaveFilePicker = vi.fn(async () => { throw new DOMException('cancelled', 'AbortError'); });
    try {
      await expect(
        new ExportStatisticsXlsxCommand({ report: makeReport(), suggestedName: 'stats.xlsx' }).apply(),
      ).resolves.toBeUndefined();
    } finally {
      delete (globalThis as any).showSaveFilePicker;
    }
  });
});
