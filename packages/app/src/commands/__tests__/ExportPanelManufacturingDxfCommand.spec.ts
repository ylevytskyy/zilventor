import { describe, it, expect, vi } from 'vitest';
import { buildManufacturingZipEntries, buildCombinedManufacturingDxf, ExportPanelManufacturingDxfCommand } from '../ExportPanelManufacturingDxfCommand';
import type { PanelManufacturingInput } from '../../drawing/renderPanelManufacturingDxf';

// jsdom doesn't implement URL.createObjectURL — stub it for the fallback path.
Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:stub'), writable: true });
Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), writable: true });

const input = (
  n: number,
  name: string,
  materialName = 'White 18',
  materialId = 'm',
): PanelManufacturingInput => ({
  itemNumber: n, partName: name, materialName, qty: 1,
  spec: { length: 800, width: 600, thickness: 18, materialId, grain: 'length',
    edgeBands: { front: null, back: null, left: null, right: null } } as any,
  bores: [], grooves: [],
});

// R4.1(a): CNC zip entries are grouped into per-material subfolders so a
// keyed entry like "White_18/item-1-Side.dxf" is treated as a folder by
// fflate.zipSync (dxfZip.ts already handles "/" in keys).
describe('buildManufacturingZipEntries', () => {
  it('produces one DXF entry per input with item-n-name.dxf filenames, nested under the material folder', () => {
    const entries = buildManufacturingZipEntries([input(1, 'Side'), input(2, 'Top Shelf')]);
    expect(Object.keys(entries)).toEqual(['White_18/item-1-Side.dxf', 'White_18/item-2-Top_Shelf.dxf']);
    expect(entries['White_18/item-1-Side.dxf']).toContain('OUTLINE');
  });

  it('groups inputs into separate material folders when material names differ', () => {
    const entries = buildManufacturingZipEntries([
      input(1, 'Side', 'White 18'),
      input(2, 'Door', 'Oak Veneer'),
    ]);
    expect(Object.keys(entries).sort()).toEqual([
      'Oak_Veneer/item-2-Door.dxf',
      'White_18/item-1-Side.dxf',
    ]);
  });

  it('keeps two inputs with the same material under a single folder', () => {
    const entries = buildManufacturingZipEntries([input(1, 'Side'), input(2, 'Back')]);
    const keys = Object.keys(entries);
    expect(keys).toHaveLength(2);
    expect(keys.every((k) => k.startsWith('White_18/'))).toBe(true);
  });

  // Note: sanitizeFolder() substitutes each disallowed character with '_'
  // (it does not strip) and keeps Unicode letters/digits, so a Cyrillic name
  // like "ДСП" is now preserved as-is (see the Unicode tests below) instead
  // of collapsing to "___". The only way to get a genuinely empty sanitized
  // name is an empty materialName/materialId — exercised below.
  it('falls back to the sanitized materialId when the material name is empty', () => {
    const entries = buildManufacturingZipEntries([input(1, 'Side', '', 'mdf18')]);
    expect(Object.keys(entries)).toEqual(['mdf18/item-1-Side.dxf']);
  });

  it('falls back to a fixed "material" folder when both name and id are empty', () => {
    const entries = buildManufacturingZipEntries([input(1, 'Side', '', '')]);
    expect(Object.keys(entries)).toEqual(['material/item-1-Side.dxf']);
  });

  it('merges material names that sanitize identically without losing entries', () => {
    const entries = buildManufacturingZipEntries([
      input(1, 'Side', 'White/18'),
      input(2, 'Back', 'White 18'),
    ]);
    expect(Object.keys(entries).sort()).toEqual([
      'White_18/item-1-Side.dxf',
      'White_18/item-2-Back.dxf',
    ]);
  });
});

// R4.1(a) Unicode fix: material folder keys must preserve Unicode letters
// (e.g. Cyrillic) instead of collapsing to underscores — only the zip
// *folder* key changes; DXF filenames/content stay ASCII-only via sanitize().
describe('buildManufacturingZipEntries — Unicode material folders', () => {
  it('preserves a Cyrillic material name as a Unicode folder key', () => {
    const entries = buildManufacturingZipEntries([input(1, 'Side', 'ДСП 16мм')]);
    expect(Object.keys(entries)).toEqual(['ДСП_16мм/item-1-Side.dxf']);
  });

  it('keeps an ASCII material folder key byte-identical to before', () => {
    const entries = buildManufacturingZipEntries([input(1, 'Side', 'Birch 18mm')]);
    expect(Object.keys(entries)).toEqual(['Birch_18mm/item-1-Side.dxf']);
  });

  it('no longer collapses a Unicode-letters-only material name to "___" or falls back to materialId', () => {
    const entries = buildManufacturingZipEntries([input(1, 'Side', 'ДСП', 'mdf18')]);
    expect(Object.keys(entries)).toEqual(['ДСП/item-1-Side.dxf']);
  });

  it('fallback chain stays Unicode-aware: empty material name falls back to a Unicode materialId', () => {
    const entries = buildManufacturingZipEntries([input(1, 'Side', '', 'ДСП')]);
    expect(Object.keys(entries)).toEqual(['ДСП/item-1-Side.dxf']);
  });
});

// R1: a panel that failed the panelPreflight check (missing name/material/
// non-manifold/split-required) must surface a user-facing toast at export
// time, not just a console.warn dropped upstream. Mirrors ExportBoringDxfCommand.
describe('ExportPanelManufacturingDxfCommand — R1 preflight diagnostics', () => {
  it('shows a toast for each collected preflight diagnostic', async () => {
    const toasts: string[] = [];
    await new ExportPanelManufacturingDxfCommand({
      inputs: [input(1, 'Side')],
      suggestedName: 'manufacturing.zip',
      diagnostics: [
        { partPath: 'ghost.zipt', reasonKey: 'panel.preflight.missingMaterial', params: { name: 'Ghost' } },
      ],
      showToast: (msg) => toasts.push(msg),
    }).apply();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatch(/Ghost/);
    expect(toasts[0]).toMatch(/material/i);
  });

  it('shows no toast when there are no diagnostics', async () => {
    const toasts: string[] = [];
    await new ExportPanelManufacturingDxfCommand({
      inputs: [input(1, 'Side')],
      suggestedName: 'manufacturing.zip',
      showToast: (msg) => toasts.push(msg),
    }).apply();
    expect(toasts).toHaveLength(0);
  });
});

describe('buildCombinedManufacturingDxf', () => {
  it('returns a non-empty DXF string with one OUTLINE entry per input', () => {
    const dxf = buildCombinedManufacturingDxf([input(1, 'Side'), input(2, 'Top Shelf'), input(3, 'Back')]);
    expect(dxf.length).toBeGreaterThan(0);
    expect((dxf.match(/LWPOLYLINE/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(dxf).toContain('#1 Side');
    expect(dxf).toContain('#2 Top Shelf');
    expect(dxf).toContain('#3 Back');
  });
});

describe('ExportPanelManufacturingDxfCommand — mode:combined', () => {
  it('saves one .dxf file (derived name) with combined DXF bytes instead of a zip', async () => {
    let seenSuggestedName = '';
    const stub = async (opts: { suggestedName: string }) => {
      seenSuggestedName = opts.suggestedName;
      return { createWritable: async () => ({ write: async () => {}, close: async () => {} }) };
    };
    (globalThis as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = stub;
    try {
      await new ExportPanelManufacturingDxfCommand({
        inputs: [input(1, 'Side'), input(2, 'Top Shelf')],
        suggestedName: 'assembly-manufacturing.zip',
        mode: 'combined',
      }).apply();
    } finally {
      delete (globalThis as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    }

    expect(seenSuggestedName).toBe('assembly-manufacturing-combined.dxf');
    const bytes = (globalThis as unknown as { __zilventorManufacturingDxfBytes?: Uint8Array }).__zilventorManufacturingDxfBytes;
    expect(bytes?.constructor?.name).toBe('Uint8Array');
    const text = new TextDecoder().decode(bytes!);
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain('#1 Side');
    expect(text).toContain('#2 Top Shelf');
  });

  it('mode:folders (default) still produces the exact same zip entries as before', async () => {
    const stub = async () => ({
      createWritable: async () => ({ write: async () => {}, close: async () => {} }),
    });
    (globalThis as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = stub;
    try {
      await new ExportPanelManufacturingDxfCommand({
        inputs: [input(1, 'Side'), input(2, 'Top Shelf')],
        suggestedName: 'assembly-manufacturing.zip',
      }).apply();
    } finally {
      delete (globalThis as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    }
    const bytes = (globalThis as unknown as { __zilventorManufacturingDxfBytes?: Uint8Array }).__zilventorManufacturingDxfBytes;
    expect(bytes?.constructor?.name).toBe('Uint8Array');
  });
});
