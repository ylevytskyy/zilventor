// packages/shared/src/drawing/__tests__/clipEdgesToCircle.test.ts
import { describe, it, expect } from 'vitest';
import { clipLineToCircle, clipPolylineToCircle } from '../clipEdgesToCircle';
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

describe('clipLineToCircle — case 8: endpoint exactly on circle boundary', () => {
  it('p0=(5,0) on boundary, p1=(0,5) on boundary — full segment on/inside circle → returned', () => {
    // Both on boundary (r=5). C = 25+0-25=0 (p0 on circle). Similarly p1.
    // disc = B^2 - 0 = B^2 >= 0. t1=0, t2=1. tEnter=0, tExit=1. Full segment.
    const result = clipLineToCircle([5, 0], [0, 5], { x: 0, y: 0 }, 5);
    expectSegment(result, [5, 0], [0, 5]);
  });

  it('p0=(5,0) on boundary, p1=(10,0) outside → clipped to zero interval → []', () => {
    // ax=5,ay=0, dx=5,dy=0. A=25, B=2*(5*5)=50, C=25-25=0.
    // disc=2500-0=2500. sqrt=50. t1=(-50-50)/50=-2, t2=(-50+50)/50=0.
    // tEnter=max(-2,0)=0, tExit=min(0,1)=0. interval=0 → [].
    const result = clipLineToCircle([5, 0], [10, 0], { x: 0, y: 0 }, 5);
    expect(result).toHaveLength(0);
  });

  it('p0=(0,0) inside, p1=(5,0) exactly on boundary → clipped to (0,0)→(5,0)', () => {
    // ax=0,ay=0. dx=5,dy=0. A=25, B=0, C=-25. disc=2500. sqrt=50.
    // t1=-1, t2=1. tEnter=0, tExit=1. Full segment.
    const result = clipLineToCircle([0, 0], [5, 0], { x: 0, y: 0 }, 5);
    expectSegment(result, [0, 0], [5, 0]);
  });
});

describe('clipLineToCircle — case 7: axis-aligned through circle center (symmetric split)', () => {
  it('vertical segment (0,-10)→(0,10) through center at origin radius=5 → (0,-5)→(0,5)', () => {
    // ax=0, ay=-10, dx=0, dy=20. A=400, B=2*(0*0+(-10)*20)=-400, C=100-25=75.
    // disc=160000-4*400*75=160000-120000=40000. sqrt=200.
    // t1=0.25, t2=0.75. tEnter=0.25, tExit=0.75.
    // cp0=(0,-10+0.25*20)=(0,-5), cp1=(0,-10+0.75*20)=(0,5). Symmetric. ✓
    const result = clipLineToCircle([0, -10], [0, 10], { x: 0, y: 0 }, 5);
    expectSegment(result, [0, -5], [0, 5]);
  });

  it('horizontal segment (-10,0)→(10,0) through center at (3,0) radius=5 → (-2,0)→(8,0)', () => {
    // Circle center=(3,0). ax=-10-3=-13, ay=0. bx=10-3=7. dx=20,dy=0.
    // A=400, B=2*(-13*20)=-520, C=169-25=144.
    // disc=270400-4*400*144=270400-230400=40000. sqrt=200.
    // t1=(-(-520)-200)/800=320/800=0.4, t2=720/800=0.9.
    // cp0=(-10+0.4*20,0)=(-2,0), cp1=(-10+0.9*20,0)=(8,0). ✓
    const result = clipLineToCircle([-10, 0], [10, 0], { x: 3, y: 0 }, 5);
    expectSegment(result, [-2, 0], [8, 0]);
  });
});

describe('clipLineToCircle — case 6: zero-length segment', () => {
  it('p0 === p1 inside circle → [] (zero-length always discarded per spec)', () => {
    // p0=p1=(0,0), center=(0,0), radius=5. A=0 < 1e-10 → return [].
    const result = clipLineToCircle([0, 0], [0, 0], { x: 0, y: 0 }, 5);
    expect(result).toHaveLength(0);
  });

  it('p0 === p1 outside circle → []', () => {
    const result = clipLineToCircle([10, 0], [10, 0], { x: 0, y: 0 }, 5);
    expect(result).toHaveLength(0);
  });

  it('nearly-zero-length segment (1e-6 mm) → []', () => {
    // A = (1e-6)^2 = 1e-12 < 1e-10 → return []
    const result = clipLineToCircle([0, 0], [1e-6, 0], { x: 0, y: 0 }, 5);
    expect(result).toHaveLength(0);
  });
});

describe('clipLineToCircle — case 5: tangent (disc ≈ 0)', () => {
  it('tangent line touching circle at exactly one point → []', () => {
    // Circle center=(0,0), radius=5. Tangent line: y=5, segment from (-10,5) to (10,5).
    // Distance from center to line = 5 = radius → tangent.
    // ax=-10, ay=5. dx=20,dy=0. A=400, B=2*(-10*20+5*0)=-400, C=100+25-25=100.
    // disc = 160000 - 4*400*100 = 160000-160000 = 0. tEnter=tExit=0.5.
    // interval = 0 → return [].
    const result = clipLineToCircle([-10, 5], [10, 5], { x: 0, y: 0 }, 5);
    expect(result).toHaveLength(0);
  });

  it('tangent line y=-5 (bottom) → []', () => {
    const result = clipLineToCircle([-10, -5], [10, -5], { x: 0, y: 0 }, 5);
    expect(result).toHaveLength(0);
  });
});

describe('clipLineToCircle — case 4: one endpoint inside, one outside', () => {
  it('p0 inside, p1 outside: (0,0)→(10,0) circle radius=5 → clipped to (0,0)→(5,0)', () => {
    // ax=0, A=100, B=0, C=-25, disc=10000, sqrt=100
    // t1=-0.5, t2=0.5 → tEnter=max(-0.5,0)=0, tExit=min(0.5,1)=0.5
    // cp0=(0,0), cp1=(5,0)
    const result = clipLineToCircle([0, 0], [10, 0], { x: 0, y: 0 }, 5);
    expectSegment(result, [0, 0], [5, 0]);
  });

  it('p0 outside, p1 inside: (10,0)→(0,0) circle radius=5 → clipped to (5,0)→(0,0)', () => {
    // ax=10, dx=-10, dy=0. A=100, B=2*(10*-10)=-200, C=100-25=75
    // disc=40000-30000=10000, sqrt=100
    // t1=0.5, t2=1.5 → tEnter=0.5, tExit=1
    // cp0=(10+0.5*-10,0)=(5,0), cp1=(10+1*-10,0)=(0,0)
    const result = clipLineToCircle([10, 0], [0, 0], { x: 0, y: 0 }, 5);
    expectSegment(result, [5, 0], [0, 0]);
  });

  it('p0 inside, p1 outside: non-axis-aligned', () => {
    // circle center=(5,5), radius=3. p0=(5,5) at center (inside). p1=(5,12) outside.
    // After translate: ax=0,ay=0, bx=0,by=7. dx=0,dy=7.
    // A=49, B=0, C=-9. disc=4*49*9=1764. sqrt=42.
    // t1=(-0-42)/98=-0.428, t2=42/98=0.4286
    // tEnter=0, tExit=0.4286. cp0=(5,5), cp1=(5,5+0.4286*7)=(5,8)
    const result = clipLineToCircle([5, 5], [5, 12], { x: 5, y: 5 }, 3);
    expectSegment(result, [5, 5], [5, 8]);
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

describe('clipPolylineToCircle', () => {
  it('5-point polyline crossing circle → multiple surviving segments', () => {
    // Polyline: (-10,0)→(-3,0)→(0,3)→(3,0)→(10,0) in circle radius=5 at origin.
    // Segment 0: (-10,0)→(-3,0): |(-10,0)|=10>5, |(-3,0)|=3<5. One inside.
    //   t for entry: ax=-10,dx=7,dy=0. A=49, B=2*(-10*7)=-140, C=75.
    //   disc=19600-4*49*75=19600-14700=4900. sqrt=70. t1=(140-70)/98=0.714, t2=210/98=2.14
    //   tEnter=0.714, tExit=min(2.14,1)=1. cp0=(-10+0.714*7,0)=(-5,0). cp1=(-3,0). 1 segment.
    // Segment 1: (-3,0)→(0,3): both inside (|(-3,0)|=3<5, |(0,3)|=3<5). 1 segment.
    // Segment 2: (0,3)→(3,0): both inside. 1 segment.
    // Segment 3: (3,0)→(10,0): one inside, one outside.
    //   ax=3,dx=7,dy=0. A=49, B=2*(3*7)=42, C=9-25=-16.
    //   disc=1764+4*49*16=1764+3136=4900. sqrt=70.
    //   t1=(-42-70)/98=-1.14, t2=(-42+70)/98=0.286.
    //   tEnter=0, tExit=0.286. cp0=(3,0), cp1=(3+0.286*7,0)=(5,0). 1 segment.
    // Total: 4 segments.
    const polyline: ReadonlyArray<readonly [number, number]> = [
      [-10, 0], [-3, 0], [0, 3], [3, 0], [10, 0],
    ];
    const result = clipPolylineToCircle(polyline, { x: 0, y: 0 }, 5);
    expect(result).toHaveLength(4);
    // First segment starts at the circle boundary (-5,0) (approximately)
    expect(result[0]!.p0[0]).toBeCloseTo(-5, 4);
    expect(result[0]!.p0[1]).toBeCloseTo(0, 4);
    // Last segment ends at circle boundary (5,0) (approximately)
    expect(result[3]!.p1[0]).toBeCloseTo(5, 4);
    expect(result[3]!.p1[1]).toBeCloseTo(0, 4);
  });

  it('2-point polyline (single segment) fully outside → []', () => {
    const result = clipPolylineToCircle([[-10, 0], [-6, 0]], { x: 0, y: 0 }, 5);
    expect(result).toHaveLength(0);
  });

  it('empty polyline → []', () => {
    const result = clipPolylineToCircle([], { x: 0, y: 0 }, 5);
    expect(result).toHaveLength(0);
  });

  it('single-point polyline → []', () => {
    const result = clipPolylineToCircle([[0, 0]], { x: 0, y: 0 }, 5);
    expect(result).toHaveLength(0);
  });
});
