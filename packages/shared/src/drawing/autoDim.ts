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
// greedyPlaceDims — placeholder; implemented in Task 1.3
// ---------------------------------------------------------------------------

export function greedyPlaceDims(
  candidates: DrawingDimension[],
  viewBboxMm: BBox2D,
): DrawingDimension[] {
  // Implemented in Task 1.3
  void candidates;
  void viewBboxMm;
  return [];
}
