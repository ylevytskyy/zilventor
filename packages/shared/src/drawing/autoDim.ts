// packages/shared/src/drawing/autoDim.ts
// Auto-dimensioning helpers: sketch-primitive → Edge2D matching + greedy placement.
// No kernel calls. No side effects.

import type { SketchPrimitive, BoundingBox } from '../types';
import type { Edge2D } from './projectedGeometry';
import type { DrawingView } from './types';
import { buildViewMatrix, apply } from './viewMatrix';
import type { ViewOrientation } from './viewMatrix';
import type { DrawingDimension } from './types';

// ---------------------------------------------------------------------------
// Internal: 2D distance helper
// ---------------------------------------------------------------------------

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx, dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

// ---------------------------------------------------------------------------
// Internal: polyline total length
// ---------------------------------------------------------------------------

function polylineLength(points: ReadonlyArray<readonly [number, number]>): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    total += dist2(a[0], a[1], b[0], b[1]);
  }
  return total;
}

// ---------------------------------------------------------------------------
// findMatchingEdge2D
// ---------------------------------------------------------------------------

/**
 * Project a sketch primitive's endpoints through the extrude and view transforms
 * and find the matching Edge2D in the view's visible edges.
 *
 * Only 'line' primitives are handled in v1; all others return null.
 *
 * @param prim              - The sketch primitive to match.
 * @param extrudeDepth      - Extrude distance in mm (positive, forward direction).
 * @param viewOrientation   - Orientation string for buildViewMatrix.
 * @param view              - The DrawingView whose projection.visibleEdges are searched.
 * @param toleranceMm       - Match tolerance in mm (default 1e-3).
 * @param cachedBoundingBox - Part's 3D AABB [minX,minY,minZ,maxX,maxY,maxZ]. Required for
 *                            non-front orientations. Falls back to a lifted 2D bbox + extrudeDepth
 *                            if absent (correct only for front views).
 * @returns The matching Edge2D, or null if no match within tolerance.
 */
export function findMatchingEdge2D(
  prim: SketchPrimitive,
  extrudeDepth: number,
  viewOrientation: string,
  view: DrawingView,
  toleranceMm = 1e-3,
  cachedBoundingBox?: BoundingBox,
): Edge2D | null {
  // Guard: only line primitives in v1
  if (prim.kind !== 'line') return null;

  // Guard: view must have a projection
  const proj = view.projection;
  if (!proj) return null;

  // Resolve the BoundingBox for buildViewMatrix.
  // Prefer cachedBoundingBox (correct for all orientations).
  // Fall back to lifting projection bbox to 3D using [0, extrudeDepth] for Z
  // — this is only geometrically correct for 'front' views.
  let sourceBbox: BoundingBox;
  if (cachedBoundingBox) {
    sourceBbox = cachedBoundingBox;
  } else {
    sourceBbox = [
      proj.bbox.minX, proj.bbox.minY, 0,
      proj.bbox.maxX, proj.bbox.maxY, extrudeDepth,
    ];
  }

  const M = buildViewMatrix(viewOrientation as ViewOrientation, sourceBbox);

  // Lift sketch endpoints to 3D (Z = 0 for forward extrude at sketch face)
  const pt1 = apply(M, { x: prim.x1, y: prim.y1, z: 0 });
  const pt2 = apply(M, { x: prim.x2, y: prim.y2, z: 0 });

  // Projected 2D coordinates (x, y from the view matrix output)
  const u1 = pt1.x, v1 = pt1.y;
  const u2 = pt2.x, v2 = pt2.y;

  // Primitive length in sketch-local space (mm)
  const primLen = dist2(prim.x1, prim.y1, prim.x2, prim.y2);

  // Search visible edges for a matching edge
  let bestEdge: Edge2D | null = null;
  let bestLenDiff = Infinity;

  for (const edge of proj.visibleEdges) {
    if (edge.points.length < 2) continue;
    const first = edge.points[0]!;
    const last  = edge.points[edge.points.length - 1]!;

    const ex0 = first[0], ey0 = first[1];
    const ex1 = last[0],  ey1 = last[1];

    // Check both endpoint orderings (directionality irrelevant)
    const fwdMatch =
      dist2(u1, v1, ex0, ey0) <= toleranceMm &&
      dist2(u2, v2, ex1, ey1) <= toleranceMm;
    const revMatch =
      dist2(u1, v1, ex1, ey1) <= toleranceMm &&
      dist2(u2, v2, ex0, ey0) <= toleranceMm;

    if (!fwdMatch && !revMatch) continue;

    // Candidate found — prefer the one whose polyline length is closest to primLen
    const edgeLen = polylineLength(edge.points);
    const lenDiff = Math.abs(edgeLen - primLen);

    if (lenDiff < bestLenDiff) {
      bestLenDiff = lenDiff;
      bestEdge = edge;
    }
  }

  return bestEdge;
}

// ---------------------------------------------------------------------------
// Overlap detection types
// ---------------------------------------------------------------------------

type PlacedRect = { minX: number; maxX: number; minY: number; maxY: number };

function rectsOverlap(a: PlacedRect, b: PlacedRect): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

// ---------------------------------------------------------------------------
// BBox2D — exported for consumers (AutoDimCommand)
// ---------------------------------------------------------------------------

export type BBox2D = { minX: number; minY: number; maxX: number; maxY: number };

// ---------------------------------------------------------------------------
// greedyPlaceDims
// ---------------------------------------------------------------------------

/**
 * Assign offsetMm to each candidate dimension using a greedy non-overlapping strategy.
 *
 * Strategy:
 * - linear-h: stack above bbox (Y decreasing). Starting offset = max(bboxHeight*0.15, 3).
 *   Subsequent increment:
 *     bboxWidth < 50 → bboxWidth * 0.15 (small-bbox path, no clamp)
 *     otherwise      → clamp(bboxWidth * 0.15, 8, 20)
 * - linear-v: stack to the right of bbox (X increasing). Same scaling on height dimension.
 * - aligned:  offset from midpoint at 3mm + N*8mm (fixed increment).
 *
 * Deterministic: candidates pre-sorted by (kind, id) — alphabetical, giving
 * aligned → linear-h → linear-v within kind groups. (`from.edgeId` plays no role;
 * radial/diametric lack a `from` field and are silently skipped if passed in.)
 *
 * @param candidates  - Dims with offsetMm === 0 (placeholder).
 * @param viewBboxMm  - View projection bbox.
 * @returns Array of placed dims with offsetMm filled in; overlapping dims excluded.
 */
export function greedyPlaceDims(
  candidates: DrawingDimension[],
  viewBboxMm: BBox2D,
): DrawingDimension[] {
  if (candidates.length === 0) return [];

  const bboxW = viewBboxMm.maxX - viewBboxMm.minX;
  const bboxH = viewBboxMm.maxY - viewBboxMm.minY;

  // Sort deterministically: by kind (alphabetical) then by id
  const sorted = [...candidates].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const placed: DrawingDimension[] = [];
  const placedRects: PlacedRect[] = [];

  // Per-kind stacking state
  let hOffset = Math.max(bboxH * 0.15, 3);
  let vOffset = Math.max(bboxW * 0.15, 3);
  let alignOffset = 3;

  // Increment helpers (spec §6.2)
  const hIncrement = bboxW < 50
    ? bboxW * 0.15
    : Math.min(Math.max(bboxW * 0.15, 8), 20);
  const vIncrement = bboxH < 50
    ? bboxH * 0.15
    : Math.min(Math.max(bboxH * 0.15, 8), 20);
  const alignIncrement = 8;

  // Font size used for overlap rect half-height
  const halfFontSize = 3.5 / 2;

  for (const dim of sorted) {
    if (dim.kind === 'linear-h') {
      const offset = hOffset;
      // Dim line is above bbox: Y = viewBboxMm.minY - offset
      const dimY = viewBboxMm.minY - offset;
      const rect: PlacedRect = {
        minX: viewBboxMm.minX,
        maxX: viewBboxMm.maxX,
        minY: dimY - halfFontSize,
        maxY: dimY + halfFontSize,
      };
      const overlaps = placedRects.some((r) => rectsOverlap(rect, r));
      if (!overlaps) {
        placed.push({ ...dim, offsetMm: offset } as DrawingDimension);
        placedRects.push(rect);
      }
      // Always increment so next candidate gets a fresh slot
      hOffset += hIncrement;
    } else if (dim.kind === 'linear-v') {
      const offset = vOffset;
      const dimX = viewBboxMm.maxX + offset;
      const rect: PlacedRect = {
        minX: dimX - halfFontSize,
        maxX: dimX + halfFontSize,
        minY: viewBboxMm.minY,
        maxY: viewBboxMm.maxY,
      };
      const overlaps = placedRects.some((r) => rectsOverlap(rect, r));
      if (!overlaps) {
        placed.push({ ...dim, offsetMm: offset } as DrawingDimension);
        placedRects.push(rect);
      }
      vOffset += vIncrement;
    } else if (dim.kind === 'aligned') {
      const offset = alignOffset;
      const midX = (viewBboxMm.minX + viewBboxMm.maxX) / 2;
      const midY = (viewBboxMm.minY + viewBboxMm.maxY) / 2;
      const rect: PlacedRect = {
        minX: midX - offset - halfFontSize,
        maxX: midX + offset + halfFontSize,
        minY: midY - offset - halfFontSize,
        maxY: midY + offset + halfFontSize,
      };
      const overlaps = placedRects.some((r) => rectsOverlap(rect, r));
      if (!overlaps) {
        placed.push({ ...dim, offsetMm: offset } as DrawingDimension);
        placedRects.push(rect);
      }
      alignOffset += alignIncrement;
    }
    // radial/diametric: not handled in v1 (AutoDimCommand never passes them)
  }

  return placed;
}
