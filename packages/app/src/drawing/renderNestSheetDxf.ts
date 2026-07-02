import { createDxfDocument, type DxfDocument } from './dxfWriter';
import { MANUFACTURING_LAYERS } from './manufacturingLayers';
import type { NestSheet, PlacedPanel } from '@zilventor/shared';

/**
 * Grain annotation for a placed panel, in sheet axes. A panel's grain axis is fixed
 * to the material (length- or width-wise); when the panel was nested `rotated`, its
 * length/width extents were swapped, so the grain axis swaps with them.
 */
function drawGrain(doc: DxfDocument, p: PlacedPanel): void {
  if (p.grain === 'none') return;
  const effective = p.rotated ? (p.grain === 'length' ? 'width' : 'length') : p.grain;
  const cx = p.x + p.length / 2, cy = p.y + p.width / 2;
  if (effective === 'length') {
    const a = p.length * 0.3;
    doc.line(MANUFACTURING_LAYERS.grain, cx - a, cy, cx + a, cy);
    doc.line(MANUFACTURING_LAYERS.grain, cx + a, cy, cx + a - 10, cy + 6);
    doc.line(MANUFACTURING_LAYERS.grain, cx + a, cy, cx + a - 10, cy - 6);
  } else {
    const a = p.width * 0.3;
    doc.line(MANUFACTURING_LAYERS.grain, cx, cy - a, cx, cy + a);
    doc.line(MANUFACTURING_LAYERS.grain, cx, cy + a, cx + 6, cy + a - 10);
    doc.line(MANUFACTURING_LAYERS.grain, cx, cy + a, cx - 6, cy + a - 10);
  }
}

/**
 * One true-mm cut-layout DXF for a single nest sheet.
 * Layers: SHEET (stock boundary), OUTLINE (panel cut rects), GRAIN (grain-marked
 * panels only), INFO (labels).
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
    drawGrain(doc, p);
    doc.text(MANUFACTURING_LAYERS.info, p.x + w / 2, p.y + h / 2, 15, `#${p.itemNumber}  ${p.length}x${p.width}`);
  }

  doc.text(
    MANUFACTURING_LAYERS.info,
    0, W + 30, 30,
    `Sheet ${sheet.sheetIndex}/${meta.sheetCount} - ${meta.materialName} - util ${sheet.utilizationPct}%`,
  );

  return doc.toString();
}
