import { describe, it, expect } from 'vitest';
import { layoutCombinedGrid } from '../layoutCombinedGrid';

describe('layoutCombinedGrid', () => {
  it('returns [] for an empty item list', () => {
    expect(layoutCombinedGrid([], 50)).toEqual([]);
  });

  it('places a single item at the origin', () => {
    expect(layoutCombinedGrid([{ width: 100, height: 200 }], 50)).toEqual([{ x: 0, y: 0 }]);
  });

  it('wraps 4 equal items into 2 columns x 2 rows', () => {
    const items = [
      { width: 100, height: 100 },
      { width: 100, height: 100 },
      { width: 100, height: 100 },
      { width: 100, height: 100 },
    ];
    const pos = layoutCombinedGrid(items, 10);
    // cols = ceil(sqrt(4)) = 2
    expect(pos[0]).toEqual({ x: 0, y: 0 });
    expect(pos[1]).toEqual({ x: 110, y: 0 }); // col advance = width + gutter
    expect(pos[2]).toEqual({ x: 0, y: 110 }); // row advance = rowMaxHeight + gutter
    expect(pos[3]).toEqual({ x: 110, y: 110 });
  });

  it('advances rows by the MAX height seen in that row, not the last item', () => {
    const items = [
      { width: 50, height: 300 }, // tall item in row 1
      { width: 50, height: 50 },
      { width: 50, height: 50 }, // starts row 2 (cols = ceil(sqrt(3)) = 2)
    ];
    const pos = layoutCombinedGrid(items, 20);
    expect(pos[0]).toEqual({ x: 0, y: 0 });
    expect(pos[1]).toEqual({ x: 70, y: 0 });
    // row 1 max height = 300 -> row 2 starts at y = 300 + gutter(20) = 320
    expect(pos[2]).toEqual({ x: 0, y: 320 });
  });

  it('respects the gutter for both column and row advance', () => {
    const items = [
      { width: 10, height: 10 },
      { width: 20, height: 20 },
    ];
    const pos = layoutCombinedGrid(items, 5);
    // cols = ceil(sqrt(2)) = 2 -> both items on one row
    expect(pos[0]).toEqual({ x: 0, y: 0 });
    expect(pos[1]).toEqual({ x: 15, y: 0 }); // 10 + gutter(5)
  });

  it('grows rows monotonically along +Y (documented growth direction)', () => {
    const items = [
      { width: 10, height: 10 },
      { width: 10, height: 10 },
      { width: 10, height: 10 },
    ];
    // cols = ceil(sqrt(3)) = 2 -> row 2 has 1 item
    const pos = layoutCombinedGrid(items, 5);
    expect(pos[2]!.y).toBeGreaterThan(pos[0]!.y);
  });
});
