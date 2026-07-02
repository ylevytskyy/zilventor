import { describe, it, expect, vi } from 'vitest';
import { buildManufacturingZipEntries, ExportPanelManufacturingDxfCommand } from '../ExportPanelManufacturingDxfCommand';
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

  // Note: sanitize() substitutes each disallowed character with '_' (it does
  // not strip), so a non-empty non-ASCII name like Cyrillic "ДСП" sanitizes
  // to "___", not "". The only way to get a genuinely empty sanitized name
  // is an empty materialName/materialId — exercised below.
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
