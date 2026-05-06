// packages/shared/src/drawing/applyBreaks.ts
// Pure 2D function: applies axis-aligned band removals to projected Edge2D arrays.
// No kernel calls. No side effects. Spec §7.

import type { Edge2D } from './projectedGeometry';
import type { BreakRegion } from './types';

export type ApplyBreaksResult = {
  readonly edges: readonly Edge2D[];
  readonly breakSymbolEdges: readonly Edge2D[];
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Zigzag constants (spec §7.2 step 4) */
const AMPLITUDE = 1.5;   // mm — half-peak displacement
const PERIOD    = 3.0;   // mm — one full tooth cycle
const OVERHANG  = 5.0;   // mm — symbol extends past bbox on each perpendicular side

type Seg1D = {
  p0: readonly [number, number];
  p1: readonly [number, number];
  /** 'a' = before portion (clipped at coordA), 'b' = after portion (clipped at coordB),
   *  'whole' = not split (entire edge stays on one side) */
  side: 'a' | 'b' | 'whole';
};

/**
 * Clips a single two-point segment [p0, p1] against the REMOVED band [coordA, coordB]
 * along the given axis. Returns surviving fragments outside the band.
 *
 * Classification uses 1e-9 tolerance:
 *   coord <= coordA → "before" (keep, no shift)
 *   coord >= coordB → "after"  (keep, apply shift)
 *   otherwise       → "inside" (drop)
 *
 * Returns 0, 1, or 2 Seg1D items.
 */
function clipEdge1D(
  p0: readonly [number, number],
  p1: readonly [number, number],
  axis: 'x' | 'y',
  coordA: number,
  coordB: number,
): Seg1D[] {
  const EPS = 1e-9;

  // Coord along the break axis
  const c0 = axis === 'x' ? p0[0] : p0[1];
  const c1 = axis === 'x' ? p1[0] : p1[1];

  const beforeA0 = c0 <= coordA + EPS;
  const beforeA1 = c1 <= coordA + EPS;
  const afterB0  = c0 >= coordB - EPS;
  const afterB1  = c1 >= coordB - EPS;
  const insideStrict0 = c0 > coordA + EPS && c0 < coordB - EPS;
  const insideStrict1 = c1 > coordA + EPS && c1 < coordB - EPS;

  // Helpers to interpolate along axis
  const lerp = (t: number): readonly [number, number] => {
    const x = p0[0] + t * (p1[0] - p0[0]);
    const y = p0[1] + t * (p1[1] - p0[1]);
    return [x, y] as const;
  };

  const tForCoord = (target: number): number => {
    const span = c1 - c0;
    if (Math.abs(span) < 1e-15) return 0;
    return (target - c0) / span;
  };

  // ── Both before (or on) coordA ──────────────────────────────────────────
  if (beforeA0 && beforeA1) {
    return [{ p0, p1, side: 'whole' }];
  }

  // ── Both after (or on) coordB ──────────────────────────────────────────
  if (afterB0 && afterB1) {
    return [{ p0, p1, side: 'whole' }];
  }

  // ── Both strictly inside ────────────────────────────────────────────────
  if (insideStrict0 && insideStrict1) {
    return [];
  }

  // ── p0 before, p1 before ─ redundant but handled above ─────────────────

  // ── p0 before, p1 inside or after — crosses coordA ─────────────────────
  if (beforeA0 && !beforeA1) {
    if (afterB1) {
      // Spans full band: before → inside → after
      const tA = tForCoord(coordA);
      const tB = tForCoord(coordB);
      const ptA = lerp(tA);
      const ptB = lerp(tB);
      return [
        { p0, p1: ptA, side: 'a' },
        { p0: ptB, p1, side: 'b' },
      ];
    } else {
      // Crosses coordA only; p1 inside → drop inside portion
      const tA = tForCoord(coordA);
      const ptA = lerp(tA);
      return [{ p0, p1: ptA, side: 'a' }];
    }
  }

  // ── p0 after, p1 before — reversed direction: spans full band ──────────
  if (afterB0 && beforeA1) {
    // p0 is after coordB, p1 is before coordA → full band in between
    // Before portion: p0 side (after), before portion: p1 side (before)
    // Split at coordB (going from after→inside) and coordA (inside→before)
    const tB = tForCoord(coordB);
    const tA = tForCoord(coordA);
    const ptB = lerp(tB);
    const ptA = lerp(tA);
    return [
      { p0: ptA, p1, side: 'a' },   // before half (p1 direction)
      { p0, p1: ptB, side: 'b' },   // after half (p0 direction)
    ];
  }

  // ── p0 after, p1 inside or before ────────────────────────────────────────
  if (afterB0 && !afterB1) {
    if (beforeA1) {
      // Already handled above
      const tB = tForCoord(coordB);
      const tA = tForCoord(coordA);
      const ptB = lerp(tB);
      const ptA = lerp(tA);
      return [
        { p0: ptA, p1, side: 'a' },
        { p0, p1: ptB, side: 'b' },
      ];
    } else {
      // p1 inside → crosses coordB only; drop inside
      const tB = tForCoord(coordB);
      const ptB = lerp(tB);
      return [{ p0, p1: ptB, side: 'b' }];
    }
  }

  // ── p0 inside, p1 before ─ crosses coordA ────────────────────────────────
  if (insideStrict0 && beforeA1) {
    const tA = tForCoord(coordA);
    const ptA = lerp(tA);
    return [{ p0: ptA, p1, side: 'a' }];
  }

  // ── p0 inside, p1 after ─ crosses coordB ────────────────────────────────
  if (insideStrict0 && afterB1) {
    const tB = tForCoord(coordB);
    const ptB = lerp(tB);
    return [{ p0: ptB, p1, side: 'b' }];
  }

  // ── p1 before, p0 inside ─ already covered above ────────────────────────
  // ── p1 after, p0 inside ─ crosses coordB ────────────────────────────────
  if (insideStrict1 && afterB0) {
    const tB = tForCoord(coordB);
    const ptB = lerp(tB);
    return [{ p0, p1: ptB, side: 'b' }];
  }

  // ── p1 inside, p0 before ─────────────────────────────────────────────────
  if (insideStrict1 && beforeA0) {
    const tA = tForCoord(coordA);
    const ptA = lerp(tA);
    return [{ p0, p1: ptA, side: 'a' }];
  }

  // Fallback (should not be reached)
  return [];
}

/**
 * Translate a point along axis by shift.
 */
function translatePoint(
  p: readonly [number, number],
  axis: 'x' | 'y',
  shift: number,
): readonly [number, number] {
  if (axis === 'x') return [p[0] + shift, p[1]] as const;
  return [p[0], p[1] + shift] as const;
}

/**
 * Emit a zigzag (sawtooth) Edge2D for one break symbol.
 * spine_pos = coordA + gapMm (from AB-9 ground truth, per plan preamble).
 * Zigzag runs perpendicular to axis, spanning [perpMin-OVERHANG, perpMax+OVERHANG].
 * Id scheme: 'break_<breakId>' (no viewId prefix; spec §7.1 / plan note).
 */
function emitZigzagPolyline(
  axis: 'x' | 'y',
  spinePos: number,
  viewBbox: { minX: number; minY: number; maxX: number; maxY: number },
  breakId: string,
): Edge2D {
  // Perpendicular extent
  const perpMin = (axis === 'x' ? viewBbox.minY : viewBbox.minX) - OVERHANG;
  const perpMax = (axis === 'x' ? viewBbox.maxY : viewBbox.maxX) + OVERHANG;

  const pts: Array<readonly [number, number]> = [];
  const perpSpan = perpMax - perpMin;
  const numTeeth = Math.floor(perpSpan / PERIOD);

  for (let i = 0; i <= numTeeth; i++) {
    const t0 = perpMin + i * PERIOD;
    const t1 = t0 + PERIOD * 0.25;
    const t2 = t0 + PERIOD * 0.75;
    const t3 = t0 + PERIOD;

    if (axis === 'x') {
      pts.push([spinePos,             Math.min(t0, perpMax)]);
      if (t1 <= perpMax) pts.push([spinePos + AMPLITUDE, t1]);
      if (t2 <= perpMax) pts.push([spinePos - AMPLITUDE, t2]);
      if (t3 <= perpMax) pts.push([spinePos,             t3]);
    } else {
      pts.push([Math.min(t0, perpMax), spinePos]);
      if (t1 <= perpMax) pts.push([t1, spinePos + AMPLITUDE]);
      if (t2 <= perpMax) pts.push([t2, spinePos - AMPLITUDE]);
      if (t3 <= perpMax) pts.push([t3, spinePos]);
    }
  }

  // Final clamp: ensure last point touches perpMax
  if (pts.length > 0) {
    const last = pts[pts.length - 1]!;
    if (axis === 'x') {
      pts[pts.length - 1] = [last[0], perpMax];
    } else {
      pts[pts.length - 1] = [perpMax, last[1]];
    }
  }
  // Ensure first point is at perpMin
  if (pts.length > 0) {
    const first = pts[0]!;
    if (axis === 'x') {
      pts[0] = [first[0], perpMin];
    } else {
      pts[0] = [perpMin, first[1]];
    }
  }

  return {
    id: `break_${breakId}`,
    kind: 'break',
    points: pts,
  };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Pure function. No I/O, no side effects, deterministic.
 * Applies a sequence of BreakRegion strip removals to an Edge2D array.
 * Breaks are processed in ascending coordA order (internally sorted).
 * Returns compressed geometry edges and synthetic break-symbol edges.
 * Spec §7.
 */
export function applyBreaks(
  edges: readonly Edge2D[],
  breaks: readonly BreakRegion[],
  viewBbox: { minX: number; minY: number; maxX: number; maxY: number },
): ApplyBreaksResult {
  if (breaks.length === 0) {
    return { edges: [...edges], breakSymbolEdges: [] };
  }

  // Sort breaks by coordA ascending (spec §7.3)
  const sortedBreaks = [...breaks].sort((a, b) => a.coordA - b.coordA);

  // Cumulative shift per axis (spec §7.3)
  const cumShift: Record<'x' | 'y', number> = { x: 0, y: 0 };

  // We process edges iteratively through each break.
  // Each break operates on the original edge coordinate space but the cumulative
  // shift is applied to "after" fragments. This matches spec §7.3 note:
  // "each subsequent break's coordA and coordB are in the original edge coordinate space".
  // We use the "parallel accumulate" strategy: track all edges with their cumulative
  // shifts applied so far, applying each break in turn.
  //
  // Representation: working set of {edge, applied_shift_x, applied_shift_y}
  // At end, edges have been shifted. We translate coordinates lazily during break processing.

  // Track edges currently in the working set, in original coordinate space.
  // For efficiency and clarity, we process each break against the current working edges.
  // At each break, we:
  //   1. Clip all working edges (in original space + prior cumShift applied) vs the break band.
  //   2. Apply the new shift to "after" fragments.
  //   3. Emit break symbol.

  // Strategy: maintain working edges with their already-applied shifts (i.e. in current
  // display coordinate space after prior breaks). Each break's coordA/coordB are in
  // ORIGINAL space. So when we process break k, we adjust for cumulative prior shift
  // to get the break boundaries in the current display space.

  let workingEdges: Edge2D[] = [...edges];
  const breakSymbolEdges: Edge2D[] = [];

  for (const br of sortedBreaks) {
    const axis = br.axis;
    const shift = -(br.coordB - br.coordA - br.gapMm); // spec §7.2 step 2

    // Adjust break coordinates from original space to current display space
    // (i.e., after applying prior cumulative shifts along this axis)
    const priorShift = cumShift[axis];
    const displayCoordA = br.coordA + priorShift;
    const displayCoordB = br.coordB + priorShift;

    // Emit break symbol: spine_pos = coordA + gapMm (in display space, per plan note)
    // Plan: "spine_pos = coordA + gapMm (with cumulative shift already baked into coordA if needed)"
    // AB-9: coordA=100, gapMm=5, single break (no prior shift) → spine at 105.
    // With prior shift: spine = (coordA + priorShift) + gapMm = displayCoordA + gapMm
    const spinePos = displayCoordA + br.gapMm;
    breakSymbolEdges.push(emitZigzagPolyline(axis, spinePos, viewBbox, br.id));

    // Process each working edge against this break
    const nextEdges: Edge2D[] = [];

    for (const edge of workingEdges) {
      // For a 2-point edge, clip directly.
      // For multi-point polylines, clip segment by segment — but our Edge2D is always
      // a 2-point segment (the projector emits one segment per edge).
      // The clipEdge1D function handles the two-point case.
      if (edge.points.length < 2) {
        nextEdges.push(edge);
        continue;
      }

      if (edge.points.length === 2) {
        const segs = clipEdge1D(edge.points[0]!, edge.points[1]!, axis, displayCoordA, displayCoordB);
        let hasBefore = false;
        let hasAfter  = false;
        for (const s of segs) {
          if (s.side === 'a') hasBefore = true;
          if (s.side === 'b') hasAfter  = true;
          if (s.side === 'whole') {
            // whole: determine which side
            const c = axis === 'x' ? s.p0[0] : s.p0[1];
            if (c <= displayCoordA + 1e-9) hasBefore = true;
            else hasAfter = true;
          }
        }
        const bothSides = hasBefore && hasAfter;

        for (const s of segs) {
          let newId: string;
          let newPts: Array<readonly [number, number]>;

          if (s.side === 'a') {
            newId  = bothSides ? `${edge.id}_a` : `${edge.id}_a`;
            // Before fragment: not shifted
            newPts = [s.p0, s.p1];
            nextEdges.push({
              ...edge,
              id: newId,
              points: newPts,
            });
          } else if (s.side === 'b') {
            newId = bothSides ? `${edge.id}_b` : `${edge.id}_b`;
            // After fragment: apply current break shift
            newPts = [
              translatePoint(s.p0, axis, shift),
              translatePoint(s.p1, axis, shift),
            ];
            nextEdges.push({
              ...edge,
              id: newId,
              points: newPts,
            });
          } else {
            // 'whole': determine if before or after (no split)
            const c = axis === 'x' ? s.p0[0] : s.p0[1];
            const isAfter = c >= displayCoordB - 1e-9;
            if (isAfter) {
              newPts = [
                translatePoint(s.p0, axis, shift),
                translatePoint(s.p1, axis, shift),
              ];
            } else {
              newPts = [s.p0, s.p1];
            }
            nextEdges.push({
              ...edge,
              id: edge.id,  // id unchanged for whole
              points: newPts,
            });
          }
        }
      } else {
        // Multi-point polyline: treat as sequence of 2-point segments, then re-stitch
        // (Rare in practice — projector emits 2-point edges. Keep as passthrough for safety.)
        nextEdges.push(edge);
      }
    }

    workingEdges = nextEdges;
    // Accumulate shift for subsequent breaks (spec §7.3).
    // shift is negative (e.g. −45), so cumShift decreases.
    // Next break's coordA in display space = coordA_original + cumShift.
    cumShift[axis] += shift;
  }

  return { edges: workingEdges, breakSymbolEdges };
}
