import { createDxfDocument } from './dxfWriter';
import { MANUFACTURING_LAYERS } from './manufacturingLayers';
import type { NestSheet } from '@zilventor/shared';

/**
 * One true-mm cut-layout DXF for a single nest sheet.
 * Layers: SHEET (stock boundary), OUTLINE (panel cut rects), INFO (labels).
 * `rotated` is already baked into length/width — no swap here (see plan Global Constraints).
 */
export function renderNestSheetDxf(
  sheet: NestSheet,
  meta: { sheetCount: number; materialName: string },
): string {
  const doc = createDxfDocument();
  const L = sheet.sheetLengthMm;
  const W = sheet.sheetWidthMm;

  doc.lwpolyline(MANUFACTURING_LAYERS.sheet, [
    { x: 0, y: 0 }, { x: L, y: 0 }, { x: L, y: W }, { x: 0, y: W },
  ], true);

  for (const p of sheet.panels) {
    const w = p.length; // X-extent (rotation already baked in)
    const h = p.width;  // Y-extent
    doc.lwpolyline(MANUFACTURING_LAYERS.outline, [
      { x: p.x, y: p.y }, { x: p.x + w, y: p.y },
      { x: p.x + w, y: p.y + h }, { x: p.x, y: p.y + h },
    ], true);
    doc.text(MANUFACTURING_LAYERS.info, p.x + w / 2, p.y + h / 2, 15, `#${p.itemNumber}  ${p.length}×${p.width}`);
  }

  doc.text(
    MANUFACTURING_LAYERS.info,
    0, W + 30, 30,
    `Sheet ${sheet.sheetIndex + 1}/${meta.sheetCount} · ${meta.materialName} · util ${sheet.utilizationPct}%`,
  );

  return doc.toString();
}
