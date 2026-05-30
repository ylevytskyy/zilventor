// packages/shared/src/drawing/resolveCenterMarkGeometry.ts
//
// Shared helper used by ALL center-mark consumers:
//   • autoPlaceCenterMarks (placement / dedup)
//   • renderDrawingSvg      (SVG export)
//   • renderDrawingPdf      (PDF export)
//   • renderDrawingDxf      (DXF export)
//   • AnnotationElement.tsx (live canvas)
//
// WHY this helper is needed
// ────────────────────────
// The depth-buffer edge classifier (classifyEdges) run-length-splits each 3-D
// circular rim edge into MANY short fragments whose ids look like
//   <baseId>_0, <baseId>_17, <baseId>_35, …
// Each fragment spans only a few degrees of the circle. With real OCCT
// tessellation floating-point noise, even sub-millimeter deviations from the
// true circle are amplified enormously by circumcenterFromPolyline when the
// fragment is near-collinear (D ≈ 0). Result: garbage center 1–6mm off.
//
// Fix: gather ALL fragments that share the same base id (strip the numeric
// `_\d+` classifier suffix), concatenate their points, and run a Kasa algebraic
// circle fit over the combined point set.  When the fragments are spread across
// the circle (0°/90°/180°/270° positions), Kasa is robust to 0.001mm noise.
//
// Strategy
// ────────
// • MULTIPLE fragments (same base id) → Kasa over concatenated points.
//   (This is the real-world classifier case. Multiple spread-out fragments
//   give Kasa enough geometric leverage.)
// • SINGLE fragment → circumcenterFromPolyline fallback.
//   (Kasa on a single small arc can produce inaccurate results with low rms
//   because many circles pass near a tiny arc. For clean, non-noisy edges
//   (legacy/manually-placed marks, test fixtures), circumcenter is accurate.)
// • No fragments found → null.

import type { Edge2D } from './projectedGeometry';
import { kasaFitCircle } from './kasaFitCircle';
import { circumcenterFromPolyline } from './circumcenter';

export type CenterMarkGeometry = {
  cx: number;
  cy: number;
  r: number;
};

/**
 * Strip the run-length-encoding suffix `_<int>` appended by classifyEdges.
 * e.g. "hole-1|top|0~hole-1|shank|0_17" → "hole-1|top|0~hole-1|shank|0"
 * Falls back to the full id if no purely-numeric suffix is present.
 * ("a_run0" has no numeric-only suffix; "rim_17" does.)
 */
export function stripRunSuffix(edgeId: string): string {
  const m = edgeId.match(/^(.*?)_\d+$/);
  return m ? m[1]! : edgeId;
}

/**
 * Resolve the circle center and radius for a center-mark annotation.
 *
 * @param visibleEdges  The projected view's visible edges (from ProjectedGeometry).
 * @param edgeId        The annotation's edgeId (a representative run id such as
 *                      "rim_1_0"; the base id may have more fragments in the array).
 *
 * @returns  { cx, cy, r } in view-local part-mm coordinates, or null if the
 *           edge is not found.
 */
export function resolveCenterMarkGeometry(
  visibleEdges: readonly Edge2D[],
  edgeId: string,
): CenterMarkGeometry | null {
  const base = stripRunSuffix(edgeId);

  // Collect all fragments whose stripped id equals the base id.
  const fragments = visibleEdges.filter((e) => stripRunSuffix(e.id) === base);
  if (fragments.length === 0) return null;

  if (fragments.length > 1) {
    // MULTIPLE fragments sharing a common base id → this is the classifier case.
    // Kasa over the concatenated point pool handles asymmetric fragment subsets
    // and tessellation noise far better than per-fragment circumcenter averaging.
    const allPoints: Array<readonly [number, number]> = [];
    for (const frag of fragments) {
      for (const pt of frag.points) {
        allPoints.push(pt);
      }
    }
    const fit = kasaFitCircle(allPoints);
    if (fit !== null) {
      return { cx: fit.cx, cy: fit.cy, r: fit.r };
    }
    // Degenerate Kasa (collinear) → fall through to circumcenter on rep fragment.
  }

  // SINGLE fragment (or degenerate Kasa fallback) → circumcenterFromPolyline.
  // Accurate for: clean mathematical arcs (test fixtures, legacy marks), edges
  // with sufficient arc span (>~30°).  Preserves backward compat.
  const rep = fragments[0]!;
  return circumcenterFromPolyline(rep.points);
}
