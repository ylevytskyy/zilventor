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
      regionParent: { center: { x: 100, y: 100 }, radiusMm: 5 },
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
      regionParent: { center: { x: 10, y: 8 }, radiusMm: 5 },
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
      regionParent: { center: { x: 10, y: 8 }, radiusMm: 5 },
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
