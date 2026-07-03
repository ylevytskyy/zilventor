// packages/shared/src/nesting/__tests__/packAllMaterials.spec.ts
import { describe, it, expect } from 'vitest';
import { packAllMaterials } from '../packAllMaterials';
import type { NestInputRow } from '../types';
import type { MaterialEntry } from '../../material';

const r = (o: Partial<NestInputRow>): NestInputRow => ({
  itemNumber: 1, rowKey: 'r1', qty: 1, length: 600, width: 400,
  materialId: 'm1', grain: 'length', ...o,
});

const mat = (o: Partial<MaterialEntry> & { id: string }): MaterialEntry => ({
  id: o.id, name: o.name ?? o.id, defaultThickness: 18, color: '#aabbcc',
  ...(o.sheetLengthMm !== undefined ? { sheetLengthMm: o.sheetLengthMm } : {}),
  ...(o.sheetWidthMm !== undefined ? { sheetWidthMm: o.sheetWidthMm } : {}),
});

describe('packAllMaterials', () => {
  it('groups rows by materialId; ordering by (materialId.localeCompare, sheetIndex)', () => {
    const rows = [
      r({ rowKey: 'b1', itemNumber: 1, materialId: 'b' }),
      r({ rowKey: 'a1', itemNumber: 2, materialId: 'a' }),
    ];
    const materials: MaterialEntry[] = [
      mat({ id: 'a', sheetLengthMm: 2440, sheetWidthMm: 1220 }),
      mat({ id: 'b', sheetLengthMm: 2440, sheetWidthMm: 1220 }),
    ];
    const out = packAllMaterials(rows, materials, 3);
    expect(out.sheets.map((s) => s.materialId)).toEqual(['a', 'b']);
  });

  it("material missing sheet stock → exclusion 'no-sheet-stock' with empty itemNumbers", () => {
    const rows = [r({ materialId: 'm1' })];
    const materials = [mat({ id: 'm1' })]; // no sheet dims
    const out = packAllMaterials(rows, materials, 3);
    expect(out.sheets).toHaveLength(0);
    expect(out.excluded).toEqual([{ materialId: 'm1', reason: 'no-sheet-stock', itemNumbers: [] }]);
  });

  it("material with oversized panel → exclusion 'panel-exceeds-sheet' listing itemNumber", () => {
    const rows = [r({ length: 3000, materialId: 'm1', itemNumber: 7 })];
    const materials = [mat({ id: 'm1', sheetLengthMm: 2440, sheetWidthMm: 1220 })];
    const out = packAllMaterials(rows, materials, 3);
    expect(out.sheets).toHaveLength(0);
    expect(out.excluded).toEqual([{ materialId: 'm1', reason: 'panel-exceeds-sheet', itemNumbers: [7] }]);
  });

  it('snapshots sheetLengthMm/sheetWidthMm into each NestSheet', () => {
    const rows = [r({ materialId: 'm1' })];
    const materials = [mat({ id: 'm1', sheetLengthMm: 2440, sheetWidthMm: 1220 })];
    const out = packAllMaterials(rows, materials, 3);
    expect(out.sheets[0]!.sheetLengthMm).toBe(2440);
    expect(out.sheets[0]!.sheetWidthMm).toBe(1220);
    expect(out.sheets[0]!.materialId).toBe('m1');
  });

  it('rows referencing a materialId not in the registry → silently dropped (no exclusion, no crash)', () => {
    const rows = [r({ materialId: 'ghost' })];
    const materials = [mat({ id: 'm1', sheetLengthMm: 2440, sheetWidthMm: 1220 })];
    const out = packAllMaterials(rows, materials, 3);
    expect(out.sheets).toHaveLength(0);
    expect(out.excluded).toHaveLength(0);
  });

  it("material with both a genuinely-oversized row and a grain-locked-would-fit-rotated row → two separate exclusions", () => {
    const rows = [
      r({ rowKey: 'huge', itemNumber: 1, length: 5000, width: 5000, materialId: 'm1' }),
      r({ rowKey: 'grainlocked', itemNumber: 2, length: 800, width: 400, grain: 'length', materialId: 'm1' }),
    ];
    const materials = [mat({ id: 'm1', sheetLengthMm: 700, sheetWidthMm: 1220 })];
    const out = packAllMaterials(rows, materials, 3);
    expect(out.sheets).toHaveLength(0);
    expect(out.excluded).toEqual([
      { materialId: 'm1', reason: 'panel-exceeds-sheet', itemNumbers: [1] },
      { materialId: 'm1', reason: 'grain-locked-exceeds-sheet', itemNumbers: [2] },
    ]);
  });

  it('passes instanceIndex and remnant through from packGuillotine unchanged', () => {
    // 500x500 panel on a 1000x1000 sheet leaves a >=100x100 leftover; qty=2 → instanceIndex 1,2.
    const rows = [r({ materialId: 'm1', length: 500, width: 500, qty: 2 })];
    const materials = [mat({ id: 'm1', sheetLengthMm: 1000, sheetWidthMm: 1000 })];
    const out = packAllMaterials(rows, materials, 0);
    expect(out.sheets[0]!.panels.map((p) => p.instanceIndex).sort()).toEqual([1, 2]);
    expect(out.sheets[0]!.remnant).toBeDefined();
  });
});
