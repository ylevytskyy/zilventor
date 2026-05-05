// packages/shared/src/drawing/__tests__/clipEdgesToCircle.test.ts
import { describe, it, expect } from 'vitest';
import { clipLineToCircle } from '../clipEdgesToCircle';
import type { Segment } from '../clipEdgesToCircle';

// helper: check that a Segment[] has one element and its coords match expected
function expectSegment(
  result: Segment[],
  p0: [number, number],
  p1: [number, number],
  digits = 6,
): void {
  expect(result).toHaveLength(1);
  expect(result[0]!.p0[0]).toBeCloseTo(p0[0], digits);
  expect(result[0]!.p0[1]).toBeCloseTo(p0[1], digits);
  expect(result[0]!.p1[0]).toBeCloseTo(p1[0], digits);
  expect(result[0]!.p1[1]).toBeCloseTo(p1[1], digits);
}

describe('clipLineToCircle — case 1: both endpoints inside circle', () => {
  it('segment (0,0)→(2,0) fully inside circle radius=5 → returned unchanged', () => {
    // Both points inside: |p0|=0<5, |p1|=2<5
    const result = clipLineToCircle([0, 0], [2, 0], { x: 0, y: 0 }, 5);
    expectSegment(result, [0, 0], [2, 0]);
  });
});

describe('clipLineToCircle — case 3: both outside, chord through circle', () => {
  it('segment (-10,0)→(10,0) cuts circle radius=5 at origin → clipped to (-5,0)→(5,0)', () => {
    // ax=-10, bx=10, A=400, B=-400, C=75, disc=40000, sqrt=200
    // t1=0.25, t2=0.75 → p0=(-10+0.25*20,0)=(-5,0), p1=(-10+0.75*20,0)=(5,0)
    const result = clipLineToCircle([-10, 0], [10, 0], { x: 0, y: 0 }, 5);
    expectSegment(result, [-5, 0], [5, 0]);
  });

  it('segment (-8,-8)→(8,8) diagonal chord through circle radius=5 → clipped segment inside', () => {
    // Distance from origin to line y=x is 0 (line passes through origin).
    // Half-chord length along diagonal = 5 mm.
    // p0=(-8,-8) outside, p1=(8,8) outside. Intersection at ±(5/sqrt(2), 5/sqrt(2)).
    const result = clipLineToCircle([-8, -8], [8, 8], { x: 0, y: 0 }, 5);
    const half = 5 / Math.sqrt(2);
    expectSegment(result, [-half, -half], [half, half]);
  });
});

describe('clipLineToCircle — case 2: both endpoints outside, no chord', () => {
  it('segment (10,0)→(15,0) entirely outside circle radius=5 at origin → []', () => {
    // Both points outside; segment never enters circle.
    // t1=-3, t2=-1 after quadratic; intersection interval (-3,-1) is entirely before t=0.
    const result = clipLineToCircle([10, 0], [15, 0], { x: 0, y: 0 }, 5);
    expect(result).toHaveLength(0);
  });

  it('segment (-20,10)→(20,10) entirely outside circle radius=5 at origin → []', () => {
    // Horizontal line y=10 is above circle of radius 5; no intersection.
    const result = clipLineToCircle([-20, 10], [20, 10], { x: 0, y: 0 }, 5);
    expect(result).toHaveLength(0);
  });
});
