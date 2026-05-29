// packages/app/src/drawing/underlayTransform.ts
// Pure helpers for centering a DXF underlay (1:1, no scaling) on the sheet's drawable area.
//
// DXF is y-up; the sheet SVG/PDF is y-down. The render paths apply:
//   x_sheet = x_dxf + offsetMm.x
//   y_sheet = sheetH - y_dxf + offsetMm.y   (y-flip + centering)
//
// This module computes the offsetMm such that the underlay's bbox is
// centered in the drawable area (the region above the title block).

type BBox = { minX: number; minY: number; maxX: number; maxY: number };

/**
 * Compute the sheet-space offset to center the DXF underlay's bounding box
 * on the drawable area of a sheet, accounting for the DXF y-up → SVG/PDF y-down flip.
 *
 * @param sourceBBoxMm  Bounding box of the DXF entities in DXF coords (y-up). If absent → {0,0}.
 * @param sheetW        Sheet width in mm.
 * @param sheetH        Sheet height in mm.
 * @param margin        Sheet margin in mm (typically 10).
 * @param titleH        Title block height in mm (typically 20).
 *
 * @returns {x, y} offset to add AFTER the y-flip transform:
 *   x_sheet = x_dxf + offset.x
 *   y_sheet = sheetH - y_dxf + offset.y
 */
export function computeUnderlayOffset(
  sourceBBoxMm: BBox | undefined,
  sheetW: number,
  sheetH: number,
  margin: number,
  titleH: number,
): { x: number; y: number } {
  if (!sourceBBoxMm) return { x: 0, y: 0 };

  // Center of the drawable area (y-down sheet coords, above the title block)
  const drawableCx = margin + (sheetW - 2 * margin) / 2;
  const drawableCy = margin + (sheetH - 2 * margin - titleH) / 2;

  // Center of the DXF bbox (y-up DXF coords)
  const bboxCenterX = (sourceBBoxMm.minX + sourceBBoxMm.maxX) / 2;
  const bboxCenterY = (sourceBBoxMm.minY + sourceBBoxMm.maxY) / 2;

  // After y-flip: y_sheet = sheetH - y_dxf → flipped bbox center y = sheetH - bboxCenterY
  const flippedCy = sheetH - bboxCenterY;

  // Offsets: we want (x_dxf + offsetX) = drawableCx  when x_dxf = bboxCenterX
  const offsetX = drawableCx - bboxCenterX;
  // We want (sheetH - y_dxf + offsetY) = drawableCy when y_dxf = bboxCenterY → flippedCy + offsetY = drawableCy
  const offsetY = drawableCy - flippedCy;

  return { x: offsetX, y: offsetY };
}
