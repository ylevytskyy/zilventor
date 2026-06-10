import { createDxfDocument } from './dxfWriter';
import type { BoringAggregateResult } from '../assembly/walkers/aggregateBoresRecursive';
import type { BoreOp } from '@zilventor/shared';

const PANEL_GAP = 50;        // mm gap between panels on the grid
const DEFAULT_SPAN = 100;    // mm fallback panel extent when a panel has no bores

/** Bounding span of a panel's bores in (u,v); used to size the outline rectangle. */
function panelSpan(bores: ReadonlyArray<BoreOp>): { w: number; h: number } {
  if (bores.length === 0) return { w: DEFAULT_SPAN, h: DEFAULT_SPAN };
  let maxU = 0, maxV = 0;
  for (const b of bores) { maxU = Math.max(maxU, b.u); maxV = Math.max(maxV, b.v); }
  // Pad so bores at the extreme edge are not on the outline.
  return { w: maxU + DEFAULT_SPAN / 2, h: maxV + DEFAULT_SPAN / 2 };
}

/** Layer name per (Ø,depth): integerise the diameter; depth 'throughAll' → THROUGH. */
function boreLayer(b: BoreOp): string {
  const dia = Number.isInteger(b.diameter) ? String(b.diameter) : String(b.diameter).replace('.', '_');
  const depth = b.depth === 'throughAll' ? 'THROUGH' : `T${b.depth}`;
  return `D${dia}_${depth}`;
}

function drawPanelOutline(
  doc: ReturnType<typeof createDxfDocument>,
  x0: number, w: number, h: number,
): void {
  const pts: ReadonlyArray<readonly [number, number]> = [
    [x0, 0], [x0 + w, 0], [x0 + w, h], [x0, h], [x0, 0],
  ];
  doc.polyline('OUTLINE', pts);
}

/** Render a per-panel boring map to a single AutoCAD R12 DXF string.
 *  Panels are laid out left-to-right on a row, offset by PANEL_GAP.
 *  Input comes from aggregateBoresRecursive (recursion into sub-assemblies is
 *  already handled by the aggregator — this function just consumes the result). */
export function renderBoringDxf(result: BoringAggregateResult): string {
  const doc = createDxfDocument();
  let xOffset = 0;
  for (const panel of result.panels) {
    const { w, h } = panelSpan(panel.bores);
    drawPanelOutline(doc, xOffset, w, h);
    for (const b of panel.bores) {
      doc.circle(boreLayer(b), xOffset + b.u, b.v, b.diameter / 2);
    }
    xOffset += w + PANEL_GAP;
  }
  return doc.toString();
}
