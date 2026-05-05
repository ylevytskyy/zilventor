import { describe, it, expect } from 'vitest';
import { clipLineToConvexPolygon } from './hatchGenerator';
import type { Vec2 } from './types';

const sq: Vec2[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe('clipLineToConvexPolygon', () => {
  it('line entirely inside square → unchanged', () => {
    const r = clipLineToConvexPolygon(
      { p0: { x: 2, y: 3 }, p1: { x: 8, y: 7 } },
      sq,
    );
    expect(r).not.toBeNull();
    expect(r!.p0).toMatchObject({ x: 2, y: 3 });
    expect(r!.p1).toMatchObject({ x: 8, y: 7 });
  });

  it('line entirely outside square → null', () => {
    const r = clipLineToConvexPolygon(
      { p0: { x: -5, y: 5 }, p1: { x: -1, y: 5 } },
      sq,
    );
    expect(r).toBeNull();
  });

  it('line crossing one edge → trimmed at entry/exit', () => {
    // enters at x=0 (left edge, y=5), exits at x=10 (right edge, y=5)
    const r = clipLineToConvexPolygon(
      { p0: { x: -5, y: 5 }, p1: { x: 15, y: 5 } },
      sq,
    );
    expect(r).not.toBeNull();
    expect(r!.p0.x).toBeCloseTo(0, 6);
    expect(r!.p0.y).toBeCloseTo(5, 6);
    expect(r!.p1.x).toBeCloseTo(10, 6);
    expect(r!.p1.y).toBeCloseTo(5, 6);
  });

  it('line crossing two edges → chord', () => {
    // diagonal from outside NW to outside SE
    const r = clipLineToConvexPolygon(
      { p0: { x: -2, y: -2 }, p1: { x: 12, y: 12 } },
      sq,
    );
    expect(r).not.toBeNull();
    expect(r!.p0.x).toBeCloseTo(0, 6);
    expect(r!.p0.y).toBeCloseTo(0, 6);
    expect(r!.p1.x).toBeCloseTo(10, 6);
    expect(r!.p1.y).toBeCloseTo(10, 6);
  });

  it('line tangent to vertex (degenerate) → null', () => {
    // passes exactly through (0,0) but otherwise outside
    const r = clipLineToConvexPolygon(
      { p0: { x: -5, y: 5 }, p1: { x: 5, y: -5 } },
      sq,
    );
    // intersection length is effectively 0 at vertex → null
    expect(r).toBeNull();
  });
});
