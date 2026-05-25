// packages/shared/src/drawing/projectDetailView.ts
//
// Pure 2D projector orchestrator for detail views.
// No I/O, no side effects, deterministic. See spec §4 and §6.1.

import type { Edge2D, ProjectedGeometry } from './projectedGeometry';
import { clipEdgesToCircle } from './clipEdgesToCircle';
import { clipEdgesToRect } from './clipEdgesToRect';
import type { RegionParent } from './types';

// ---------------------------------------------------------------------------
// Types (spec §6.1)
// ---------------------------------------------------------------------------

export type DetailViewInput = {
  readonly parentView: {
    readonly scale: { readonly numerator: number; readonly denominator: number };
    readonly projection: ProjectedGeometry;
  };
  readonly regionParent: RegionParent;
  readonly detailScale: { readonly numerator: number; readonly denominator: number };
  readonly showHidden: boolean;
};

export type DetailViewOutput = {
  readonly visibleEdges: readonly Edge2D[];
  readonly hiddenEdges: readonly Edge2D[];
  readonly bbox: { minX: number; minY: number; maxX: number; maxY: number };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function translateAndScale(
  edges: Edge2D[],
  cx: number,
  cy: number,
  factor: number,
): Edge2D[] {
  return edges.map(edge => ({
    ...edge,
    points: edge.points.map(
      ([x, y]): readonly [number, number] => [
        (x - cx) * factor,
        (y - cy) * factor,
      ],
    ),
  }));
}

function computeBbox(
  edges: readonly Edge2D[],
): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const edge of edges) {
    for (const [x, y] of edge.points) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/**
 * Clip edges against the regionParent boundary, dispatching on kind.
 * circle → clipEdgesToCircle; rect → clipEdgesToRect.
 * The translate (center→origin) and scale steps are shared — both shapes are center-based.
 */
function clipEdges(
  edges: readonly Edge2D[],
  regionParent: RegionParent,
): Edge2D[] {
  if (regionParent.kind === 'circle') {
    return clipEdgesToCircle(edges, regionParent.center, regionParent.radiusMm);
  }
  // kind === 'rect'
  return clipEdgesToRect(edges, {
    center: regionParent.center,
    widthMm: regionParent.widthMm,
    heightMm: regionParent.heightMm,
  });
}

// ---------------------------------------------------------------------------
// Main entry (spec §6.1)
// ---------------------------------------------------------------------------

/**
 * Clips the parent view's projected edges against the region and transforms
 * the clipped edges to detail-local mm space.
 *
 * Step 1: Clip parent edges against regionParent (circle or rect).
 * Step 2: Translate clipped points by -regionParent.center (center → origin).
 * Step 3: Scale by detailScaleFactor =
 *         (detailScale.num/detailScale.den) / (parentScale.num/parentScale.den).
 * Step 4: Recompute bbox from transformed points.
 */
export function projectDetailView(input: DetailViewInput): DetailViewOutput {
  const { parentView, regionParent, detailScale, showHidden } = input;
  const { center } = regionParent;

  // Step 1: Clip
  const clippedVisible = clipEdges(parentView.projection.visibleEdges, regionParent);
  const clippedHidden = showHidden
    ? clipEdges(parentView.projection.hiddenEdges, regionParent)
    : [];

  // Step 2 + 3: Translate to origin then scale to detail-local mm
  const parentScale =
    parentView.scale.numerator / parentView.scale.denominator;
  const detailScaleVal =
    detailScale.numerator / detailScale.denominator;
  const factor = detailScaleVal / parentScale;

  const visibleEdges = translateAndScale(clippedVisible, center.x, center.y, factor);
  const hiddenEdges  = translateAndScale(clippedHidden,  center.x, center.y, factor);

  // Step 4: Recompute bbox
  const allEdges = [...visibleEdges, ...hiddenEdges];
  const bbox = computeBbox(allEdges);

  return { visibleEdges, hiddenEdges, bbox };
}
