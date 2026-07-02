import { createDxfDocument, type DxfDocument } from './dxfWriter';
import { MANUFACTURING_LAYERS } from './manufacturingLayers';
import { layoutCombinedGrid } from './layoutCombinedGrid';
import type { NestSheet, PlacedPanel } from '@zilventor/shared';

/**
 * Grain annotation for a placed panel, in sheet axes. A panel's grain axis is fixed
 * to the material (length- or width-wise); when the panel was nested `rotated`, its
 * length/width extents were swapped, so the grain axis swaps with them.
 */
function drawGrain(doc: DxfDocument, p: PlacedPanel, dx = 0, dy = 0): void {
  if (p.grain === 'none') return;
  const effective = p.rotated ? (p.grain === 'length' ? 'width' : 'length') : p.grain;
  const cx = p.x + p.length / 2 + dx, cy = p.y + p.width / 2 + dy;
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

/** Draws one sheet's boundary + panels + header label, all translated by (dx, dy). */
function drawSheet(
  doc: DxfDocument, sheet: NestSheet, materialName: string, sheetCount: number, dx = 0, dy = 0,
): void {
  const L = sheet.sheetLengthMm;
  const W = sheet.sheetWidthMm;

  doc.lwpolyline(MANUFACTURING_LAYERS.sheet, [
    { x: dx, y: dy }, { x: L + dx, y: dy }, { x: L + dx, y: W + dy }, { x: dx, y: W + dy },
  ], true);

  for (const p of sheet.panels) {
    const w = p.length; // X-extent (rotation already baked in)
    const h = p.width;  // Y-extent
    doc.lwpolyline(MANUFACTURING_LAYERS.outline, [
      { x: p.x + dx, y: p.y + dy }, { x: p.x + w + dx, y: p.y + dy },
      { x: p.x + w + dx, y: p.y + h + dy }, { x: p.x + dx, y: p.y + h + dy },
    ], true);
    drawGrain(doc, p, dx, dy);
    doc.text(MANUFACTURING_LAYERS.info, p.x + w / 2 + dx, p.y + h / 2 + dy, 15, `#${p.itemNumber}  ${p.length}x${p.width}`);
  }

  doc.text(
    MANUFACTURING_LAYERS.info,
    dx, W + 30 + dy, 30,
    `Sheet ${sheet.sheetIndex}/${sheetCount} - ${materialName} - util ${sheet.utilizationPct}%`,
  );
}

/** Layer names one sheet's entities actually draw into (mirrors drawSheet's calls). */
function neededLayers(sheet: NestSheet): string[] {
  const layers = new Set<string>([MANUFACTURING_LAYERS.sheet, MANUFACTURING_LAYERS.outline, MANUFACTURING_LAYERS.info]);
  if (sheet.panels.some((p) => p.grain !== 'none')) layers.add(MANUFACTURING_LAYERS.grain);
  return [...layers];
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
  drawSheet(doc, sheet, meta.materialName, meta.sheetCount);
  return doc.toString();
}

/**
 * One DXF document containing ALL given nest sheets, laid out on a row-wrapped grid
 * (50mm gutter, see layoutCombinedGrid) instead of one file per sheet. Single header +
 * single LAYER table (deduped union of every layer any sheet needs). Each sheet keeps
 * its own header INFO label, resolving its material name via `meta.materialNames`.
 */
export function renderCombinedNestDxf(
  sheets: NestSheet[],
  meta: { materialNames: Record<string, string> },
): string {
  const offsets = layoutCombinedGrid(
    sheets.map((s) => ({ width: s.sheetLengthMm, height: s.sheetWidthMm })),
    50,
  );
  const allLayers = new Set<string>();
  for (const sheet of sheets) for (const layer of neededLayers(sheet)) allLayers.add(layer);

  const doc = createDxfDocument([...allLayers]);
  sheets.forEach((sheet, idx) => {
    const { x: dx, y: dy } = offsets[idx]!;
    const materialName = meta.materialNames[sheet.materialId] ?? sheet.materialId;
    drawSheet(doc, sheet, materialName, sheets.length, dx, dy);
  });
  return doc.toString();
}
