// packages/shared/src/drawing/__tests__/dimensionMath.spec.ts
import { describe, it, expect } from 'vitest';
import { intersectLines } from '../dimensionMath';

describe('intersectLines — HS-MATH-1: perpendicular lines', () => {
  it('returns intersection of horizontal and vertical line', () => {
    const result = intersectLines(
      { p0: { x: 0, y: 5 }, p1: { x: 10, y: 5 } },   // horizontal y=5
      { p0: { x: 3, y: 0 }, p1: { x: 3, y: 10 } },   // vertical x=3
    );
    expect(result).not.toBeNull();
    expect(result!.x).toBeCloseTo(3, 6);
    expect(result!.y).toBeCloseTo(5, 6);
  });
});

describe('intersectLines — HS-MATH-2: parallel lines return null', () => {
  it('returns null for parallel horizontal lines', () => {
    const result = intersectLines(
      { p0: { x: 0, y: 0 }, p1: { x: 10, y: 0 } },
      { p0: { x: 0, y: 5 }, p1: { x: 10, y: 5 } },
    );
    expect(result).toBeNull();
  });
});

describe('intersectLines — HS-MATH-3: diagonal lines', () => {
  it('returns intersection of two diagonal lines', () => {
    // y = x  (p0=(0,0), p1=(1,1))
    // y = -x + 4  (p0=(0,4), p1=(4,0))
    // Intersection: x = 2, y = 2
    const result = intersectLines(
      { p0: { x: 0, y: 0 }, p1: { x: 1, y: 1 } },
      { p0: { x: 0, y: 4 }, p1: { x: 4, y: 0 } },
    );
    expect(result).not.toBeNull();
    expect(result!.x).toBeCloseTo(2, 6);
    expect(result!.y).toBeCloseTo(2, 6);
  });
});

describe('intersectLines — HS-MATH-4: collinear lines return null', () => {
  it('returns null for collinear (same line) inputs', () => {
    const result = intersectLines(
      { p0: { x: 0, y: 0 }, p1: { x: 5, y: 0 } },
      { p0: { x: 1, y: 0 }, p1: { x: 8, y: 0 } },
    );
    expect(result).toBeNull();
  });
});
