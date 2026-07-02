import { describe, it, expect } from 'vitest';
import { buildNestZipEntries, buildCombinedNestDxf, ExportNestDxfCommand } from '../ExportNestDxfCommand';
import { buildDxfZip } from '../../drawing/dxfZip';
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
      panels: [{ itemNumber: 1, rowKey: 'a', instanceIndex: 1, x: 0, y: 0, length: 600, width: 300, rotated: false, grain: 'none' }] },
    { materialId: 'mdf18', sheetIndex: 2, sheetLengthMm: 2800, sheetWidthMm: 2070, utilizationPct: 50,
      panels: [
        { itemNumber: 2, rowKey: 'b', instanceIndex: 1, x: 0, y: 0, length: 600, width: 300, rotated: false, grain: 'none' },
        { itemNumber: 3, rowKey: 'c', instanceIndex: 1, x: 700, y: 0, length: 300, width: 600, rotated: true, grain: 'none' },
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

  // Note: sanitizeFolder() substitutes each disallowed character with '_'
  // (it does not strip) and keeps Unicode letters/digits, so a non-empty
  // Cyrillic name is now preserved as-is (see the Unicode tests below)
  // instead of collapsing to "___". The only way to get a genuinely empty
  // sanitized name is an empty resolved materialName/materialId — exercised
  // below.
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

// R4.1(a) Unicode fix: material folder keys must preserve Unicode letters
// (e.g. Cyrillic) instead of collapsing to underscores — only the zip
// *folder* key changes; DXF filenames/content stay ASCII-only via sanitize().
describe('buildNestZipEntries — Unicode material folders', () => {
  it('preserves a Cyrillic material name as a Unicode folder key', () => {
    const cyrillicMaterials: MaterialRegistry = [
      { id: 'mdf18', name: 'ДСП 16мм', defaultThickness: 18, color: '#fff' } as any,
    ];
    const oneSheetNest: NestState = { ...nest, sheets: [nest.sheets[0]!] } as NestState;
    const entries = buildNestZipEntries(oneSheetNest, cyrillicMaterials);
    expect(Object.keys(entries)).toEqual(['ДСП_16мм/mdf18-sheet-1.dxf']);
  });

  it('keeps an ASCII material folder key byte-identical to before', () => {
    const oneSheetNest: NestState = { ...nest, sheets: [nest.sheets[0]!] } as NestState;
    const entries = buildNestZipEntries(oneSheetNest, materials);
    expect(Object.keys(entries)).toEqual(['White_18/mdf18-sheet-1.dxf']);
  });

  it('no longer collapses a Unicode-letters-only material name to "___" or falls back to materialId', () => {
    const cyrillicOnlyMaterials: MaterialRegistry = [
      { id: 'mdf18', name: 'ДСП', defaultThickness: 18, color: '#fff' } as any,
    ];
    const oneSheetNest: NestState = { ...nest, sheets: [nest.sheets[0]!] } as NestState;
    const entries = buildNestZipEntries(oneSheetNest, cyrillicOnlyMaterials);
    expect(Object.keys(entries)).toEqual(['ДСП/mdf18-sheet-1.dxf']);
  });

  it('fallback chain stays Unicode-aware: empty resolved material name falls back to a Unicode materialId', () => {
    const oneSheetNest: NestState = {
      ...nest,
      sheets: [{ ...nest.sheets[0]!, materialId: 'ДСП' }],
    } as NestState;
    const unicodeIdMaterials: MaterialRegistry = [
      { id: 'ДСП', name: '', defaultThickness: 18, color: '#fff' } as any,
    ];
    const entries = buildNestZipEntries(oneSheetNest, unicodeIdMaterials);
    // folder falls back to sanitizeFolder(materialId) = 'ДСП' (Unicode
    // preserved); the DXF filename itself still uses the ASCII-only
    // sanitize(), so the file part collapses to underscores as before.
    expect(Object.keys(entries)).toEqual(['ДСП/___-sheet-1.dxf']);
  });
});

// R4.1(a) round-trip proof: fflate's zipSync/unzipSync auto-detect
// non-ASCII entry names (byte-length vs char-length mismatch) and set/read
// the UTF-8 language-encoding flag automatically — no explicit option needed.
describe('buildDxfZip — Unicode folder round-trip', () => {
  it('round-trips a Cyrillic material folder key byte-exact through zipSync/unzipSync', () => {
    const cyrillicMaterials: MaterialRegistry = [
      { id: 'mdf18', name: 'ДСП 16мм', defaultThickness: 18, color: '#fff' } as any,
    ];
    const oneSheetNest: NestState = { ...nest, sheets: [nest.sheets[0]!] } as NestState;
    const entries = buildNestZipEntries(oneSheetNest, cyrillicMaterials);
    const key = 'ДСП_16мм/mdf18-sheet-1.dxf';
    expect(entries[key]).toBeDefined();

    const bytes = buildDxfZip(entries);
    const unzipped = unzipSync(bytes);
    expect(Object.keys(unzipped)).toContain(key);
    expect(strFromU8(unzipped[key]!)).toBe(entries[key]);
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

describe('buildCombinedNestDxf', () => {
  it('returns a non-empty DXF string with one SHEET outline per nest sheet', () => {
    const dxf = buildCombinedNestDxf(nest, materials);
    expect(dxf.length).toBeGreaterThan(0);
    expect((dxf.match(/\nSHEET\n/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(dxf).toContain('White 18');
  });
});

describe('ExportNestDxfCommand — mode:combined', () => {
  it('saves one .dxf file (derived name) with combined DXF bytes instead of a zip', async () => {
    let seenSuggestedName = '';
    const stub = async (opts: { suggestedName: string }) => {
      seenSuggestedName = opts.suggestedName;
      return { createWritable: async () => ({ write: async () => {}, close: async () => {} }) };
    };
    (globalThis as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = stub;
    try {
      await new ExportNestDxfCommand({ nest, materials, suggestedName: 'demo-nest.zip', mode: 'combined' }).apply();
    } finally {
      delete (globalThis as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    }

    expect(seenSuggestedName).toBe('demo-nest-combined.dxf');
    const bytes = (globalThis as unknown as { __zilventorNestDxfBytes?: Uint8Array }).__zilventorNestDxfBytes;
    expect(bytes?.constructor?.name).toBe('Uint8Array');
    const text = new TextDecoder().decode(bytes!);
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain('White 18');
  });

  it('mode:folders (default) still produces the exact same zip entries as before', async () => {
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
    const back = unzipSync(bytes!);
    expect(Object.keys(back).sort()).toEqual(['White_18/mdf18-sheet-1.dxf', 'White_18/mdf18-sheet-2.dxf']);
  });
});
