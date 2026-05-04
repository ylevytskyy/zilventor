import type { MaterialRegistry } from '../material';
import type { NestInputRow } from './types';
import type { NestSheet, NestExclusion } from './nestState';
import { packGuillotine } from './packGuillotine';

export interface PackAllResult {
  sheets: NestSheet[];
  excluded: NestExclusion[];
}

export function packAllMaterials(
  inputRows: readonly NestInputRow[],
  materials: MaterialRegistry,
  kerfMm: number,
): PackAllResult {
  const byMaterial = new Map<string, NestInputRow[]>();
  for (const row of inputRows) {
    let bucket = byMaterial.get(row.materialId);
    if (!bucket) { bucket = []; byMaterial.set(row.materialId, bucket); }
    bucket.push(row);
  }

  const sheets: NestSheet[] = [];
  const excluded: NestExclusion[] = [];
  const materialIdsSorted = Array.from(byMaterial.keys()).sort((a, b) => a.localeCompare(b));

  for (const materialId of materialIdsSorted) {
    const mat = materials.find((m) => m.id === materialId);
    if (!mat) continue; // row referencing unknown material — silently dropped
    if (mat.sheetLengthMm === undefined || mat.sheetWidthMm === undefined) {
      excluded.push({ materialId, reason: 'no-sheet-stock', itemNumbers: [] });
      continue;
    }
    const rows = byMaterial.get(materialId)!;
    const result = packGuillotine(rows, mat.sheetLengthMm, mat.sheetWidthMm, kerfMm);
    for (const sheet of result.sheets) {
      sheets.push({ ...sheet, materialId });
    }
    if (result.oversized.length > 0) {
      const itemNumbers = Array.from(new Set(result.oversized.map((o) => o.itemNumber))).sort((a, b) => a - b);
      excluded.push({ materialId, reason: 'panel-exceeds-sheet', itemNumbers });
    }
  }

  return { sheets, excluded };
}
