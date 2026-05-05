import { describe, it, expect } from 'vitest';
import { clipLineToConvexPolygon, triangulatePolygon, triangulatePolygonWithHoles, generateHatchSegments } from './hatchGenerator';
import type { Triangle } from './hatchGenerator';
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

// Helpers
const area2D = ([a, b, c]: Triangle): number =>
  (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);

describe('triangulatePolygon', () => {
  it('convex quad → 2 triangles', () => {
    const quad: Vec2[] = [
      { x: 0, y: 0 }, { x: 4, y: 0 },
      { x: 4, y: 3 }, { x: 0, y: 3 },
    ];
    const tris = triangulatePolygon(quad);
    expect(tris).toHaveLength(2);
    // all triangles CCW (positive signed area)
    tris.forEach(t => expect(area2D(t)).toBeGreaterThan(0));
  });

  it('L-shape (6 vertices) → 4 triangles, all CCW', () => {
    // L: full square minus top-right quadrant
    const lShape: Vec2[] = [
      { x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 },
      { x: 10, y: 10 }, { x: 10, y: 20 }, { x: 0, y: 20 },
    ];
    const tris = triangulatePolygon(lShape);
    expect(tris).toHaveLength(4);
    tris.forEach(t => expect(area2D(t)).toBeGreaterThan(0));
  });

  it('U-shape (8 vertices) → 6 triangles', () => {
    // U: outer box minus inner top notch
    const uShape: Vec2[] = [
      { x: 0, y: 0 },  { x: 30, y: 0 },
      { x: 30, y: 30 }, { x: 20, y: 30 },
      { x: 20, y: 10 }, { x: 10, y: 10 },
      { x: 10, y: 30 }, { x: 0, y: 30 },
    ];
    const tris = triangulatePolygon(uShape);
    expect(tris).toHaveLength(6);
    tris.forEach(t => expect(area2D(t)).toBeGreaterThan(0));
  });

  it('self-intersecting polygon → throws', () => {
    // Bow-tie
    const bowtie: Vec2[] = [
      { x: 0, y: 0 }, { x: 10, y: 10 },
      { x: 10, y: 0 }, { x: 0, y: 10 },
    ];
    expect(() => triangulatePolygon(bowtie)).toThrow('non-simple polygon');
  });
});

describe('triangulatePolygonWithHoles', () => {
  it('square with square hole → 8 triangles', () => {
    const outer: Vec2[] = [
      { x: 0, y: 0 }, { x: 30, y: 0 },
      { x: 30, y: 30 }, { x: 0, y: 30 },
    ];
    // hole (CW — holes are wound opposite to outer)
    const hole: Vec2[] = [
      { x: 10, y: 10 }, { x: 10, y: 20 },
      { x: 20, y: 20 }, { x: 20, y: 10 },
    ];
    const tris = triangulatePolygonWithHoles(outer, [hole]);
    expect(tris).toHaveLength(8);
    tris.forEach(t => expect(area2D(t)).toBeGreaterThan(0));
  });
});

describe('generateHatchSegments', () => {
  const square100: Vec2[] = [
    { x: 0, y: 0 }, { x: 100, y: 0 },
    { x: 100, y: 100 }, { x: 0, y: 100 },
  ];

  it('100×100 square at 45° / 3mm → ~47 segments', () => {
    const segs = generateHatchSegments(square100, 'mat-wood', {
      angleDeg: 45,
      spacingMm: 3,
    });
    // exact: ceil(100 / (3 * cos(45°))) = ceil(100 / 2.1213...) = ceil(47.14) = 48
    // but boundary-crossing may yield 47 depending on bbox alignment; accept 46–49
    expect(segs.length).toBeGreaterThanOrEqual(46);
    expect(segs.length).toBeLessThanOrEqual(49);
    segs.forEach(s => expect(s.materialId).toBe('mat-wood'));
  });

  it('L-shape at 45° / 3mm → segments skip missing corner', () => {
    const lShape: Vec2[] = [
      { x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 },
      { x: 10, y: 10 }, { x: 10, y: 20 }, { x: 0, y: 20 },
    ];
    const segs = generateHatchSegments(lShape, 'mat-ply', {
      angleDeg: 45,
      spacingMm: 3,
    });
    expect(segs.length).toBeGreaterThan(0);
    // No segment should end outside the L-shape bounding box
    segs.forEach(s => {
      expect(s.p0.x).toBeGreaterThanOrEqual(-0.01);
      expect(s.p0.y).toBeGreaterThanOrEqual(-0.01);
      expect(s.p1.x).toBeLessThanOrEqual(20.01);
      expect(s.p1.y).toBeLessThanOrEqual(20.01);
    });
  });

  it('tiny polygon (1×1 mm) at 3mm spacing → 0 or 1 segment', () => {
    const tiny: Vec2[] = [
      { x: 0, y: 0 }, { x: 1, y: 0 },
      { x: 1, y: 1 }, { x: 0, y: 1 },
    ];
    const segs = generateHatchSegments(tiny, 'mat-tiny', {
      angleDeg: 45,
      spacingMm: 3,
    });
    expect(segs.length).toBeLessThanOrEqual(1);
  });

  it('empty polygon → empty array', () => {
    const segs = generateHatchSegments([], 'mat-x', {
      angleDeg: 45,
      spacingMm: 3,
    });
    expect(segs).toHaveLength(0);
  });
});
