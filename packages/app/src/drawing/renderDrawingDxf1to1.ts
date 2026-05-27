// packages/app/src/drawing/renderDrawingDxf1to1.ts
import type { DrawingDocument, DrawingSheet } from '@zilventor/shared';
import { createDxfDocument } from './dxfWriter';

/**
 * Render a DrawingSheet to an AutoCAD R12 ASCII DXF string at TRUE machining size (1:1).
 *
 * Geometry-only: visible/hidden edges per view at real model millimetres (view.scale is
 * IGNORED). Builds natively in DXF Y-up (no sheet flip). No dimensions, hatch, hole tables,
 * title block, or `source` document. Multi-view re-spacing is added in Task 2 (this version
 * anchors every view at the origin).
 */
export function renderDrawingDxf1to1(_drawing: DrawingDocument, sheet: DrawingSheet): string {
  const doc = createDxfDocument();

  for (const view of sheet.views) {
    const proj = view.projection;
    if (!proj) continue;
    const { bbox, visibleEdges, hiddenEdges } = proj;

    // view-local model mm → DXF Y-up, anchored at origin (0,0).
    const tx = (px: number): number => px - bbox.minX;
    const ty = (py: number): number => bbox.maxY - py;

    for (const edge of visibleEdges) {
      if (edge.points.length < 2) continue;
      doc.polyline('VISIBLE', edge.points.map(([x, y]) => [tx(x), ty(y)] as readonly [number, number]));
    }
    for (const edge of hiddenEdges) {
      if (edge.points.length < 2) continue;
      doc.polyline('HIDDEN', edge.points.map(([x, y]) => [tx(x), ty(y)] as readonly [number, number]));
    }
  }

  return doc.toString();
}
