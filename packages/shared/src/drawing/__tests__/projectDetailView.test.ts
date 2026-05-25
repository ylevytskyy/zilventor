// packages/shared/src/drawing/__tests__/projectDetailView.test.ts
import { describe, it, expect } from 'vitest';
import { projectDetailView } from '../projectDetailView';
import type { DetailViewInput } from '../projectDetailView';

describe('projectDetailView — edge cases', () => {
  it('region entirely outside parent edges → empty visibleEdges, zero bbox', () => {
    // Parent has one edge near (0,0); region center is at (100,100), far away.
    const input: DetailViewInput = {
      parentView: {
        id: 'parent-v1',
        kind: 'base',
        positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 1 },
        showHidden: false,
        projection: {
          visibleEdges: [
            { id: 'e1', kind: 'outline', points: [[0, 0], [10, 0]] },
          ],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 10, maxY: 0 },
        },
      } as any,
      regionParent: { kind: 'circle', center: { x: 100, y: 100 }, radiusMm: 5 },
      detailScale: { numerator: 2, denominator: 1 },
      showHidden: false,
    };

    const output = projectDetailView(input);

    expect(output.visibleEdges).toHaveLength(0);
    expect(output.hiddenEdges).toHaveLength(0);
    // bbox collapses to zero when no edges
    expect(output.bbox).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });
});

describe('projectDetailView — full enclosure and hidden edges', () => {
  it('region fully encloses parent edges → all edges survive, correctly scaled', () => {
    // Parent has a 10×10 box of edges; region is a circle radius=100 centered at (5,5).
    // All edges are inside the circle, so no clipping loss.
    // detailScale=1:1, parentScale=1:1 → detailScaleFactor=1.
    // After translate by -(5,5): edge points shift by (-5,-5).
    const input: DetailViewInput = {
      parentView: {
        id: 'parent-v1',
        kind: 'base',
        positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 1 },
        showHidden: false,
        projection: {
          visibleEdges: [
            { id: 'e1', kind: 'outline', points: [[0, 0], [10, 0]] },
            { id: 'e2', kind: 'outline', points: [[10, 0], [10, 10]] },
            { id: 'e3', kind: 'outline', points: [[10, 10], [0, 10]] },
            { id: 'e4', kind: 'outline', points: [[0, 10], [0, 0]] },
          ],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
        },
      } as any,
      regionParent: { kind: 'circle', center: { x: 5, y: 5 }, radiusMm: 100 },
      detailScale: { numerator: 1, denominator: 1 },
      showHidden: false,
    };

    const output = projectDetailView(input);

    // 4 edges each produce 1 clip segment (all inside huge circle) → 4 edges
    expect(output.visibleEdges).toHaveLength(4);

    // After translate by -(5,5) and scale×1: (0,0)→(-5,-5), (10,0)→(5,-5), etc.
    // Find the edge that started as e1 (0,0)→(10,0):
    const e1 = output.visibleEdges.find(e => e.id === 'e1_clip0');
    expect(e1).toBeDefined();
    expect(e1!.points[0]![0]).toBeCloseTo(-5, 4);
    expect(e1!.points[0]![1]).toBeCloseTo(-5, 4);
    expect(e1!.points[1]![0]).toBeCloseTo(5, 4);
    expect(e1!.points[1]![1]).toBeCloseTo(-5, 4);
  });

  it('showHidden=true → hidden edges included in output', () => {
    const input: DetailViewInput = {
      parentView: {
        id: 'parent-v1',
        kind: 'base',
        positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 1 },
        showHidden: true,
        projection: {
          visibleEdges: [
            { id: 'ev1', kind: 'outline', points: [[0, 0], [4, 0]] },
          ],
          hiddenEdges: [
            { id: 'eh1', kind: 'feature', points: [[0, 0], [2, 0]] },
          ],
          bbox: { minX: 0, minY: 0, maxX: 4, maxY: 0 },
        },
      } as any,
      regionParent: { kind: 'circle', center: { x: 0, y: 0 }, radiusMm: 10 },
      detailScale: { numerator: 1, denominator: 1 },
      showHidden: true,
    };

    const output = projectDetailView(input);

    expect(output.visibleEdges.length).toBeGreaterThan(0);
    expect(output.hiddenEdges.length).toBeGreaterThan(0);
  });

  it('showHidden=false → hiddenEdges is empty in output regardless of parent', () => {
    const input: DetailViewInput = {
      parentView: {
        id: 'parent-v1',
        kind: 'base',
        positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 1 },
        showHidden: true,
        projection: {
          visibleEdges: [],
          hiddenEdges: [
            { id: 'eh1', kind: 'feature', points: [[0, 0], [2, 0]] },
          ],
          bbox: { minX: 0, minY: 0, maxX: 2, maxY: 0 },
        },
      } as any,
      regionParent: { kind: 'circle', center: { x: 0, y: 0 }, radiusMm: 10 },
      detailScale: { numerator: 1, denominator: 1 },
      showHidden: false,
    };

    const output = projectDetailView(input);

    expect(output.hiddenEdges).toHaveLength(0);
  });
});

// Spec §4.5 worked example:
// Parent scale 1:5, region center (10,8), radiusMm=5, detail scale 2:1
// detailScaleFactor = (2/1) / (1/5) = 10
// A point at (12,9) in parent-local → translate to (2,1) → scale to (20,10).

describe('projectDetailView — §4.5 worked example', () => {
  it('point (12,9) in parent-local → (20,10) in detail-local', () => {
    // Single visible edge: a line segment inside the region.
    // Both (12,9) and (11,8) are inside the circle: |(12-10,9-8)|=|(2,1)|=2.24<5 ✓
    const input: DetailViewInput = {
      parentView: {
        id: 'parent-v1',
        kind: 'base',
        positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 5 },
        showHidden: false,
        projection: {
          visibleEdges: [
            {
              id: 'e1',
              kind: 'outline',
              points: [[11, 8], [12, 9]],  // fully inside region
            },
          ],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 50, maxY: 50 },
        },
      } as any,
      regionParent: { kind: 'circle', center: { x: 10, y: 8 }, radiusMm: 5 },
      detailScale: { numerator: 2, denominator: 1 },
      showHidden: false,
    };

    const output = projectDetailView(input);

    expect(output.visibleEdges).toHaveLength(1);
    // Translate (11,8)→(10,8) subtracts center (10,8) → (1,0). Scale ×10 → (10,0).
    expect(output.visibleEdges[0]!.points[0]![0]).toBeCloseTo(10, 4);
    expect(output.visibleEdges[0]!.points[0]![1]).toBeCloseTo(0, 4);
    // Translate (12,9)→(10,8) → (2,1). Scale ×10 → (20,10).
    expect(output.visibleEdges[0]!.points[1]![0]).toBeCloseTo(20, 4);
    expect(output.visibleEdges[0]!.points[1]![1]).toBeCloseTo(10, 4);
  });

  it('bbox is recomputed from detail-local points', () => {
    const input: DetailViewInput = {
      parentView: {
        id: 'parent-v1',
        kind: 'base',
        positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 5 },
        showHidden: false,
        projection: {
          visibleEdges: [
            {
              id: 'e1',
              kind: 'outline',
              points: [[11, 8], [12, 9]],
            },
          ],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 50, maxY: 50 },
        },
      } as any,
      regionParent: { kind: 'circle', center: { x: 10, y: 8 }, radiusMm: 5 },
      detailScale: { numerator: 2, denominator: 1 },
      showHidden: false,
    };

    const output = projectDetailView(input);

    // After transform: points are (10,0) and (20,10).
    expect(output.bbox.minX).toBeCloseTo(10, 4);
    expect(output.bbox.minY).toBeCloseTo(0, 4);
    expect(output.bbox.maxX).toBeCloseTo(20, 4);
    expect(output.bbox.maxY).toBeCloseTo(10, 4);
  });
});

// ---------------------------------------------------------------------------
// projectDetailView — rect branch
// ---------------------------------------------------------------------------

describe('projectDetailView — rect region: clip → translate → scale → bbox', () => {
  it('rect region fully enclosing all edges — all edges survive, correctly scaled', () => {
    // Rect 20×20 centered at (5,5): x∈[-5,15], y∈[-5,15]. Edges all inside.
    // detailScale=1:1, parentScale=1:1 → factor=1.
    // Translate by -(5,5): (0,0)→(-5,-5), (10,0)→(5,-5), etc.
    const input: DetailViewInput = {
      parentView: {
        id: 'pv1',
        kind: 'base',
        positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 1 },
        showHidden: false,
        projection: {
          visibleEdges: [
            { id: 'e1', kind: 'outline', points: [[0, 0], [10, 0]] },
            { id: 'e2', kind: 'outline', points: [[10, 0], [10, 10]] },
          ],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
        },
      } as any,
      regionParent: { kind: 'rect', center: { x: 5, y: 5 }, widthMm: 20, heightMm: 20 },
      detailScale: { numerator: 1, denominator: 1 },
      showHidden: false,
    };

    const output = projectDetailView(input);

    expect(output.visibleEdges).toHaveLength(2);
    // e1: (0,0)→(10,0) fully inside, translate -(5,5) → (-5,-5)→(5,-5).
    const e1 = output.visibleEdges.find(e => e.id === 'e1_clip0');
    expect(e1).toBeDefined();
    expect(e1!.points[0]![0]).toBeCloseTo(-5, 4);
    expect(e1!.points[0]![1]).toBeCloseTo(-5, 4);
    expect(e1!.points[1]![0]).toBeCloseTo(5, 4);
    expect(e1!.points[1]![1]).toBeCloseTo(-5, 4);
  });

  it('rect region clips a crossing edge — clipped and translated correctly', () => {
    // Rect 4×4 centered at (0,0): x∈[-2,2], y∈[-2,2].
    // Edge: (-10,0)→(10,0) — chord. Clipped to (-2,0)→(2,0).
    // detailScale=2:1, parentScale=1:1 → factor=2.
    // Translate by (0,0) → same. Scale×2: (-4,0)→(4,0).
    const input: DetailViewInput = {
      parentView: {
        id: 'pv1',
        kind: 'base',
        positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 1 },
        showHidden: false,
        projection: {
          visibleEdges: [{ id: 'ex', kind: 'outline', points: [[-10, 0], [10, 0]] }],
          hiddenEdges: [],
          bbox: { minX: -10, minY: 0, maxX: 10, maxY: 0 },
        },
      } as any,
      regionParent: { kind: 'rect', center: { x: 0, y: 0 }, widthMm: 4, heightMm: 4 },
      detailScale: { numerator: 2, denominator: 1 },
      showHidden: false,
    };

    const output = projectDetailView(input);

    expect(output.visibleEdges).toHaveLength(1);
    expect(output.visibleEdges[0]!.id).toBe('ex_clip0');
    expect(output.visibleEdges[0]!.points[0]![0]).toBeCloseTo(-4, 4); // (-2)*2
    expect(output.visibleEdges[0]!.points[1]![0]).toBeCloseTo(4, 4);  // (2)*2
  });

  it('rect region entirely missing all edges → empty visibleEdges, zero bbox', () => {
    const input: DetailViewInput = {
      parentView: {
        id: 'pv1',
        kind: 'base',
        positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 1 },
        showHidden: false,
        projection: {
          visibleEdges: [{ id: 'e1', kind: 'outline', points: [[0, 0], [5, 0]] }],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 5, maxY: 0 },
        },
      } as any,
      regionParent: { kind: 'rect', center: { x: 100, y: 100 }, widthMm: 4, heightMm: 4 },
      detailScale: { numerator: 2, denominator: 1 },
      showHidden: false,
    };

    const output = projectDetailView(input);

    expect(output.visibleEdges).toHaveLength(0);
    expect(output.bbox).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });

  it('rect region with showHidden=true — hidden edges clipped and returned', () => {
    const input: DetailViewInput = {
      parentView: {
        id: 'pv1',
        kind: 'base',
        positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 1 },
        showHidden: true,
        projection: {
          visibleEdges: [{ id: 'ev1', kind: 'outline', points: [[0, 0], [1, 0]] }],
          hiddenEdges: [{ id: 'eh1', kind: 'feature', points: [[-1, 0], [0, 0]] }],
          bbox: { minX: -1, minY: 0, maxX: 1, maxY: 0 },
        },
      } as any,
      regionParent: { kind: 'rect', center: { x: 0, y: 0 }, widthMm: 10, heightMm: 10 },
      detailScale: { numerator: 1, denominator: 1 },
      showHidden: true,
    };

    const output = projectDetailView(input);

    expect(output.visibleEdges.length).toBeGreaterThan(0);
    expect(output.hiddenEdges.length).toBeGreaterThan(0);
  });

  it('rect: bbox is computed from detail-local (post-translate, post-scale) points', () => {
    // Rect 4×4 at (10,8): x∈[8,12], y∈[6,10]. Edge inside: (9,7)→(11,9).
    // detailScale=2:1, parentScale=1:1 → factor=2.
    // Translate -(10,8): (9,7)→(-1,-1), (11,9)→(1,1). Scale×2: (-2,-2)→(2,2).
    const input: DetailViewInput = {
      parentView: {
        id: 'pv1',
        kind: 'base',
        positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 1 },
        showHidden: false,
        projection: {
          visibleEdges: [{ id: 'e1', kind: 'outline', points: [[9, 7], [11, 9]] }],
          hiddenEdges: [],
          bbox: { minX: 9, minY: 7, maxX: 11, maxY: 9 },
        },
      } as any,
      regionParent: { kind: 'rect', center: { x: 10, y: 8 }, widthMm: 4, heightMm: 4 },
      detailScale: { numerator: 2, denominator: 1 },
      showHidden: false,
    };

    const output = projectDetailView(input);

    expect(output.bbox.minX).toBeCloseTo(-2, 4);
    expect(output.bbox.minY).toBeCloseTo(-2, 4);
    expect(output.bbox.maxX).toBeCloseTo(2, 4);
    expect(output.bbox.maxY).toBeCloseTo(2, 4);
  });
});

describe('projectDetailView — circle branch still works after dispatch refactor', () => {
  it('circle region with existing test shape still passes (regression)', () => {
    // Verbatim copy of the §4.5 worked example test, but now with explicit kind:'circle'.
    const input: DetailViewInput = {
      parentView: {
        id: 'pv1',
        kind: 'base',
        positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 5 },
        showHidden: false,
        projection: {
          visibleEdges: [{ id: 'e1', kind: 'outline', points: [[11, 8], [12, 9]] }],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 50, maxY: 50 },
        },
      } as any,
      regionParent: { kind: 'circle', center: { x: 10, y: 8 }, radiusMm: 5 },
      detailScale: { numerator: 2, denominator: 1 },
      showHidden: false,
    };

    const output = projectDetailView(input);

    expect(output.visibleEdges).toHaveLength(1);
    expect(output.visibleEdges[0]!.points[1]![0]).toBeCloseTo(20, 4);
    expect(output.visibleEdges[0]!.points[1]![1]).toBeCloseTo(10, 4);
  });
});
