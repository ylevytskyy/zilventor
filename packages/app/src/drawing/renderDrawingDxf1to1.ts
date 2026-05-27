// packages/app/src/drawing/renderDrawingDxf1to1.ts
import type { DrawingDocument, DrawingSheet } from '@zilventor/shared';
import { createDxfDocument } from './dxfWriter';

const GAP_MM = 20;

/**
 * Render a DrawingSheet to an AutoCAD R12 ASCII DXF string at TRUE machining size (1:1).
 *
 * Geometry-only: visible/hidden edges per view at real model millimetres (view.scale is
 * IGNORED). Views are re-laid-out into a single horizontal row by their true bounding-box
 * footprints with a fixed gap, in original sheet reading order (top→bottom, left→right), so
 * true-size footprints never overlap. Builds natively in DXF Y-up (no sheet flip). No
 * dimensions, hatch, hole tables, title block, or `source` document.
 */
export function renderDrawingDxf1to1(_drawing: DrawingDocument, sheet: DrawingSheet): string {
  const doc = createDxfDocument();

  const views = sheet.views
    .filter((v) => v.projection != null)
    .sort((a, b) => (a.positionMm.y - b.positionMm.y) || (a.positionMm.x - b.positionMm.x));

  let lx = 0;
  for (const view of views) {
    const proj = view.projection;
    if (!proj) continue;
    const { bbox, visibleEdges, hiddenEdges } = proj;

    // view-local model mm → DXF Y-up, placed at (lx, 0).
    const tx = (px: number): number => lx + (px - bbox.minX);
    const ty = (py: number): number => bbox.maxY - py;

    for (const edge of visibleEdges) {
      if (edge.points.length < 2) continue;
      doc.polyline('VISIBLE', edge.points.map(([x, y]) => [tx(x), ty(y)] as readonly [number, number]));
    }
    for (const edge of hiddenEdges) {
      if (edge.points.length < 2) continue;
      doc.polyline('HIDDEN', edge.points.map(([x, y]) => [tx(x), ty(y)] as readonly [number, number]));
    }

    lx += (bbox.maxX - bbox.minX) + GAP_MM;
  }

  return doc.toString();
}
