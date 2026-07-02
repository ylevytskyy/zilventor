import { describe, it, expect, vi } from 'vitest';
import { ExportStatisticsCsvCommand } from '../ExportStatisticsCsvCommand';
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

describe('ExportStatisticsCsvCommand', () => {
  it('writes the CSV through showSaveFilePicker when available', async () => {
    const writes: Uint8Array[] = [];
    const mockHandle = {
      createWritable: async () => ({
        write: async (b: Uint8Array) => { writes.push(b); },
        close: async () => {},
      }),
    };
    (globalThis as any).showSaveFilePicker = vi.fn(async (_opts: any) => mockHandle);
    try {
      await new ExportStatisticsCsvCommand({ report: makeReport(), suggestedName: 'stats.csv' }).apply();
      expect(writes).toHaveLength(1);
      const csv = new TextDecoder().decode(writes[0]!);
      expect(csv).toContain('Hinge 110deg,4,ea,5.5,22');
      expect(csv).toContain('Grand Total,,,,22');
    } finally {
      delete (globalThis as any).showSaveFilePicker;
    }
  });

  it('silently no-ops when the user cancels the save dialog', async () => {
    (globalThis as any).showSaveFilePicker = vi.fn(async () => { throw new DOMException('cancelled', 'AbortError'); });
    try {
      await expect(
        new ExportStatisticsCsvCommand({ report: makeReport(), suggestedName: 'stats.csv' }).apply(),
      ).resolves.toBeUndefined();
    } finally {
      delete (globalThis as any).showSaveFilePicker;
    }
  });
});
