// packages/shared/src/drawing/autoPlaceCenterMarks.ts
//
// Auto-detect circular/arc edges in a projected drawing view and emit one
// center-mark annotation per arc. Mirrors Autodesk Inventor 2012 behavior:
// a small cross is placed at the circumcenter of every visible hole/arc edge
// when a view is projected.
//
// Only VISIBLE edges are considered — hidden-line arcs don't get center marks
// (Inventor convention).
//
// How robust center detection works (2026-05-30 rework):
//   The depth-buffer edge classifier (classifyEdges) run-length-encodes each 3D
//   edge into visibility runs with ids `${baseEdgeId}_${runIndex}`. A circular rim
//   edge is split into ~36 short visible runs. Short near-collinear fragments give
//   garbage circumcenters via the 3-point heuristic. We now use
//   `resolveCenterMarkGeometry` which gathers ALL fragments sharing the same base
//   edge id, concatenates their points, and runs a Kasa algebraic circle fit over
//   the combined point set — robust against asymmetric fragment subsets and
//   off-axis/off-origin holes.
//
// edgeId in the emitted annotation:
//   The annotation's edgeId is the lex-first ACTUAL run edge id within the base
//   group (e.g. "rim_1_0" not "rim_1"). This ensures the renderer can find the
//   edge in view.projection.visibleEdges by exact id match (the base id without
//   suffix is never directly in the edges array).
//
// Dedupe: a single through-hole also produces a TOP and BOTTOM rim edge, both with
// the same center after Kasa fit. The COINCIDENT_TOL_MM step collapses them to one.

import type { ProjectedGeometry } from './projectedGeometry';
import type { DrawingAnnotation } from './types';
import { isArcEdge } from './isArcEdge';
import { resolveCenterMarkGeometry, stripRunSuffix } from './resolveCenterMarkGeometry';

/** Two arc-group centers are "the same hole" if their distance is within this tolerance (mm). */
const COINCIDENT_TOL_MM = 0.5;

/**
 * Iterate `projection.visibleEdges`, filter by `isArcEdge`, group runs that
 * share the same base edge id (same 3D rim edge, just different depth-buffer
 * visibility runs), compute a ROBUST Kasa circle fit center for each base group,
 * dedupe coincident centers (COINCIDENT_TOL_MM), and return one
 * `DrawingAnnotation` with `kind: 'center-mark'` per distinct center.
 *
 * Annotation edgeId = lex-first ACTUAL run id within the base group, so the
 * renderer can find the edge by exact id match in view.projection.visibleEdges.
 * Annotation id = `cm-<viewId>-<lex-first-run-id>`, stable within a session.
 */
export function autoPlaceCenterMarks(
  projection: ProjectedGeometry,
  viewId: string,
): DrawingAnnotation[] {
  // Step 1: collect arc-passing visible edges grouped by their base (un-suffixed) id.
  // Track lex-first run id per base group for stable annotation ids.
  type BaseGroup = {
    baseId: string;
    lexFirstRunId: string;
  };
  const baseGroups = new Map<string, BaseGroup>();

  for (const edge of projection.visibleEdges) {
    if (!isArcEdge(edge.points)) continue;
    const base = stripRunSuffix(edge.id);
    const existing = baseGroups.get(base);
    if (existing) {
      if (edge.id < existing.lexFirstRunId) existing.lexFirstRunId = edge.id;
    } else {
      baseGroups.set(base, { baseId: base, lexFirstRunId: edge.id });
    }
  }

  if (baseGroups.size === 0) return [];

  // Step 2: for each base group, compute the robust Kasa center via the shared helper.
  // The helper gathers ALL fragments for that base id, concatenates points, fits circle.
  type ArcCandidate = { runId: string; cx: number; cy: number };
  const candidates: ArcCandidate[] = [];

  for (const bg of baseGroups.values()) {
    const geom = resolveCenterMarkGeometry(projection.visibleEdges, bg.lexFirstRunId);
    if (geom === null) continue;
    candidates.push({ runId: bg.lexFirstRunId, cx: geom.cx, cy: geom.cy });
  }

  // Step 3: dedupe by coincident center (handles top+bottom rim of a
  // through-hole having the same center but different baseEdgeIds). Representative
  // = lex-first lexFirstRunId in the coincident group (stable within a session).
  type Group = { cx: number; cy: number; repRunId: string };
  const groups: Group[] = [];
  for (const c of candidates) {
    let matched = false;
    for (const g of groups) {
      const dx = c.cx - g.cx;
      const dy = c.cy - g.cy;
      if (Math.sqrt(dx * dx + dy * dy) <= COINCIDENT_TOL_MM) {
        if (c.runId < g.repRunId) g.repRunId = c.runId;
        matched = true;
        break;
      }
    }
    if (!matched) {
      groups.push({ cx: c.cx, cy: c.cy, repRunId: c.runId });
    }
  }

  return groups.map((g) => ({
    id: `cm-${viewId}-${g.repRunId}`,
    kind: 'center-mark' as const,
    viewId,
    edgeId: g.repRunId,
  }));
}
