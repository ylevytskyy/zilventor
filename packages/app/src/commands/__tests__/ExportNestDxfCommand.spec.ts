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
    { materialId: 'mdf18', sheetIndex: 1, sheetLengthMm: 2800, sheetWidthMm: 2070, utilizationPct: 80,
      panels: [{ itemNumber: 1, rowKey: 'a', x: 0, y: 0, length: 600, width: 300, rotated: false, grain: 'none' }] },
    { materialId: 'mdf18', sheetIndex: 2, sheetLengthMm: 2800, sheetWidthMm: 2070, utilizationPct: 50,
      panels: [
        { itemNumber: 2, rowKey: 'b', x: 0, y: 0, length: 600, width: 300, rotated: false, grain: 'none' },
        { itemNumber: 3, rowKey: 'c', x: 700, y: 0, length: 300, width: 600, rotated: true, grain: 'none' },
      ] },
  ],
} as NestState;

// R4.1(a): CNC zip entries are grouped into per-material subfolders so a
// keyed entry like "White_18/mdf18-sheet-1.dxf" is treated as a folder by
// fflate.zipSync (dxfZip.ts already handles "/" in keys). The inner filename
// is unchanged from the flat layout.
describe('buildNestZipEntries', () => {
  it('one entry per sheet, keyed by material + 1-based sheet index, nested under the material folder', () => {
    const entries = buildNestZipEntries(nest, materials);
    expect(Object.keys(entries)).toEqual(['White_18/mdf18-sheet-1.dxf', 'White_18/mdf18-sheet-2.dxf']);

    for (const dxf of Object.values(entries)) {
      expect(dxf).toContain('AC1015');
      expect(dxf).toContain('SHEET');
      expect(dxf).toContain('OUTLINE');
      expect(dxf).toContain('INFO');
    }
    // sheet-1: 1 SHEET + 1 panel = 2 LWPOLYLINE; sheet-2: 1 SHEET + 2 panels = 3.
    expect((entries['White_18/mdf18-sheet-1.dxf']!.match(/LWPOLYLINE/g) ?? []).length).toBe(2);
    expect((entries['White_18/mdf18-sheet-2.dxf']!.match(/LWPOLYLINE/g) ?? []).length).toBe(3);
    // per-material sheetCount → "Sheet 1/2" / "Sheet 2/2".
    expect(entries['White_18/mdf18-sheet-1.dxf']).toContain('Sheet 1/2 - White 18');
    expect(entries['White_18/mdf18-sheet-2.dxf']).toContain('Sheet 2/2 - White 18');
  });

  it('groups sheets into separate material folders when materials differ', () => {
    const twoMaterialNest: NestState = {
      ...nest,
      sheets: [
        nest.sheets[0]!,
        { ...nest.sheets[1]!, materialId: 'oak', sheetIndex: 1 },
      ],
    } as NestState;
    const twoMaterials: MaterialRegistry = [
      ...materials,
      { id: 'oak', name: 'Oak Veneer', defaultThickness: 18, color: '#eee' } as any,
    ];
    const entries = buildNestZipEntries(twoMaterialNest, twoMaterials);
    expect(Object.keys(entries).sort()).toEqual([
      'Oak_Veneer/oak-sheet-1.dxf',
      'White_18/mdf18-sheet-1.dxf',
    ]);
  });

  // Note: sanitize() substitutes each disallowed character with '_' (it does
  // not strip), so a non-empty non-ASCII name sanitizes to "___", not "".
  // The only way to get a genuinely empty sanitized name is an empty
  // resolved materialName/materialId — exercised below.
  it('falls back to the sanitized materialId when the resolved material name is empty', () => {
    const oneSheetNest: NestState = { ...nest, sheets: [nest.sheets[0]!] } as NestState;
    const emptyNameMaterials: MaterialRegistry = [
      { id: 'mdf18', name: '', defaultThickness: 18, color: '#fff' } as any,
    ];
    const entries = buildNestZipEntries(oneSheetNest, emptyNameMaterials);
    expect(Object.keys(entries)).toEqual(['mdf18/mdf18-sheet-1.dxf']);
  });

  it('falls back to a fixed "material" folder when both the resolved name and id are empty', () => {
    const oneSheetNest: NestState = {
      ...nest,
      sheets: [{ ...nest.sheets[0]!, materialId: '' }],
    } as NestState;
    // materialId '' has no registry entry, so buildNestZipEntries falls back
    // to the (also empty) materialId itself as the display name.
    const entries = buildNestZipEntries(oneSheetNest, materials);
    expect(Object.keys(entries)).toEqual(['material/-sheet-1.dxf']);
  });

  it('merges material names that sanitize identically without losing entries', () => {
    const twoMaterialNest: NestState = {
      ...nest,
      sheets: [
        { ...nest.sheets[0]!, materialId: 'a' },
        { ...nest.sheets[1]!, materialId: 'b', sheetIndex: 1 },
      ],
    } as NestState;
    const collidingMaterials: MaterialRegistry = [
      { id: 'a', name: 'White/18', defaultThickness: 18, color: '#fff' } as any,
      { id: 'b', name: 'White 18', defaultThickness: 18, color: '#fff' } as any,
    ];
    const entries = buildNestZipEntries(twoMaterialNest, collidingMaterials);
    expect(Object.keys(entries).sort()).toEqual([
      'White_18/a-sheet-1.dxf',
      'White_18/b-sheet-1.dxf',
    ]);
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
    expect(Object.keys(back).sort()).toEqual(['White_18/mdf18-sheet-1.dxf', 'White_18/mdf18-sheet-2.dxf']);
    for (const name of Object.keys(back)) {
      const dxf = strFromU8(back[name]!);
      expect(dxf).toContain('SHEET');
      expect(dxf).toContain('OUTLINE');
      expect(dxf).toContain('INFO');
      expect(dxf).toContain('EOF');
    }
  });
});
