import { describe, it, expect } from 'vitest';
import { buildNestZipEntries, ExportNestDxfCommand } from '../ExportNestDxfCommand';
import { unzipSync, strFromU8 } from 'fflate';
import type { NestState } from '@zilventor/shared';
import type { MaterialRegistry } from '@zilventor/shared';

const materials: MaterialRegistry = [
  { id: 'mdf18', name: 'White 18', defaultThickness: 18, color: '#fff' } as any,
];

const nest: NestState = {
  params: { kerfMm: 3 },
  generatedAt: 0,
  inputFingerprint: 'fp',
  excluded: [],
  sheets: [
    { materialId: 'mdf18', sheetIndex: 0, sheetLengthMm: 2800, sheetWidthMm: 2070, utilizationPct: 80,
      panels: [{ itemNumber: 1, rowKey: 'a', x: 0, y: 0, length: 600, width: 300, rotated: false }] },
    { materialId: 'mdf18', sheetIndex: 1, sheetLengthMm: 2800, sheetWidthMm: 2070, utilizationPct: 50,
      panels: [
        { itemNumber: 2, rowKey: 'b', x: 0, y: 0, length: 600, width: 300, rotated: false },
        { itemNumber: 3, rowKey: 'c', x: 700, y: 0, length: 300, width: 600, rotated: true },
      ] },
  ],
} as NestState;

describe('buildNestZipEntries', () => {
  it('one entry per sheet, keyed by material + 1-based sheet index, each a 3-layer DXF', () => {
    const entries = buildNestZipEntries(nest, materials);
    expect(Object.keys(entries)).toEqual(['mdf18-sheet-1.dxf', 'mdf18-sheet-2.dxf']);

    for (const dxf of Object.values(entries)) {
      expect(dxf).toContain('AC1015');
      expect(dxf).toContain('SHEET');
      expect(dxf).toContain('OUTLINE');
      expect(dxf).toContain('INFO');
    }
    // sheet-1: 1 SHEET + 1 panel = 2 LWPOLYLINE; sheet-2: 1 SHEET + 2 panels = 3.
    expect((entries['mdf18-sheet-1.dxf']!.match(/LWPOLYLINE/g) ?? []).length).toBe(2);
    expect((entries['mdf18-sheet-2.dxf']!.match(/LWPOLYLINE/g) ?? []).length).toBe(3);
    // per-material sheetCount → "Sheet 1/2" / "Sheet 2/2".
    expect(entries['mdf18-sheet-1.dxf']).toContain('Sheet 1/2 · White 18');
    expect(entries['mdf18-sheet-2.dxf']).toContain('Sheet 2/2 · White 18');
  });
});

describe('ExportNestDxfCommand.apply', () => {
  it('zips every sheet DXF and exposes bytes that unzip to per-sheet 3-layer DXF', async () => {
    const stub = async () => ({
      createWritable: async () => ({ write: async () => {}, close: async () => {} }),
    });
    (globalThis as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = stub;
    try {
      await new ExportNestDxfCommand({ nest, materials, suggestedName: 'demo-nest.zip' }).apply();
    } finally {
      delete (globalThis as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    }

    const bytes = (globalThis as unknown as { __zilventorNestDxfBytes?: Uint8Array }).__zilventorNestDxfBytes;
    expect(bytes).toBeInstanceOf(Uint8Array);

    const back = unzipSync(bytes!);
    expect(Object.keys(back).sort()).toEqual(['mdf18-sheet-1.dxf', 'mdf18-sheet-2.dxf']);
    for (const name of Object.keys(back)) {
      const dxf = strFromU8(back[name]!);
      expect(dxf).toContain('SHEET');
      expect(dxf).toContain('OUTLINE');
      expect(dxf).toContain('INFO');
      expect(dxf).toContain('EOF');
    }
  });
});
