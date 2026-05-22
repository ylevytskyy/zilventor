// packages/shared/src/drawing/__tests__/dimensionMath.spec.ts
import { describe, it, expect } from 'vitest';
import { intersectLines, subtendedAngle, formatAngleDeg } from '../dimensionMath';

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

describe('subtendedAngle — HS-MATH-5: same direction (0°)', () => {
  it('returns insideRad ≈ 0 for identical unit vectors', () => {
    const result = subtendedAngle({ x: 1, y: 0 }, { x: 1, y: 0 });
    expect(result.insideRad).toBeCloseTo(0, 6);
    expect(result.outsideRad).toBeCloseTo(2 * Math.PI, 5);
  });
});

describe('subtendedAngle — HS-MATH-6: perpendicular (90°)', () => {
  it('returns insideRad ≈ π/2 for perpendicular vectors', () => {
    const result = subtendedAngle({ x: 1, y: 0 }, { x: 0, y: 1 });
    expect(result.insideRad).toBeCloseTo(Math.PI / 2, 6);
    expect(result.outsideRad).toBeCloseTo(3 * Math.PI / 2, 6);
  });
});

describe('subtendedAngle — HS-MATH-7: opposite directions (180°)', () => {
  it('returns insideRad ≈ π for anti-parallel vectors', () => {
    const result = subtendedAngle({ x: 1, y: 0 }, { x: -1, y: 0 });
    expect(result.insideRad).toBeCloseTo(Math.PI, 5);
    expect(result.outsideRad).toBeCloseTo(Math.PI, 5);
  });
});

describe('formatAngleDeg — HS-FMT-1: exact integer', () => {
  it('formats π/4 rad as "45°"', () => {
    expect(formatAngleDeg(Math.PI / 4)).toBe('45°');
  });
});

describe('formatAngleDeg — HS-FMT-2: one decimal', () => {
  it('formats 30.5 degrees without trailing zeros', () => {
    expect(formatAngleDeg(30.5 * Math.PI / 180)).toBe('30.5°');
  });
});

describe('formatAngleDeg — HS-FMT-3: three decimal max', () => {
  it('caps at 3 decimals', () => {
    // 1/3 degrees = 0.3333... → trimmed to "0.333°"
    const rad = (1 / 3) * Math.PI / 180;
    const result = formatAngleDeg(rad);
    expect(result).toBe('0.333°');
  });
});

describe('formatAngleDeg — HS-FMT-4: explicit decimals param', () => {
  it('respects explicit decimals=1 override', () => {
    // π/6 = 30.000° → with decimals=1 → "30°"
    expect(formatAngleDeg(Math.PI / 6, 1)).toBe('30°');
  });
});

describe('formatAngleDeg — HS-FMT-5: zero radians', () => {
  it('formats 0 radians as "0°"', () => {
    expect(formatAngleDeg(0)).toBe('0°');
  });
});
