// packages/shared/src/nesting/__tests__/mergeFreeRects.spec.ts
import { describe, it, expect } from 'vitest';
import { mergeFreeRects } from '../packGuillotine';

describe('mergeFreeRects', () => {
  it('merges two stacked rects of the same width into one taller rect', () => {
    // Same x/w, vertically contiguous (top.y + top.h === bottom.y).
    const rects = [
      { x: 0, y: 0, w: 300, h: 200 },
      { x: 0, y: 200, w: 300, h: 150 },
    ];
    expect(mergeFreeRects(rects)).toEqual([{ x: 0, y: 0, w: 300, h: 350 }]);
  });

  it('merges two side-by-side rects of the same height into one wider rect', () => {
    // Same y/h, horizontally contiguous (left.x + left.w === right.x).
    const rects = [
      { x: 0, y: 0, w: 300, h: 400 },
      { x: 300, y: 0, w: 500, h: 400 },
    ];
    expect(mergeFreeRects(rects)).toEqual([{ x: 0, y: 0, w: 800, h: 400 }]);
  });

  it('does not merge an L-shaped pair (adjacent edge but mismatched widths)', () => {
    // Vertically adjacent (top.y + top.h === bottom.y) but widths differ (400 vs 600) —
    // merging would produce a non-rectangular union, so it must stay 2 rects.
    const rects = [
      { x: 0, y: 0, w: 400, h: 300 },
      { x: 0, y: 300, w: 600, h: 300 },
    ];
    expect(mergeFreeRects(rects)).toEqual(rects);
  });

  it('fixpoint: merges a chain of 3 rects regardless of pairwise discovery order', () => {
    // Rect1+Rect2 merge vertically first (same x/w) into (0,0,300,350); that merged
    // rect then merges horizontally with Rect3 (same y/h=0/350, adjacent x=300).
    // A single non-iterating pass over the original 3 could miss the second merge.
    const rects = [
      { x: 0, y: 0, w: 300, h: 200 },
      { x: 0, y: 200, w: 300, h: 150 },
      { x: 300, y: 0, w: 200, h: 350 },
    ];
    expect(mergeFreeRects(rects)).toEqual([{ x: 0, y: 0, w: 500, h: 350 }]);
  });

  it('does not merge rects separated by a kerf-sized gap (not physically contiguous)', () => {
    // Same x/w, "vertically adjacent" except for a 3mm gap — this is what two free
    // rects carved on either side of an actual saw kerf look like. Must NOT merge.
    const rects = [
      { x: 0, y: 0, w: 300, h: 200 },
      { x: 0, y: 203, w: 300, h: 150 }, // 3mm gap (kerf) below the first rect
    ];
    expect(mergeFreeRects(rects)).toEqual(rects);
  });

  it('returns a single rect unchanged', () => {
    const rects = [{ x: 10, y: 20, w: 30, h: 40 }];
    expect(mergeFreeRects(rects)).toEqual(rects);
  });

  it('returns an empty list unchanged', () => {
    expect(mergeFreeRects([])).toEqual([]);
  });
});
