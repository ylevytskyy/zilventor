// packages/shared/src/drawing/__tests__/autoPlaceCenterMarks.spec.ts
import { describe, it, expect } from 'vitest';
import { autoPlaceCenterMarks } from '../autoPlaceCenterMarks';
import type { ProjectedGeometry, Edge2D } from '../projectedGeometry';
import type { DrawingAnnotation } from '../types';

// Narrow helper: assert a DrawingAnnotation is a center-mark and cast
type CenterMark = Extract<DrawingAnnotation, { kind: 'center-mark' }>;
function asCenterMark(ann: DrawingAnnotation): CenterMark {
  if (ann.kind !== 'center-mark') throw new Error(`expected center-mark, got ${ann.kind}`);
  return ann as CenterMark;
}

// ---------------------------------------------------------------------------
// Helper: generate N equally-spaced points on circle (cx, cy, r) — arc edge.
// ---------------------------------------------------------------------------
function circlePoints(
  cx: number,
  cy: number,
  r: number,
  n: number,
): ReadonlyArray<readonly [number, number]> {
  return Array.from({ length: n }, (_, i) => {
    const θ = (2 * Math.PI * i) / n;
    return [cx + r * Math.cos(θ), cy + r * Math.sin(θ)] as const;
  });
}

function makeArcEdge(id: string, r = 5, n = 16): Edge2D {
  return { id, kind: 'feature', points: circlePoints(0, 0, r, n) };
}

function makeArcEdgeAt(id: string, cx: number, cy: number, r = 5, n = 16): Edge2D {
  return { id, kind: 'feature', points: circlePoints(cx, cy, r, n) };
}

function makeStraightEdge(id: string): Edge2D {
  return { id, kind: 'outline', points: [[0, 0], [10, 0]] as ReadonlyArray<readonly [number, number]> };
}

describe('autoPlaceCenterMarks', () => {
  it('returns exactly 2 center-mark annotations for 2 arc edges at distinct centers + 3 straight edges', () => {
    // Use distinct centers so dedupe does not collapse them.
    const projection: ProjectedGeometry = {
      visibleEdges: [
        makeArcEdgeAt('arc1', 0, 0, 5, 16),
        makeStraightEdge('str1'),
        makeArcEdgeAt('arc2', 20, 0, 3, 12),
        makeStraightEdge('str2'),
        makeStraightEdge('str3'),
      ],
      hiddenEdges: [],
      bbox: { minX: -10, minY: -10, maxX: 30, maxY: 10 },
    };

    const annotations = autoPlaceCenterMarks(projection, 'view-001');

    expect(annotations).toHaveLength(2);
  });

  it('each annotation has kind="center-mark" and the correct viewId', () => {
    const projection: ProjectedGeometry = {
      visibleEdges: [makeArcEdge('arc1'), makeStraightEdge('str1')],
      hiddenEdges: [],
      bbox: { minX: -10, minY: -10, maxX: 10, maxY: 10 },
    };

    const [raw] = autoPlaceCenterMarks(projection, 'view-abc');
    const ann = asCenterMark(raw!);
    expect(ann.kind).toBe('center-mark');
    expect(ann.viewId).toBe('view-abc');
  });

  it('each annotation carries the correct edgeId', () => {
    const projection: ProjectedGeometry = {
      visibleEdges: [
        makeArcEdge('hole-edge-7'),
        makeStraightEdge('str1'),
      ],
      hiddenEdges: [],
      bbox: { minX: -10, minY: -10, maxX: 10, maxY: 10 },
    };

    const [raw] = autoPlaceCenterMarks(projection, 'v1');
    const ann = asCenterMark(raw!);
    expect(ann.edgeId).toBe('hole-edge-7');
  });

  it('annotation ids are deterministic — re-running yields identical ids', () => {
    const projection: ProjectedGeometry = {
      visibleEdges: [makeArcEdge('arc1'), makeArcEdge('arc2', 4, 16)],
      hiddenEdges: [],
      bbox: { minX: -10, minY: -10, maxX: 10, maxY: 10 },
    };

    const first  = autoPlaceCenterMarks(projection, 'view-42');
    const second = autoPlaceCenterMarks(projection, 'view-42');

    expect(first.map(a => a.id)).toEqual(second.map(a => a.id));
  });

  it('annotation id is derived from viewId + edgeId (format: cm-<viewId>-<edgeId>)', () => {
    const projection: ProjectedGeometry = {
      visibleEdges: [makeArcEdge('arcX')],
      hiddenEdges: [],
      bbox: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
    };

    const [ann] = autoPlaceCenterMarks(projection, 'myView');
    expect(ann!.id).toBe('cm-myView-arcX');
  });

  it('ignores hidden edges — arc in hiddenEdges only produces no center-marks', () => {
    const projection: ProjectedGeometry = {
      visibleEdges: [makeStraightEdge('str1')],
      hiddenEdges: [makeArcEdge('hidden-arc')],
      bbox: { minX: -10, minY: -10, maxX: 10, maxY: 10 },
    };

    const annotations = autoPlaceCenterMarks(projection, 'v1');
    expect(annotations).toHaveLength(0);
  });

  it('returns empty array when there are no arc edges', () => {
    const projection: ProjectedGeometry = {
      visibleEdges: [makeStraightEdge('s1'), makeStraightEdge('s2')],
      hiddenEdges: [],
      bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    };

    expect(autoPlaceCenterMarks(projection, 'v1')).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Slice A — dedupe coincident centers
  // ---------------------------------------------------------------------------
  it('dedupes 3 coincident-center arc edges + 1 distinct arc to exactly 2 center-marks, choosing lex-first edgeId per group', () => {
    // 3 arcs at center (10, 20): radii 2, 5, 8 — simulate through-hole concentric circles
    // 1 arc at center (50, 20): radius 5 — a second, distinct hole
    // Expected: exactly 2 annotations; one per distinct center.
    // Deterministic representative: lex-first edgeId in each group.
    //   Group (10,20): 'arc-bot', 'arc-mid', 'arc-top' → lex-first = 'arc-bot'
    //   Group (50,20): 'arc-far' → 'arc-far'
    const projection: ProjectedGeometry = {
      visibleEdges: [
        makeArcEdgeAt('arc-top', 10, 20, 8, 16),  // concentric group center (10,20)
        makeArcEdgeAt('arc-mid', 10, 20, 5, 16),
        makeArcEdgeAt('arc-bot', 10, 20, 2, 16),
        makeArcEdgeAt('arc-far', 50, 20, 5, 16),  // distinct center (50,20)
      ],
      hiddenEdges: [],
      bbox: { minX: 0, minY: 0, maxX: 60, maxY: 40 },
    };

    const annotations = autoPlaceCenterMarks(projection, 'v-dedupe');

    expect(annotations).toHaveLength(2);

    const edgeIds = annotations.map((a) => asCenterMark(a).edgeId).sort();
    expect(edgeIds).toEqual(['arc-bot', 'arc-far']);
  });

  // ---------------------------------------------------------------------------
  // Slice B — distinct centers are NOT over-deduped
  // ---------------------------------------------------------------------------
  it('N arc edges at N distinct centers yields exactly N center-marks (no over-dedupe)', () => {
    // 4 arcs at well-separated distinct centers
    const projection: ProjectedGeometry = {
      visibleEdges: [
        makeArcEdgeAt('h1', 10, 10, 5, 16),
        makeArcEdgeAt('h2', 30, 10, 5, 16),
        makeArcEdgeAt('h3', 10, 30, 5, 16),
        makeArcEdgeAt('h4', 30, 30, 5, 16),
      ],
      hiddenEdges: [],
      bbox: { minX: 0, minY: 0, maxX: 40, maxY: 40 },
    };

    const annotations = autoPlaceCenterMarks(projection, 'v-nodedupe');

    expect(annotations).toHaveLength(4);
    const edgeIds = annotations.map((a) => asCenterMark(a).edgeId).sort();
    expect(edgeIds).toEqual(['h1', 'h2', 'h3', 'h4']);
  });

  // ---------------------------------------------------------------------------
  // Slice C — Kasa dedupe: multiple short arc fragments of the same hole
  //           map to the same center and collapse to one center-mark
  // ---------------------------------------------------------------------------
  it('4 short arc fragments from the same circular hole all dedupe to exactly 1 center-mark', () => {
    // Simulate the depth-buffer edge-classifier splitting a r=5 rim circle (center at
    // (20,20)) into 4 short visible runs of 5 points each at different arc sectors.
    // Each fragment lies on the same circle (cx=20, cy=20, r=5) but spans only ~10°.
    // The Kasa algebraic fit should recover center (20,20) for each fragment;
    // COINCIDENT_TOL_MM dedupe should collapse all 4 to one center-mark.
    function shortArcPoints(
      cx: number, cy: number, r: number,
      startAngle: number, spanAngle: number, n: number,
    ): ReadonlyArray<readonly [number, number]> {
      return Array.from({ length: n }, (_, i) => {
        const θ = startAngle + spanAngle * (i / (n - 1));
        return [cx + r * Math.cos(θ), cy + r * Math.sin(θ)] as const;
      });
    }

    const cx = 20, cy = 20, r = 5;
    const span = Math.PI / 18; // ~10° per fragment
    const fragments: Edge2D[] = [
      { id: 'run_0',  kind: 'outline', points: shortArcPoints(cx, cy, r, 0,          span, 5) },
      { id: 'run_9',  kind: 'outline', points: shortArcPoints(cx, cy, r, Math.PI/2,  span, 5) },
      { id: 'run_18', kind: 'outline', points: shortArcPoints(cx, cy, r, Math.PI,    span, 5) },
      { id: 'run_27', kind: 'outline', points: shortArcPoints(cx, cy, r, 3*Math.PI/2, span, 5) },
    ];

    const projection: ProjectedGeometry = {
      visibleEdges: fragments,
      hiddenEdges: [],
      bbox: { minX: 10, minY: 10, maxX: 30, maxY: 30 },
    };

    const annotations = autoPlaceCenterMarks(projection, 'v-kasa');
    // All 4 fragments lie on the same circle → Kasa maps them all to ~(20,20) → 1 center-mark.
    expect(annotations).toHaveLength(1);
    expect(asCenterMark(annotations[0]!).kind).toBe('center-mark');
    expect(asCenterMark(annotations[0]!).viewId).toBe('v-kasa');
  });

  it('short arc fragments from 2 different holes at distinct centers → 2 center-marks (not over-deduped)', () => {
    // Two separate holes: r=5 at (10,10) and r=5 at (30,30).
    // Two fragments per hole.
    function shortArcPoints(
      cx: number, cy: number, r: number,
      startAngle: number, spanAngle: number, n: number,
    ): ReadonlyArray<readonly [number, number]> {
      return Array.from({ length: n }, (_, i) => {
        const θ = startAngle + spanAngle * (i / (n - 1));
        return [cx + r * Math.cos(θ), cy + r * Math.sin(θ)] as const;
      });
    }
    const span = Math.PI / 18;
    const fragments: Edge2D[] = [
      // Hole A at (10,10)
      { id: 'a_run0', kind: 'outline', points: shortArcPoints(10, 10, 5, 0,         span, 5) },
      { id: 'a_run9', kind: 'outline', points: shortArcPoints(10, 10, 5, Math.PI/2, span, 5) },
      // Hole B at (30,30)
      { id: 'b_run0', kind: 'outline', points: shortArcPoints(30, 30, 5, 0,         span, 5) },
      { id: 'b_run9', kind: 'outline', points: shortArcPoints(30, 30, 5, Math.PI/2, span, 5) },
    ];

    const projection: ProjectedGeometry = {
      visibleEdges: fragments,
      hiddenEdges: [],
      bbox: { minX: 0, minY: 0, maxX: 40, maxY: 40 },
    };

    const annotations = autoPlaceCenterMarks(projection, 'v-two-holes');
    // Two distinct centers → 2 center-marks.
    expect(annotations).toHaveLength(2);
  });
});
