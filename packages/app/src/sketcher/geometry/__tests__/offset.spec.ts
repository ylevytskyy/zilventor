import { describe, it, expect } from 'vitest';
import { offsetPrimitive, offsetChain, findChain } from '../offset';
import type { SketchPrimitive } from '@zilventor/shared';

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('offsetPrimitive', () => {
  it('offsets a horizontal line to the left by +d', () => {
    const r = offsetPrimitive({ id: 'l', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 }, 5);
    expect(r!.kind).toBe('line');
    if (r!.kind === 'line') { near(r.x1, 0); near(r.y1, 5); near(r.x2, 10); near(r.y2, 5); }
  });
  it('offsets a circle by increasing radius for +d', () => {
    const r = offsetPrimitive({ id: 'c', kind: 'circle', cx: 0, cy: 0, r: 10 }, 3);
    if (r!.kind === 'circle') near(r.r, 13);
  });
  it('clamps a circle offset that would invert to null', () => {
    const r = offsetPrimitive({ id: 'c', kind: 'circle', cx: 0, cy: 0, r: 10 }, -10);
    expect(r).toBeNull();
  });
  it('offsets an arc by radius, preserving angles', () => {
    const r = offsetPrimitive({ id: 'a', kind: 'arc', cx: 0, cy: 0, r: 10, startAngle: 0, endAngle: 1 }, -4);
    if (r!.kind === 'arc') { near(r.r, 6); near(r.startAngle, 0); near(r.endAngle, 1); }
  });
  it('insets a rectangle for negative d (all sides move inward)', () => {
    const r = offsetPrimitive({ id: 'rc', kind: 'rectangle', x: 0, y: 0, w: 100, h: 60 }, -10);
    if (r!.kind === 'rectangle') { near(r.x, 10); near(r.y, 10); near(r.w, 80); near(r.h, 40); }
  });
  it('returns null for a rectangle inset larger than half its smallest side', () => {
    const r = offsetPrimitive({ id: 'rc', kind: 'rectangle', x: 0, y: 0, w: 100, h: 20 }, -15);
    expect(r).toBeNull();
  });
});

// FALSE-GREEN GUARD: The corner fix-up in offsetChain calls intersect.ts
// internally. Expected coordinates are analytically derived:
// Two parallel horizontal lines sharing an endpoint are offset and then
// their shared corner is miter-joined via the intersection of the offset
// segments. The intersection point is computed analytically here (not
// by running the code first).

describe('findChain', () => {
  it('finds a two-line chain sharing an endpoint (within tolerance)', () => {
    const la: SketchPrimitive = { id: 'la', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 };
    const lb: SketchPrimitive = { id: 'lb', kind: 'line', x1: 10, y1: 0, x2: 10, y2: 10 };
    const lc: SketchPrimitive = { id: 'lc', kind: 'line', x1: 50, y1: 50, x2: 60, y2: 50 };
    const chain = findChain(la, [la, lb, lc]);
    expect(chain.map((p) => p.id)).toContain('la');
    expect(chain.map((p) => p.id)).toContain('lb');
    expect(chain.map((p) => p.id)).not.toContain('lc');
  });

  it('isolated primitive returns chain of length 1', () => {
    const iso: SketchPrimitive = { id: 'iso', kind: 'line', x1: 0, y1: 0, x2: 5, y2: 0 };
    expect(findChain(iso, [iso])).toHaveLength(1);
  });
});

describe('offsetChain — L-shaped chain, two lines', () => {
  // L-shape: la = horizontal (0,0)→(10,0), lb = vertical (10,0)→(10,10).
  // They share endpoint (10,0).
  // Offset d=+2 (left of la = upward, i.e. outside the L).
  //   la offset up: (0,2)→(10,2).
  //   lb offset left: (8,0)→(8,10).
  //   Intersection of (0,2)→(10,2) and (8,0)→(8,10): at (8,2).
  //   So the miter join replaces the corner with (8,2).
  //   Final chain: (0,2)→(8,2), (8,2)→(8,10).
  it('offsets an L-shaped chain and miter-joins the corner', () => {
    const la: SketchPrimitive = { id: 'la', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 };
    const lb: SketchPrimitive = { id: 'lb', kind: 'line', x1: 10, y1: 0, x2: 10, y2: 10 };
    const results = offsetChain([la, lb], 2); // d=+2 = upward for la = outward
    // Should produce 2 offset lines.
    expect(results).toHaveLength(2);
    const lines = results.filter(
      (p): p is Extract<SketchPrimitive, { kind: 'line' }> => p.kind === 'line',
    );
    expect(lines).toHaveLength(2);

    // Sort by starting x to identify la-offset vs lb-offset.
    const sorted = [...lines].sort((a, b) => a.x1 - b.x1);
    const laOff = sorted[0]!; // starts near x=0
    const lbOff = sorted[1]!; // starts near x=8

    // la-offset: y1=y2=2, x1=0.
    expect(laOff.y1).toBeCloseTo(2, 2);
    expect(laOff.y2).toBeCloseTo(2, 2);
    expect(laOff.x1).toBeCloseTo(0, 2);

    // lb-offset: x1=x2=8.
    expect(lbOff.x1).toBeCloseTo(8, 2);
    expect(lbOff.x2).toBeCloseTo(8, 2);

    // Shared miter corner: la-off x2 = lb-off x1y1 = (8,2).
    expect(laOff.x2).toBeCloseTo(8, 2);
    expect(lbOff.y1).toBeCloseTo(2, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NEW TESTS — closed-loop, mid-seed ordering, reverse-directed segment
// ─────────────────────────────────────────────────────────────────────────────

describe('findChain — mid-seed ordering (3-segment open chain)', () => {
  // Chain: LA=(0,0)→(5,0), LB=(5,0)→(10,0), LC=(10,0)→(10,5).
  // Seed from the MIDDLE segment LB.
  // Expected: findChain returns all three in connected order, length 3.
  //
  // Hand-trace:
  //   grow(LB, false) from ep1=(10,0): LC.ep0=(10,0) matches → chain=[LB,LC].
  //   grow(LB, true)  from ep0=(5,0):  LA.ep1=(5,0) matches → chain=[LA,LB,LC].
  it('returns all 3 segments when seeded from the middle', () => {
    const la: SketchPrimitive = { id: 'la', kind: 'line', x1: 0, y1: 0, x2: 5, y2: 0 };
    const lb: SketchPrimitive = { id: 'lb', kind: 'line', x1: 5, y1: 0, x2: 10, y2: 0 };
    const lc: SketchPrimitive = { id: 'lc', kind: 'line', x1: 10, y1: 0, x2: 10, y2: 5 };
    const chain = findChain(lb, [la, lb, lc]);
    expect(chain).toHaveLength(3);
    expect(chain.map((p) => p.id)).toContain('la');
    expect(chain.map((p) => p.id)).toContain('lb');
    expect(chain.map((p) => p.id)).toContain('lc');
    // Connectivity: consecutive segments must share an endpoint.
    const lines = chain as Extract<SketchPrimitive, { kind: 'line' }>[];
    near(lines[0]!.x2, lines[1]!.x1);
    near(lines[0]!.y2, lines[1]!.y1);
    near(lines[1]!.x2, lines[2]!.x1);
    near(lines[1]!.y2, lines[2]!.y1);
  });
});

describe('offsetChain — reverse-directed segment miter', () => {
  // Chain built from: L_fwd=(0,0)→(10,0) and L_rev=(10,10)→(10,0).
  // L_rev is authored in REVERSE — its far endpoint (x2,y2)=(10,0) is the
  // connecting end, not its near endpoint (x1,y1)=(10,10).
  //
  // findChain must normalize L_rev so that chain[0].x2 ≈ chain[1].x1,
  // i.e. L_rev becomes (10,0)→(10,10) before offsetting.
  //
  // After normalization, chain = [(0,0)→(10,0), (10,0)→(10,10)] — same as the
  // existing L-shape test. Offset d=+2 (inward miter corner at (8,2)):
  //   O_fwd = (0,2)→(10,2),  O_rev_norm = (8,0)→(8,10).
  //   Miter intersection of y=2 and x=8 = (8,2).
  //   Final: (0,2)→(8,2) and (8,2)→(8,10).
  it('normalizes a reversed segment and miter-joins at (8,2)', () => {
    const lFwd: SketchPrimitive = { id: 'lf', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 };
    const lRev: SketchPrimitive = { id: 'lr', kind: 'line', x1: 10, y1: 10, x2: 10, y2: 0 };
    // Let findChain discover + normalize lRev.
    const chain = findChain(lFwd, [lFwd, lRev]);
    expect(chain).toHaveLength(2);
    // After normalization the chain must be head-to-tail connected.
    const cl = chain as Extract<SketchPrimitive, { kind: 'line' }>[];
    near(cl[0]!.x2, cl[1]!.x1);
    near(cl[0]!.y2, cl[1]!.y1);

    const results = offsetChain(chain, 2);
    expect(results).toHaveLength(2);
    const offLines = results as Extract<SketchPrimitive, { kind: 'line' }>[];
    // Sort so the horizontal segment is [0] and the vertical is [1].
    const sorted = [...offLines].sort((a, b) => a.x1 - b.x1);
    const horiz = sorted[0]!; // should be (0,2)→(8,2)
    const vert  = sorted[1]!; // should be (8,2)→(8,10)

    // Shared miter corner at (8,2).
    near(horiz.x2, 8); near(horiz.y2, 2);
    near(vert.x1,  8); near(vert.y1,  2);
    // Unmoved endpoints.
    near(horiz.x1, 0); near(horiz.y1, 2);
    near(vert.x2,  8); near(vert.y2,  10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FULL REAL PATH: findChain → offsetChain, closed-loop rectangle
// ─────────────────────────────────────────────────────────────────────────────
//
// Rectangle corners: (0,0),(10,0),(10,10),(0,10).
//
// Segments given in ARBITRARY ORDER with TWO REVERSED:
//   l1: (0,0)→(10,0)    bottom, normal direction
//   l2: (10,10)→(10,0)  right, REVERSED  (canonical: (10,0)→(10,10))
//   l3: (0,10)→(10,10)  top, used as SEED (canonical: (10,10)→(0,10))
//   l4: (0,10)→(0,0)    left, normal direction
//
// findChain(l3, [l1,l2,l3,l4]) must discover and normalize all 4 into a
// head-to-tail loop:  (0,10)→(10,10) → (10,10)→(10,0) → (10,0)→(0,0) → (0,0)→(0,10)
// The loop closes: last.x2,y2=(0,10) ≈ first.x1,y1=(0,10) → isLoop=true.
//
// Offset d=-2 (inward for this CW-wound chain):
//   Normal formula: nx=-dy/len, ny=dx/len.
//   O0=(0,10)→(10,10)  [dx=10,dy=0]:  shift (0,-2)  → (0,8)→(10,8)
//   O1=(10,10)→(10,0)  [dx=0,dy=-10]: shift (-2,0)  → (8,10)→(8,0)
//   O2=(10,0)→(0,0)    [dx=-10,dy=0]: shift (0,+2)  → (10,2)→(0,2)
//   O3=(0,0)→(0,10)    [dx=0,dy=10]:  shift (+2,0)  → (2,0)→(2,10)
//
// Miter intersections (inner rectangle):
//   O0∩O1 → (8,8)   O1∩O2 → (8,2)
//   O2∩O3 → (2,2)   O3∩O0 (closing) → (2,8)    ← the un-tested closing corner
//
describe('findChain → offsetChain — full real path, closed-loop rectangle', () => {
  it('builds chain from arbitrary-order reversed segments then offsets all 4 miter corners', () => {
    // Segments in non-canonical order; l2 and l3 are reversed relative to CCW winding.
    const l1: SketchPrimitive = { id: 'l1', kind: 'line', x1: 0,  y1: 0,  x2: 10, y2: 0  }; // bottom, normal
    const l2: SketchPrimitive = { id: 'l2', kind: 'line', x1: 10, y1: 10, x2: 10, y2: 0  }; // right, REVERSED
    const l3: SketchPrimitive = { id: 'l3', kind: 'line', x1: 0,  y1: 10, x2: 10, y2: 10 }; // top, SEED
    const l4: SketchPrimitive = { id: 'l4', kind: 'line', x1: 0,  y1: 10, x2: 0,  y2: 0  }; // left, normal

    // Step 1: findChain from seed l3 across all 4 segments.
    const chain = findChain(l3, [l1, l2, l3, l4]);

    // Must collect all 4 segments.
    expect(chain).toHaveLength(4);
    expect(chain.map((p) => p.id)).toContain('l1');
    expect(chain.map((p) => p.id)).toContain('l2');
    expect(chain.map((p) => p.id)).toContain('l3');
    expect(chain.map((p) => p.id)).toContain('l4');

    // Connectivity invariant: consecutive segments head-to-tail.
    const cl = chain as Extract<SketchPrimitive, { kind: 'line' }>[];
    for (let i = 0; i < cl.length - 1; i++) {
      near(cl[i]!.x2, cl[i + 1]!.x1);
      near(cl[i]!.y2, cl[i + 1]!.y1);
    }

    // Loop closure invariant: last.x2,y2 ≈ first.x1,y1.
    near(cl[cl.length - 1]!.x2, cl[0]!.x1);
    near(cl[cl.length - 1]!.y2, cl[0]!.y1);

    // Step 2: offsetChain with d=-2 (inward for CW-wound chain).
    const results = offsetChain(chain, -2);
    expect(results).toHaveLength(4);

    // Collect all endpoints.
    const segs = results as Extract<SketchPrimitive, { kind: 'line' }>[];
    const pts = segs.flatMap((s) => [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }]);

    // Hand-derived: every endpoint must be one of the 4 inner-rectangle corners.
    const innerCorners = [
      { x: 2, y: 2 },
      { x: 8, y: 2 },
      { x: 8, y: 8 },
      { x: 2, y: 8 },
    ];
    for (const pt of pts) {
      const matches = innerCorners.some(
        (c) => Math.abs(pt.x - c.x) < 0.01 && Math.abs(pt.y - c.y) < 0.01,
      );
      expect(matches, `point (${pt.x.toFixed(4)},${pt.y.toFixed(4)}) must be an inner-rectangle corner`).toBe(true);
    }

    // Explicitly assert the CLOSING corner (2,8) — the previously untested path.
    // This corner is produced by the closing-loop miter between the last offset segment
    // and the first one; it only fires when isLoop=true inside offsetChain.
    const closingCorner = pts.some(
      (p) => Math.abs(p.x - 2) < 0.01 && Math.abs(p.y - 8) < 0.01,
    );
    expect(closingCorner, 'closing corner (2,8) must appear — proves isLoop fired via findChain path').toBe(true);

    // Also assert the opposite closing corner (2,2) which depends on O2∩O3 miter.
    const corner22 = pts.some(
      (p) => Math.abs(p.x - 2) < 0.01 && Math.abs(p.y - 2) < 0.01,
    );
    expect(corner22, 'corner (2,2) must appear').toBe(true);
  });
});

describe('offsetChain — closed-loop rectangle, inward offset', () => {
  // Rectangle as 4 CCW line segments:
  //   L1: (0,0)→(10,0)   bottom
  //   L2: (10,0)→(10,10) right
  //   L3: (10,10)→(0,10) top
  //   L4: (0,10)→(0,0)   left
  //
  // offsetPrimitive normal: nx=-dy/len, ny=dx/len.
  //   L1: nx=0,ny=1  → O1=(0,2)→(10,2)
  //   L2: nx=-1,ny=0 → O2=(8,0)→(8,10)
  //   L3: nx=0,ny=-1 → O3=(10,8)→(0,8)
  //   L4: nx=1,ny=0  → O4=(2,10)→(2,0)
  //
  // Miter corners (inner rectangle at d=2 inward):
  //   O1∩O2 → (8,2)    O2∩O3 → (8,8)
  //   O3∩O4 → (2,8)    O4∩O1 → (2,2)  ← CLOSING CORNER (the bug path)
  //
  // All 4 output segments must share exactly the 4 inner-rectangle corners.
  it('offsets a closed rectangle inward by d=2 — all 4 miter corners correct', () => {
    const l1: SketchPrimitive = { id: 'l1', kind: 'line', x1: 0,  y1: 0,  x2: 10, y2: 0  };
    const l2: SketchPrimitive = { id: 'l2', kind: 'line', x1: 10, y1: 0,  x2: 10, y2: 10 };
    const l3: SketchPrimitive = { id: 'l3', kind: 'line', x1: 10, y1: 10, x2: 0,  y2: 10 };
    const l4: SketchPrimitive = { id: 'l4', kind: 'line', x1: 0,  y1: 10, x2: 0,  y2: 0  };
    // Pass as an explicit ordered loop (l1→l2→l3→l4, closing back to l1).
    const results = offsetChain([l1, l2, l3, l4], 2);
    expect(results).toHaveLength(4);
    const segs = results as Extract<SketchPrimitive, { kind: 'line' }>[];

    // Collect all 8 endpoints.
    const pts = segs.flatMap((s) => [
      { x: s.x1, y: s.y1 },
      { x: s.x2, y: s.y2 },
    ]);

    // Every endpoint must be one of the 4 inner-rectangle corners.
    const corners = [
      { x: 2, y: 2 },
      { x: 8, y: 2 },
      { x: 8, y: 8 },
      { x: 2, y: 8 },
    ];
    for (const pt of pts) {
      const matchesCorner = corners.some(
        (c) => Math.abs(pt.x - c.x) < 0.01 && Math.abs(pt.y - c.y) < 0.01,
      );
      expect(matchesCorner, `point (${pt.x},${pt.y}) must be an inner-rectangle corner`).toBe(true);
    }

    // Explicitly check the CLOSING corner (O4 far-end and O1 near-end must both be (2,2)).
    // O4 was originally (2,10)→(2,0); after closing-miter its x2,y2 must be (2,2).
    // O1 was originally (0,2)→(10,2); after closing-miter its x1,y1 must be (2,2).
    // We identify O1-offset as the segment whose x1≈0,y1≈2 (before miter) — actually
    // after miter all corners land on the inner rect, so check all.
    const closingCornerPresent = pts.some(
      (p) => Math.abs(p.x - 2) < 0.01 && Math.abs(p.y - 2) < 0.01,
    );
    expect(closingCornerPresent, 'closing corner (2,2) must appear in output').toBe(true);
  });
});
