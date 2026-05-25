// packages/shared/src/drawing/__tests__/clipEdgesToRect.test.ts
import { describe, it, expect } from 'vitest';
import { clipLineToRect, clipPolylineToRect, clipEdgesToRect } from '../clipEdgesToRect';
import type { Segment } from '../clipEdgesToCircle';
import type { Edge2D } from '../projectedGeometry';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Box centered at (cx,cy), full width w, full height h. */
function box(cx: number, cy: number, w: number, h: number) {
  return { center: { x: cx, y: cy }, widthMm: w, heightMm: h };
}

/** Assert exactly one surviving segment with given endpoints (4 decimal places). */
function expectSeg(
  result: Segment[],
  p0: [number, number],
  p1: [number, number],
  digits = 4,
): void {
  expect(result).toHaveLength(1);
  expect(result[0]!.p0[0]).toBeCloseTo(p0[0], digits);
  expect(result[0]!.p0[1]).toBeCloseTo(p0[1], digits);
  expect(result[0]!.p1[0]).toBeCloseTo(p1[0], digits);
  expect(result[0]!.p1[1]).toBeCloseTo(p1[1], digits);
}

// ---------------------------------------------------------------------------
// Case 1 — both endpoints strictly inside the box
// ---------------------------------------------------------------------------

describe('clipLineToRect — Case 1: both endpoints inside → returned unchanged', () => {
  it('segment (2,2)→(4,4) fully inside box centered at (5,5) w=8 h=8 → unchanged', () => {
    // Box: x∈[1,9], y∈[1,9]. Both (2,2) and (4,4) are strictly inside.
    const result = clipLineToRect([2, 2], [4, 4], box(5, 5, 8, 8));
    expectSeg(result, [2, 2], [4, 4]);
  });

  it('horizontal segment (-2,0)→(2,0) fully inside unit-box centered at origin w=10 h=6 → unchanged', () => {
    // Box: x∈[-5,5], y∈[-3,3]. Both points inside.
    const result = clipLineToRect([-2, 0], [2, 0], box(0, 0, 10, 6));
    expectSeg(result, [-2, 0], [2, 0]);
  });
});

// ---------------------------------------------------------------------------
// Case 2 — both endpoints outside, no crossing (entirely miss)
// ---------------------------------------------------------------------------

describe('clipLineToRect — Case 2: both outside, no crossing → []', () => {
  it('segment (20,0)→(30,0) entirely to the right of box x∈[-5,5] → []', () => {
    // Box centered at origin, w=10, h=10: x∈[-5,5], y∈[-5,5].
    // Both endpoints have x=20,30 > 5 → entirely outside right boundary.
    const result = clipLineToRect([20, 0], [30, 0], box(0, 0, 10, 10));
    expect(result).toHaveLength(0);
  });

  it('segment (-20,10)→(20,10) above box y∈[-5,5] (y=10 > yMax=5) → []', () => {
    // Horizontal line y=10 is above box of height 10 centered at origin.
    const result = clipLineToRect([-20, 10], [20, 10], box(0, 0, 10, 10));
    expect(result).toHaveLength(0);
  });

  it('segment (0,-20)→(0,-10) below box y∈[-5,5] → []', () => {
    // Both endpoints have y < -5; segment is below the box.
    const result = clipLineToRect([0, -20], [0, -10], box(0, 0, 10, 10));
    expect(result).toHaveLength(0);
  });

  it('diagonal segment (-20,-20)→(-10,-10) passes below-left corner, never enters box → []', () => {
    // Box: x∈[-5,5], y∈[-5,5]. The segment is entirely in x<-10, y<-10 → misses.
    const result = clipLineToRect([-20, -20], [-10, -10], box(0, 0, 10, 10));
    expect(result).toHaveLength(0);
  });

  it('segment to the left of offset box → []', () => {
    // Box centered at (50,50), w=10, h=10: x∈[45,55], y∈[45,55].
    // Segment (0,50)→(10,50) has x∈[0,10] < 45 → entirely left of box.
    const result = clipLineToRect([0, 50], [10, 50], box(50, 50, 10, 10));
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Case 3 — both endpoints outside, segment crosses the box (enters + exits)
// ---------------------------------------------------------------------------

describe('clipLineToRect — Case 3: both outside, segment crosses box', () => {
  it('horizontal chord (-10,0)→(10,0) through box x∈[-5,5] → clipped to (-5,0)→(5,0)', () => {
    // Box centered at origin, w=10, h=10: x∈[-5,5], y∈[-5,5].
    // Segment enters left boundary at x=-5 (t=0.25), exits right at x=5 (t=0.75).
    // p0=(-10,0), dx=20, dy=0.
    // Left boundary: p=-dx=-20, q=p0.x-xMin=-10-(-5)=-5 → t=(-5)/(-20)=0.25 → tEnter=0.25.
    // Right boundary: p=dx=20, q=xMax-p0.x=5-(-10)=15 → t=15/20=0.75 → tExit=0.75.
    // Surviving: p0+0.25*(20,0)=(-5,0), p0+0.75*(20,0)=(5,0).
    const result = clipLineToRect([-10, 0], [10, 0], box(0, 0, 10, 10));
    expectSeg(result, [-5, 0], [5, 0]);
  });

  it('vertical chord (0,-10)→(0,10) through box y∈[-5,5] → clipped to (0,-5)→(0,5)', () => {
    // Enters bottom at y=-5 (t=0.25), exits top at y=5 (t=0.75).
    const result = clipLineToRect([0, -10], [0, 10], box(0, 0, 10, 10));
    expectSeg(result, [0, -5], [0, 5]);
  });

  it('diagonal chord (-10,-10)→(10,10) through 10×10 box at origin → enters bottom-left, exits top-right', () => {
    // Box: x∈[-5,5], y∈[-5,5]. dx=20, dy=20.
    // Left: p=-20, q=p0.x-(-5)=-10+5=-5 → t=0.25 → tEnter candidate.
    // Right: p=20,  q=5-(-10)=15  → t=0.75 → tExit candidate.
    // Bottom: p=-20, q=p0.y-(-5)=-10+5=-5 → t=0.25 → tEnter max(0.25,0.25)=0.25.
    // Top: p=20,    q=5-(-10)=15  → t=0.75 → tExit min(0.75,0.75)=0.75.
    // Surviving: p0+0.25*(20,20)=(-5,-5), p0+0.75*(20,20)=(5,5).
    const result = clipLineToRect([-10, -10], [10, 10], box(0, 0, 10, 10));
    expectSeg(result, [-5, -5], [5, 5]);
  });

  it('diagonal chord entering left edge, exiting top edge of box at (20,10) w=6 h=4', () => {
    // Box centered at (20,10), w=6, h=4: x∈[17,23], y∈[8,12].
    // Segment: p0=(14,9), p1=(22,13). dx=8, dy=4.
    // Left: p=-8, q=14-17=-3 → t=(-3)/(-8)=0.375 → tEnter=0.375.
    // Right: p=8, q=23-14=9 → t=9/8=1.125 → tExit stays.
    // Bottom: p=-4, q=9-8=1 → t=1/(-4)? No: p[2]=-dy=-4, q=p0.y-yMin=9-8=1 → t=1/(-4)=-0.25 → p<0 tEnter: max(0.375,-0.25)=0.375.
    // Top: p=4, q=12-9=3 → t=3/4=0.75 → tExit=0.75.
    // tEnter=0.375, tExit=0.75. Surviving:
    //   p0=(14+0.375*8, 9+0.375*4)=(17, 10.5)  — on left edge.
    //   p1=(14+0.75*8,  9+0.75*4) =(20, 12)    — on top edge.
    const result = clipLineToRect([14, 9], [22, 13], box(20, 10, 6, 4));
    expectSeg(result, [17, 10.5], [20, 12]);
  });
});

// ---------------------------------------------------------------------------
// Case 4 — one endpoint inside, one outside
// ---------------------------------------------------------------------------

describe('clipLineToRect — Case 4: one endpoint inside, one outside', () => {
  it('p0 inside, p1 outside right: (0,0)→(10,0) box x∈[-5,5] → clipped to (0,0)→(5,0)', () => {
    // Box centered at origin, w=10, h=10. p0=(0,0) inside. p1=(10,0) outside.
    // dx=10, dy=0.
    // Left: p=-10, q=0-(-5)=5 → t=5/(-10)=-0.5 → p<0 → tEnter=max(0,-0.5)=0.
    // Right: p=10,  q=5-0=5   → t=5/10=0.5.  p>0 → tExit=min(1,0.5)=0.5.
    // Bottom/top: parallel, p0 inside → not rejected.
    // tEnter=0, tExit=0.5. Surviving: (0,0)→(5,0).
    const result = clipLineToRect([0, 0], [10, 0], box(0, 0, 10, 10));
    expectSeg(result, [0, 0], [5, 0]);
  });

  it('p0 outside left, p1 inside: (-10,0)→(0,0) box x∈[-5,5] → clipped to (-5,0)→(0,0)', () => {
    // dx=10, dy=0. Left: p=-10, q=-10-(-5)=-5 → t=(-5)/(-10)=0.5. p<0 → tEnter=max(0,0.5)=0.5.
    // Right: p=10, q=5-(-10)=15 → t=1.5. p>0 → tExit=min(1,1.5)=1.
    // Surviving: p0+0.5*(10,0)=(-5,0), p0+1*(10,0)=(0,0).
    const result = clipLineToRect([-10, 0], [0, 0], box(0, 0, 10, 10));
    expectSeg(result, [-5, 0], [0, 0]);
  });

  it('p0 inside, p1 outside top: (0,0)→(0,10) box y∈[-5,5] → clipped to (0,0)→(0,5)', () => {
    // Top: p=dy=10, q=yMax-p0.y=5-0=5 → t=0.5. p>0 → tExit=0.5.
    // Bottom: p[2]=-dy=-10, q=p0.y-yMin=0-(-5)=5 → t=5/(-10)=-0.5 → p<0 → tEnter=max(0,-0.5)=0.
    // Surviving: (0,0)→(0,5).
    const result = clipLineToRect([0, 0], [0, 10], box(0, 0, 10, 10));
    expectSeg(result, [0, 0], [0, 5]);
  });

  it('p0 inside, p1 outside — non-axis-aligned diagonal exit through right boundary', () => {
    // Box centered at (10,10), w=8, h=8: x∈[6,14], y∈[6,14].
    // p0=(10,10) inside, p1=(20,15) outside. dx=10, dy=5.
    // Right: p=10, q=14-10=4 → t=0.4. p>0 → tExit=0.4.
    // Top: p=5, q=14-10=4 → t=0.8. p>0 → tExit=min(0.4,0.8)=0.4.
    // Left: p=-10, q=10-6=4 → t=4/(-10)=-0.4 → p<0 → tEnter=max(0,-0.4)=0.
    // Bottom: p=-5, q=10-6=4 → t=4/(-5)=-0.8 → p<0 → tEnter=0.
    // tEnter=0, tExit=0.4. Surviving: (10,10)→(10+0.4*10, 10+0.4*5)=(14,12).
    const result = clipLineToRect([10, 10], [20, 15], box(10, 10, 8, 8));
    expectSeg(result, [10, 10], [14, 12]);
  });
});

// ---------------------------------------------------------------------------
// Case 5 — segment collinear with (lying on) a box edge
// ---------------------------------------------------------------------------

describe('clipLineToRect — Case 5: collinear with a box edge (grazes)', () => {
  it('segment along left boundary x=-5, y∈[-3,3] inside box h=10 → returns segment', () => {
    // Box centered at origin, w=10, h=10: x∈[-5,5], y∈[-5,5].
    // Segment: (-5,-3)→(-5,3) — lies exactly on x=-5 boundary.
    // p0=(-5,-3), dx=0, dy=6.
    // Left boundary: p=-dx=0, q=p0.x-xMin=-5-(-5)=0. |p|<eps, q=0 >= 0 → not rejected.
    // Right boundary: p=dx=0, q=xMax-p0.x=5-(-5)=10. |p|<eps, q=10 >= 0 → not rejected.
    // Bottom: p=-dy=-6, q=p0.y-yMin=-3-(-5)=2 → t=2/(-6)=-1/3 → p<0 → tEnter=max(0,-1/3)=0.
    // Top: p=dy=6, q=yMax-p0.y=5-(-3)=8 → t=8/6=4/3 → p>0 → tExit=min(1,4/3)=1.
    // tEnter=0, tExit=1 → full segment returned: (-5,-3)→(-5,3).
    const result = clipLineToRect([-5, -3], [-5, 3], box(0, 0, 10, 10));
    expectSeg(result, [-5, -3], [-5, 3]);
  });

  it('segment along right boundary x=5, y∈[-2,2] → returns segment', () => {
    // Symmetric case on the right wall.
    const result = clipLineToRect([5, -2], [5, 2], box(0, 0, 10, 10));
    expectSeg(result, [5, -2], [5, 2]);
  });

  it('segment along top boundary y=5, x∈[-2,2] → returns segment', () => {
    const result = clipLineToRect([-2, 5], [2, 5], box(0, 0, 10, 10));
    expectSeg(result, [-2, 5], [2, 5]);
  });

  it('segment along bottom boundary y=-5, x∈[-1,4] → returns segment', () => {
    const result = clipLineToRect([-1, -5], [4, -5], box(0, 0, 10, 10));
    expectSeg(result, [-1, -5], [4, -5]);
  });

  it('segment along left boundary but entirely outside box y-range → []', () => {
    // Box: x∈[-5,5], y∈[-5,5]. Segment along x=-5, y∈[8,12] → above box.
    // p0=(-5,8), p1=(-5,12). dx=0, dy=4.
    // Left: p=0, q=0 → ok.
    // Right: p=0, q=10 → ok.
    // Bottom: p=-4, q=8-(-5)=13 → t=13/(-4)=-3.25 → p<0 → tEnter=max(0,-3.25)=0.
    // Top: p=4, q=5-8=-3 → t=-3/4=-0.75 → p>0 → tExit=min(1,-0.75)=-0.75.
    // tEnter=0 > tExit=-0.75 → [].
    const result = clipLineToRect([-5, 8], [-5, 12], box(0, 0, 10, 10));
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Case 6 — endpoint exactly on a boundary
// ---------------------------------------------------------------------------

describe('clipLineToRect — Case 6: endpoint exactly on boundary', () => {
  it('p0=(5,0) on right boundary, p1=(0,0) inside → full segment returned', () => {
    // Box: x∈[-5,5], y∈[-5,5]. p0 is on the right edge. p1 is inside.
    // dx=-5, dy=0. Right: p=dx=-5 < 0, q=xMax-p0.x=5-5=0 → t=0/(-5)=0 → p<0 → tEnter=max(0,0)=0.
    // Left: p=-dx=5 > 0, q=p0.x-xMin=5-(-5)=10 → t=2 → p>0 → tExit=min(1,2)=1.
    // Bottom/top: parallel, p0 inside → not rejected. tEnter=0, tExit=1. Full: (5,0)→(0,0).
    const result = clipLineToRect([5, 0], [0, 0], box(0, 0, 10, 10));
    expectSeg(result, [5, 0], [0, 0]);
  });

  it('p0=(0,0) inside, p1=(5,0) on right boundary → full segment returned', () => {
    // The exit point is exactly on the boundary: tExit=1.
    const result = clipLineToRect([0, 0], [5, 0], box(0, 0, 10, 10));
    expectSeg(result, [0, 0], [5, 0]);
  });

  it('p0=(-5,0) on left boundary, p1=(-10,0) outside → [] (zero-length interval at t=0)', () => {
    // p0 is on left boundary. p1 is outside left. The segment moves outward.
    // dx=-5, dy=0. Left: p=-dx=5 > 0, q=p0.x-xMin=-5-(-5)=0 → t=0/5=0 → p>0 → tExit=min(1,0)=0.
    // Right: p=dx=-5 < 0, q=xMax-p0.x=5-(-5)=10 → t=10/(-5)=-2 → p<0 → tEnter=max(0,-2)=0.
    // tEnter=0, tExit=0 → zero-length interval → [].
    const result = clipLineToRect([-5, 0], [-10, 0], box(0, 0, 10, 10));
    expect(result).toHaveLength(0);
  });

  it('p0=(-5,3) on left boundary, p1=(5,3) on right boundary → both on boundary, full segment', () => {
    // Segment: x goes from -5 to 5 at y=3. Box: x∈[-5,5], y∈[-5,5].
    // Both endpoints on boundary. tEnter=0, tExit=1. Full segment returned.
    const result = clipLineToRect([-5, 3], [5, 3], box(0, 0, 10, 10));
    expectSeg(result, [-5, 3], [5, 3]);
  });

  it('corner-to-corner diagonal (-5,-5)→(5,5) — both corners on boundary → full segment', () => {
    // tEnter=0, tExit=1 (both boundary points are exactly at box corners). Full segment.
    const result = clipLineToRect([-5, -5], [5, 5], box(0, 0, 10, 10));
    expectSeg(result, [-5, -5], [5, 5]);
  });
});

// ---------------------------------------------------------------------------
// Case 7 — zero-length segment (point)
// ---------------------------------------------------------------------------

describe('clipLineToRect — Case 7: zero-length segment (p0 === p1)', () => {
  it('p0 = p1 = (0,0) inside box → [] (zero-length discarded)', () => {
    // dx=dy=0. Zero-length guard fires before Liang–Barsky.
    const result = clipLineToRect([0, 0], [0, 0], box(0, 0, 10, 10));
    expect(result).toHaveLength(0);
  });

  it('p0 = p1 = (10,0) outside box → []', () => {
    const result = clipLineToRect([10, 0], [10, 0], box(0, 0, 10, 10));
    expect(result).toHaveLength(0);
  });

  it('nearly-zero segment 1e-10 mm inside box → [] (below length threshold)', () => {
    // dx=1e-10, dy=0. dx*dx + dy*dy = 1e-20 < 1e-10 → zero-length guard fires.
    const result = clipLineToRect([0, 0], [1e-10, 0], box(0, 0, 10, 10));
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Case 8 — segment touching a corner
// ---------------------------------------------------------------------------

describe('clipLineToRect — Case 8: segment through a corner', () => {
  it('segment passing exactly through corner (5,5) from outside to outside → [] (zero-length touch)', () => {
    // p0=(3,7), p1=(7,3). Corner=(5,5) at t=0.5.
    // dx=4, dy=-4. Box x∈[-5,5], y∈[-5,5].
    // p[0]=-dx=-4 < 0, q[0]=p0.x-xMin=3-(-5)=8 → t=8/(-4)=-2 → tEnter=max(0,-2)=0.
    // p[1]=dx=4 > 0, q[1]=xMax-p0.x=5-3=2 → t=2/4=0.5 → tExit=min(1,0.5)=0.5.
    // p[2]=-dy=4 > 0, q[2]=p0.y-yMin=7-(-5)=12 → t=12/4=3 → tExit=min(0.5,3)=0.5.
    // p[3]=dy=-4 < 0, q[3]=yMax-p0.y=5-7=-2 → t=(-2)/(-4)=0.5 → tEnter=max(0,0.5)=0.5.
    // tEnter=0.5, tExit=0.5 → interval=0 < 1e-9 → [].
    const result = clipLineToRect([3, 7], [7, 3], box(0, 0, 10, 10));
    expect(result).toHaveLength(0);
  });

  it('segment entering through a corner and continuing inside → single surviving segment', () => {
    // p0=(7,7) outside top-right corner, p1=(0,0) at center (inside).
    // Box: x∈[-5,5], y∈[-5,5]. dx=-7,dy=-7.
    // p[0]=-dx=7 > 0 → tExit. q[0]=p0.x-xMin=7-(-5)=12 → t=12/7≈1.714 → tExit=min(1,1.714)=1.
    // p[1]=dx=-7 < 0 → tEnter. q[1]=xMax-p0.x=5-7=-2 → t=(-2)/(-7)≈0.286 → tEnter=0.286.
    // p[2]=-dy=7 > 0 → tExit. q[2]=p0.y-yMin=7-(-5)=12 → t=12/7≈1.714 → tExit=min(1,1.714)=1.
    // p[3]=dy=-7 < 0 → tEnter. q[3]=yMax-p0.y=5-7=-2 → t=(-2)/(-7)≈0.286 → tEnter=max(0.286,0.286)=0.286.
    // tEnter=0.286, tExit=1. interval=0.714 > 1e-9.
    // Surviving:
    //   cp0=(7+0.286*(-7), 7+0.286*(-7))=(7-2, 7-2)=(5,5) — corner exactly.
    //   cp1=(7+1*(-7), 7+1*(-7))=(0,0).
    const result = clipLineToRect([7, 7], [0, 0], box(0, 0, 10, 10));
    expectSeg(result, [5, 5], [0, 0]);
  });

  it('segment entirely outside, touching corner at t=0 and continuing outside → []', () => {
    // p0=(5,5) at corner (on boundary), p1=(10,10) outside.
    // dx=5, dy=5.
    // p[0]=-dx=-5 < 0, q[0]=p0.x-xMin=5-(-5)=10 → t=10/(-5)=-2 → tEnter=max(0,-2)=0.
    // p[1]=dx=5 > 0, q[1]=xMax-p0.x=5-5=0 → t=0/5=0 → tExit=min(1,0)=0.
    // tEnter=0, tExit=0 → zero-length → [].
    const result = clipLineToRect([5, 5], [10, 10], box(0, 0, 10, 10));
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// clipPolylineToRect
// ---------------------------------------------------------------------------

describe('clipPolylineToRect', () => {
  it('5-point polyline crossing box → multiple surviving segments', () => {
    // Box: x∈[-5,5], y∈[-5,5].
    // Polyline: (-8,0)→(-2,0)→(0,2)→(2,0)→(8,0).
    // Seg 0: (-8,0)→(-2,0): enters at x=-5 → (-5,0)→(-2,0). 1 seg.
    // Seg 1: (-2,0)→(0,2): both inside (|-2|<5, |0|<5, |2|<5). 1 seg.
    // Seg 2: (0,2)→(2,0): both inside. 1 seg.
    // Seg 3: (2,0)→(8,0): exits at x=5 → (2,0)→(5,0). 1 seg.
    const pts: ReadonlyArray<readonly [number, number]> = [[-8,0],[-2,0],[0,2],[2,0],[8,0]];
    const result = clipPolylineToRect(pts, box(0, 0, 10, 10));
    expect(result).toHaveLength(4);
    expect(result[0]!.p0[0]).toBeCloseTo(-5, 4);
    expect(result[0]!.p0[1]).toBeCloseTo(0, 4);
    expect(result[3]!.p1[0]).toBeCloseTo(5, 4);
    expect(result[3]!.p1[1]).toBeCloseTo(0, 4);
  });

  it('2-point polyline (single segment) fully outside → []', () => {
    const result = clipPolylineToRect([[-10, 0], [-8, 0]], box(0, 0, 10, 10));
    expect(result).toHaveLength(0);
  });

  it('empty polyline → []', () => {
    expect(clipPolylineToRect([], box(0, 0, 10, 10))).toHaveLength(0);
  });

  it('single-point polyline → []', () => {
    expect(clipPolylineToRect([[0, 0]], box(0, 0, 10, 10))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// clipEdgesToRect — id/kind/sourceFaceIds preservation + _clipN suffix
// ---------------------------------------------------------------------------

describe('clipEdgesToRect', () => {
  it('clips edges and preserves kind + sourceFaceIds; appends _clip0, _clip1 to id', () => {
    const edges: Edge2D[] = [
      {
        id: 'e1',
        kind: 'outline',
        points: [[-10, 0], [10, 0]],   // chord through x∈[-5,5]
        sourceFaceIds: ['face-a'],
      },
      {
        id: 'e2',
        kind: 'feature',
        points: [[0, 0], [2, 0]],       // fully inside
        sourceFaceIds: ['face-b'],
      },
    ];
    const result = clipEdgesToRect(edges, box(0, 0, 10, 10));
    // e1: one clipped segment
    expect(result[0]!.id).toBe('e1_clip0');
    expect(result[0]!.kind).toBe('outline');
    expect(result[0]!.sourceFaceIds).toEqual(['face-a']);
    expect(result[0]!.points[0]![0]).toBeCloseTo(-5, 4);
    expect(result[0]!.points[1]![0]).toBeCloseTo(5, 4);
    // e2: one segment (fully inside)
    expect(result[1]!.id).toBe('e2_clip0');
    expect(result[1]!.kind).toBe('feature');
    expect(result[1]!.sourceFaceIds).toEqual(['face-b']);
    expect(result[1]!.points[0]).toEqual([0, 0]);
    expect(result[1]!.points[1]).toEqual([2, 0]);
  });

  it('edge entirely outside box → clipped away (not in result)', () => {
    const edges: Edge2D[] = [
      { id: 'e3', kind: 'silhouette', points: [[20, 0], [30, 0]] },
    ];
    const result = clipEdgesToRect(edges, box(0, 0, 10, 10));
    expect(result).toHaveLength(0);
  });

  it('edge with multiple polyline segments produces multiple output edges with _clip0/_clip1/_clip2', () => {
    // Polyline: (-10,0)→(-2,0)→(2,0)→(10,0) against x∈[-5,5].
    // Seg 0: (-10,0)→(-2,0): enters at (-5,0). 1 clip.
    // Seg 1: (-2,0)→(2,0): fully inside. 1 clip.
    // Seg 2: (2,0)→(10,0): exits at (5,0). 1 clip.
    const edges: Edge2D[] = [
      {
        id: 'e4',
        kind: 'outline',
        points: [[-10, 0], [-2, 0], [2, 0], [10, 0]],
      },
    ];
    const result = clipEdgesToRect(edges, box(0, 0, 10, 10));
    expect(result).toHaveLength(3);
    expect(result[0]!.id).toBe('e4_clip0');
    expect(result[1]!.id).toBe('e4_clip1');
    expect(result[2]!.id).toBe('e4_clip2');
    result.forEach(e => expect(e.kind).toBe('outline'));
  });

  it('edge WITHOUT sourceFaceIds — sourceFaceIds absent in output (exactOptionalPropertyTypes)', () => {
    // With exactOptionalPropertyTypes:true, spreading undefined is a type error.
    // The conditional spread `...(edge.sourceFaceIds !== undefined && { sourceFaceIds: ... })`
    // must omit the key entirely when absent.
    const edges: Edge2D[] = [
      { id: 'e5', kind: 'feature', points: [[0, 0], [1, 0]] },
    ];
    const result = clipEdgesToRect(edges, box(0, 0, 10, 10));
    expect(result).toHaveLength(1);
    expect('sourceFaceIds' in result[0]!).toBe(false);
  });

  it('empty edge array → []', () => {
    expect(clipEdgesToRect([], box(0, 0, 10, 10))).toHaveLength(0);
  });

  it('miss → [] (region entirely misses all edges)', () => {
    const edges: Edge2D[] = [
      { id: 'e6', kind: 'outline', points: [[0, 0], [1, 0]] },
    ];
    const result = clipEdgesToRect(edges, box(100, 100, 10, 10));
    expect(result).toHaveLength(0);
  });
});
