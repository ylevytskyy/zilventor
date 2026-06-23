import { renderNestSheetDxf } from '../drawing/renderNestSheetDxf';
import type { NestState } from '@zilventor/shared';
import type { MaterialRegistry } from '@zilventor/shared';

function sanitize(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_');
}

export function buildNestZipEntries(
  nest: NestState,
  materials: MaterialRegistry,
): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const sheet of nest.sheets) {
    const materialName = materials.find((m) => m.id === sheet.materialId)?.name ?? sheet.materialId;
    const sheetCount = nest.sheets.filter((s) => s.materialId === sheet.materialId).length;
    entries[`${sanitize(sheet.materialId)}-sheet-${sheet.sheetIndex + 1}.dxf`] =
      renderNestSheetDxf(sheet, { sheetCount, materialName });
  }
  return entries;
}
