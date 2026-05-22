import { describe, it, expect } from 'vitest';
import { findMatchingEdge2D } from '../autoDim';
import type { DrawingView, BaseView, DrawingDimension } from '../types';
import type { Edge2D } from '../projectedGeometry';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** A minimal front-facing BaseView with one visible edge. */
function makeView(edges: Edge2D[]): BaseView {
  return {
    id: 'v1',
    kind: 'base',
    positionMm: { x: 0, y: 0 },
    scale: { numerator: 1, denominator: 1 },
    orientation: 'front',
    showHidden: false,
    projection: {
      visibleEdges: edges,
      hiddenEdges: [],
      bbox: { minX: 0, minY: 0, maxX: 100, maxY: 60 },
    },
  };
}

/**
 * Build a BoundingBox tuple [minX, minY, minZ, maxX, maxY, maxZ] for a box
 * centred at origin. For front-view tests, only the XY extents matter.
 */
const BOX_BBOX = [-50, -30, 0, 50, 30, 40] as const;

// ---------------------------------------------------------------------------
// HS-MATCH-1: horizontal line primitive → matches horizontal edge in front view
// ---------------------------------------------------------------------------

describe('findMatchingEdge2D — HS-MATCH-1: horizontal line on front view', () => {
  it('returns matching Edge2D for a horizontal line primitive', () => {
    // Sketch primitive: horizontal line from (0,0) to (50,0) in sketch-local space.
    // BOX_BBOX=[−50,−30,0,50,30,40] → cx=0,cy=0,cz=20
    // Point (0,0,0) → after Trecenter → (0,0,−20) → Rorient(front)=identity → projected (0,0).
    // Point (50,0,0) → (50,0,−20) → projected (50,0).
    const edge: Edge2D = {
      id: 'e-horiz',
      kind: 'outline',
      points: [[0, 0], [50, 0]],
    };
    const view = makeView([edge]);
    const prim = { id: 'p1', kind: 'line' as const, x1: 0, y1: 0, x2: 50, y2: 0 };
    const result = findMatchingEdge2D(prim, 40, 'front', view, 1e-3, BOX_BBOX);
    expect(result).not.toBeNull();
    expect(result?.id).toBe('e-horiz');
  });
});

// ---------------------------------------------------------------------------
// HS-MATCH-2: vertical line primitive → matches vertical edge using cachedBoundingBox
// ---------------------------------------------------------------------------

describe('findMatchingEdge2D — HS-MATCH-2: vertical line with cachedBoundingBox', () => {
  it('returns matching Edge2D for a vertical line primitive using provided BoundingBox', () => {
    // Sketch primitive: vertical line from (0,0) to (0,30) in sketch-local space.
    // BoundingBox [−50,−30,0,50,30,40] → cx=0,cy=0,cz=20
    // Point (0,0,0) → Trecenter → (0,0,−20) → Rorient(front)=identity → projected (0,0).
    // Point (0,30,0) → (0,30,−20) → projected (0,30).
    const edge: Edge2D = {
      id: 'e-vert',
      kind: 'outline',
      points: [[0, 0], [0, 30]],
    };
    const view = makeView([edge]);
    const prim = { id: 'p2', kind: 'line' as const, x1: 0, y1: 0, x2: 0, y2: 30 };
    const result = findMatchingEdge2D(prim, 40, 'front', view, 1e-3, BOX_BBOX);
    expect(result).not.toBeNull();
    expect(result?.id).toBe('e-vert');
  });
});

// ---------------------------------------------------------------------------
// HS-MATCH-3: reversed endpoint order — directionality irrelevant
// ---------------------------------------------------------------------------

describe('findMatchingEdge2D — HS-MATCH-3: reversed endpoint order', () => {
  it('matches edge even when primitive endpoints are reversed relative to edge points', () => {
    // Edge: points [[50, 0], [0, 0]] (end→start order).
    // Primitive: x1=0,y1=0, x2=50,y2=0 (start→end order).
    // Both orderings must match (within tolerance).
    const edge: Edge2D = {
      id: 'e-reversed',
      kind: 'outline',
      points: [[50, 0], [0, 0]],
    };
    const view = makeView([edge]);
    const prim = { id: 'p3', kind: 'line' as const, x1: 0, y1: 0, x2: 50, y2: 0 };
    const result = findMatchingEdge2D(prim, 40, 'front', view, 1e-3, BOX_BBOX);
    expect(result).not.toBeNull();
    expect(result?.id).toBe('e-reversed');
  });
});

// ---------------------------------------------------------------------------
// HS-MATCH-4: two collinear edges → picks the one whose length most closely
//             matches the sketch primitive's length
// ---------------------------------------------------------------------------

describe('findMatchingEdge2D — HS-MATCH-4: two collinear edges, picks closest length', () => {
  it('returns the edge whose total length is closest to the primitive length', () => {
    // Primitive: line from (0,0) to (50,0) — length 50.
    // edgeA (length 50): exactly matches the primitive; endpoints (0,0) and (50,0).
    // edgeB (length 30): polyline (0,0)→(15,0)→(30,0); start=(0,0) and end=(30,0).
    //   edgeB matches the primitive's START endpoint (0,0) but NOT its end (50,0).
    //   So edgeB is not a candidate at all. To make edgeB a genuine candidate with a
    //   different length, we need BOTH endpoints within tolerance of the prim's endpoints.
    //   Strategy: edgeB spans from (0,0) to (50,0) as well (same endpoints) but is a
    //   multi-segment polyline of total length 70 (via detour), while prim length = 50.
    //   edgeA total polyline length = 50 (single segment, exactly matching).
    //   Both edges have the same start=(0,0) and end=(50,0), so both are candidates.
    //   The tie-break is |polylineLength - primLen|: edgeA → |50-50|=0, edgeB → |70-50|=20.
    //   edgeA wins.
    const edgeA: Edge2D = {
      id: 'e-exact',
      kind: 'outline',
      points: [[0, 0], [50, 0]],  // length = 50
    };
    const edgeB: Edge2D = {
      id: 'e-long',
      kind: 'outline',
      // Detour: (0,0)→(25,20)→(50,0). Total length = sqrt(25²+20²)*2 = sqrt(1025)*2 ≈ 64.
      // Both endpoints (0,0) and (50,0) are within 1e-3 of the primitive's endpoints.
      points: [[0, 0], [25, 20], [50, 0]],
    };
    // List edgeB first to confirm length-diff wins over list order
    const view = makeView([edgeB, edgeA]);
    const prim = { id: 'p4', kind: 'line' as const, x1: 0, y1: 0, x2: 50, y2: 0 };
    const result = findMatchingEdge2D(prim, 40, 'front', view, 1e-3, BOX_BBOX);
    expect(result).not.toBeNull();
    // edgeA: |polyLen(50) - primLen(50)| = 0
    // edgeB: |polyLen(~64) - primLen(50)| ≈ 14
    // edgeA wins despite being listed second.
    expect(result?.id).toBe('e-exact');
  });
});

// ---------------------------------------------------------------------------
// HS-MATCH-5: non-line primitive returns null
// ---------------------------------------------------------------------------

describe('findMatchingEdge2D — HS-MATCH-5: non-line primitive returns null', () => {
  it('returns null for a circle primitive', () => {
    const edge: Edge2D = { id: 'e1', kind: 'outline', points: [[0, 0], [50, 0]] };
    const view = makeView([edge]);
    const prim = { id: 'p5', kind: 'circle' as const, cx: 25, cy: 15, r: 20 };
    const result = findMatchingEdge2D(prim, 40, 'front', view, 1e-3, BOX_BBOX);
    expect(result).toBeNull();
  });

  it('returns null for an arc primitive', () => {
    const edge: Edge2D = { id: 'e1', kind: 'outline', points: [[0, 0], [50, 0]] };
    const view = makeView([edge]);
    const prim = { id: 'p6', kind: 'arc' as const, cx: 25, cy: 0, r: 25, startAngle: 0, endAngle: Math.PI };
    const result = findMatchingEdge2D(prim, 40, 'front', view, 1e-3, BOX_BBOX);
    expect(result).toBeNull();
  });

  it('returns null when view has no projection', () => {
    const viewNoProj: BaseView = {
      id: 'v-empty',
      kind: 'base',
      positionMm: { x: 0, y: 0 },
      scale: { numerator: 1, denominator: 1 },
      orientation: 'front',
      showHidden: false,
      // projection absent
    };
    const prim = { id: 'p7', kind: 'line' as const, x1: 0, y1: 0, x2: 50, y2: 0 };
    const result = findMatchingEdge2D(prim, 40, 'front', viewNoProj, 1e-3, BOX_BBOX);
    expect(result).toBeNull();
  });
});
