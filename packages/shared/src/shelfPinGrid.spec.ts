import { describe, it, expect } from 'vitest';
import { columnPositions } from './shelfPinGrid';

describe('columnPositions — centered system-32 ladder', () => {
  it('steps at exactly `pitch` between consecutive holes', () => {
    const xs = columnPositions(64, 656, 32); // span 592 = 18*32 + 16
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i] - xs[i - 1]).toBeCloseTo(32, 9);
    }
  });

  it('centers the run so leading and trailing clearances are equal', () => {
    const start = 64, end = 656, pitch = 32;
    const xs = columnPositions(start, end, pitch);
    const leading = xs[0] - start;
    const trailing = end - xs[xs.length - 1];
    expect(leading).toBeCloseTo(trailing, 9);
  });

  it('keeps every hole inside [start, end]', () => {
    const start = 64, end = 656, pitch = 32;
    const xs = columnPositions(start, end, pitch);
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(start - 1e-9);
      expect(x).toBeLessThanOrEqual(end + 1e-9);
    }
  });

  it('places exactly floor(span/pitch)+1 holes', () => {
    // span = 656-64 = 592; floor(592/32)=18 → 19 holes
    expect(columnPositions(64, 656, 32)).toHaveLength(19);
  });

  it('returns a single centered hole when span < pitch', () => {
    const xs = columnPositions(100, 120, 32); // span 20 < 32
    expect(xs).toHaveLength(1);
    expect(xs[0]).toBeCloseTo(110, 9); // midpoint of [100,120]
  });

  it('returns a single hole at start when span === 0', () => {
    expect(columnPositions(50, 50, 32)).toEqual([50]);
  });
});
