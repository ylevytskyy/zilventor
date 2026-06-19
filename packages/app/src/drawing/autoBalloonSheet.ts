// packages/app/src/drawing/autoBalloonSheet.ts
// Task 6 — auto-balloon a sheet: one balloon annotation per parts-list row,
// each anchored to the bbox center of its representative component's edges in
// the view where that component has the most tagged edges.
//
// Coordinate space:
//   Edge.points are VIEW-LOCAL part-mm (pre-scale).
//   Balloon targetMm / textPosMm are SHEET-space mm.
//   Conversion: sheetMm = view.positionMm + localMm * (scale.numerator / scale.denominator)
//   This matches AnnotationElement.tsx's center-mark conversion exactly:
//     cx = view.positionMm.x + geom.cx * s  (where s = scale.numerator / scale.denominator)

import type { AssemblyDocument, PartInfo } from '@zilventor/shared';
import type { DrawingSheet, DrawingView } from '@zilventor/shared';
import type { PanelSpec } from '@zilventor/shared/src/panel-feature';
import { aggregateBomRecursive } from '../assembly/walkers/aggregateBomRecursive';
import { computePartsListRows } from './computePartsListRows';
import { representativePathByItem } from './componentItemNumbers';

// Local alias matching the SubAsmCacheLike type used by computePartsListRows.
type SubAsmCacheLike = {
  get: (p: string) => { kind: 'ok'; doc: AssemblyDocument; partPath: string } | undefined;
};

type BalloonAnnotation = Extract<
  import('@zilventor/shared').DrawingAnnotation,
  { kind: 'balloon' }
>;

const COLUMN_DX = 30;  // mm right of the view's rightmost edge (sheet space)
const LADDER_DY = 14;  // mm between stacked balloon text positions

export function autoBalloonSheet(args: {
  sheet: DrawingSheet;
  asm: AssemblyDocument;
  cache: SubAsmCacheLike;
  partInfo: Map<string, PartInfo>;
  panelSpecs: Map<string, PanelSpec | null>;
}): BalloonAnnotation[] {
  const { sheet, asm, cache, partInfo, panelSpecs } = args;

  // Get parts-list rows (same source as the parts-list annotation).
  const rows = computePartsListRows(asm, cache, panelSpecs, partInfo);

  // Build map: BOM item number → representative component path.
  const bomRows = aggregateBomRecursive(asm, cache, partInfo);
  const repByItem = representativePathByItem(bomRows);

  // Only views that have a populated projection can contribute edges.
  const viewsWithProjection = sheet.views.filter(
    (v): v is DrawingView & { projection: NonNullable<DrawingView['projection']> } =>
      v.projection !== undefined,
  );
  if (viewsWithProjection.length === 0) return [];

  // Pre-compute the rightmost view-local x for the ladder x-offset.
  const viewMaxX = computeViewMaxX(viewsWithProjection);

  const result: BalloonAnnotation[] = [];
  let ladderStep = 0;

  for (const row of rows) {
    const cp = repByItem.get(row.item);
    if (cp === undefined) continue;

    const hit = bestViewBBoxCenter(viewsWithProjection, cp);
    if (!hit) continue;

    const { view, cx: localCx, cy: localCy } = hit;
    const s = view.scale.numerator / view.scale.denominator;

    // Sheet-space target: positionMm + local * scale  (matches center-mark in AnnotationElement)
    const targetMm = {
      x: view.positionMm.x + localCx * s,
      y: view.positionMm.y + localCy * s,
    };

    // Ladder: stack in a column to the right of the widest view.
    const colX = view.positionMm.x + viewMaxX * s + COLUMN_DX;
    const textPosMm = {
      x: colX,
      y: view.positionMm.y + ladderStep * LADDER_DY,
    };
    ladderStep++;

    result.push({
      id: `auto-balloon-${row.item}`,
      kind: 'balloon',
      viewId: view.id,
      targetMm,
      textPosMm,
      itemNumber: row.item,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ViewWithProjection = DrawingView & {
  projection: NonNullable<DrawingView['projection']>;
};

/**
 * Pick the view where the component path has the most edge-point entries.
 * Returns the bbox center in VIEW-LOCAL mm space.
 */
function bestViewBBoxCenter(
  views: ViewWithProjection[],
  cp: string,
): { view: ViewWithProjection; cx: number; cy: number } | null {
  let best: { view: ViewWithProjection; cx: number; cy: number; count: number } | null = null;

  for (const view of views) {
    const proj = view.projection;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let count = 0;

    for (const e of [...proj.visibleEdges, ...proj.hiddenEdges]) {
      if (e.componentPath !== cp) continue;
      for (const [x, y] of e.points) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        count++;
      }
    }

    if (count === 0) continue;

    if (!best || count > best.count) {
      best = {
        view,
        cx: (minX + maxX) / 2,
        cy: (minY + maxY) / 2,
        count,
      };
    }
  }

  return best ? { view: best.view, cx: best.cx, cy: best.cy } : null;
}

/**
 * Returns the maximum view-local x across all projections (for ladder column placement).
 */
function computeViewMaxX(views: ViewWithProjection[]): number {
  let maxX = 0;
  for (const view of views) {
    for (const e of [...view.projection.visibleEdges, ...view.projection.hiddenEdges]) {
      for (const [x] of e.points) {
        if (x > maxX) maxX = x;
      }
    }
  }
  return maxX;
}
