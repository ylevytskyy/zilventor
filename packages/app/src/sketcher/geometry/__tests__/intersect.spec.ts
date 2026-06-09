import { describe, it, expect } from 'vitest';
import { intersect } from '../intersect';

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 4);

// FALSE-GREEN GUARD: all expected values are derived analytically, not by
// running intersect.ts first and copying its output.

describe('intersect — line-line', () => {
  it('two crossing lines at origin: x-axis and y-axis intersect at (0,0)', () => {
    const la = { id: 'a', kind: 'line' as const, x1: -5, y1: 0, x2: 5, y2: 0 };
    const lb = { id: 'b', kind: 'line' as const, x1: 0, y1: -5, x2: 0, y2: 5 };
    const hits = intersect(la, lb);
    expect(hits).toHaveLength(1);
    near(hits[0]!.x, 0); near(hits[0]!.y, 0);
    near(hits[0]!.tA, 0.5); // midpoint of la
    near(hits[0]!.tB, 0.5); // midpoint of lb
  });

  it('parallel lines produce no hits', () => {
    const la = { id: 'a', kind: 'line' as const, x1: 0, y1: 0, x2: 10, y2: 0 };
    const lb = { id: 'b', kind: 'line' as const, x1: 0, y1: 1, x2: 10, y2: 1 };
    expect(intersect(la, lb)).toHaveLength(0);
  });

  it('non-overlapping collinear extension (T not in [0,1]) produces no hits', () => {
    // la from x=-10 to x=0; lb from x=5 to x=15 — disjoint on x-axis
    const la = { id: 'a', kind: 'line' as const, x1: -10, y1: 0, x2: 0, y2: 0 };
    const lb = { id: 'b', kind: 'line' as const, x1: 5, y1: 0, x2: 15, y2: 0 };
    expect(intersect(la, lb)).toHaveLength(0);
  });

  it('diagonal lines crossing at (5,5)', () => {
    const la = { id: 'a', kind: 'line' as const, x1: 0, y1: 0, x2: 10, y2: 10 };
    const lb = { id: 'b', kind: 'line' as const, x1: 0, y1: 10, x2: 10, y2: 0 };
    const hits = intersect(la, lb);
    expect(hits).toHaveLength(1);
    near(hits[0]!.x, 5); near(hits[0]!.y, 5);
    near(hits[0]!.tA, 0.5); near(hits[0]!.tB, 0.5);
  });
});

describe('intersect — line-circle (symmetric coverage)', () => {
  // Circle centered at origin, r=5.  Horizontal line y=0 through center.
  // Analytic: x = ±5 → tA = 0 (x=-5) and tA = 1 (x=5) when line is x1=-5 to x2=5.
  it('line through circle center hits at both poles (x=±5)', () => {
    const line = { id: 'l', kind: 'line' as const, x1: -5, y1: 0, x2: 5, y2: 0 };
    const circle = { id: 'c', kind: 'circle' as const, cx: 0, cy: 0, r: 5 };
    const hits = intersect(line, circle);
    expect(hits).toHaveLength(2);
    const xs = hits.map((h) => h.x).sort((a, b) => a - b);
    near(xs[0]!, -5); near(xs[1]!, 5);
    hits.forEach((h) => near(h.y, 0));
  });

  it('tangent line (y=5) hits exactly one point', () => {
    const line = { id: 'l', kind: 'line' as const, x1: -5, y1: 5, x2: 5, y2: 5 };
    const circle = { id: 'c', kind: 'circle' as const, cx: 0, cy: 0, r: 5 };
    const hits = intersect(line, circle);
    expect(hits).toHaveLength(1);
    near(hits[0]!.x, 0); near(hits[0]!.y, 5);
  });

  it('line outside circle (y=6) has no hits', () => {
    const line = { id: 'l', kind: 'line' as const, x1: -5, y1: 6, x2: 5, y2: 6 };
    const circle = { id: 'c', kind: 'circle' as const, cx: 0, cy: 0, r: 5 };
    expect(intersect(line, circle)).toHaveLength(0);
  });

  it('circle-line is symmetric with line-circle', () => {
    const line   = { id: 'l', kind: 'line' as const, x1: -5, y1: 0, x2: 5, y2: 0 };
    const circle = { id: 'c', kind: 'circle' as const, cx: 0, cy: 0, r: 5 };
    const fwd = intersect(line, circle);
    const rev = intersect(circle, line);
    expect(fwd).toHaveLength(rev.length);
    fwd.forEach((h, i) => {
      near(h.x, rev[i]!.x); near(h.y, rev[i]!.y);
    });
  });
});

describe('intersect — line-arc (CCW convention guard)', () => {
  // Arc: center (0,0), r=5, startAngle=0 (point (5,0)), endAngle=π/2 (point (0,5)).
  // That is the quarter-circle in the first quadrant.
  // Line y=0 (horizontal, x=-5 to x=5) hits the arc at (5,0) — angle 0, which is
  // the start endpoint — in range [0, π/2] ✓.
  // Line y=0 also hits the arc conceptually at x=-5 (angle=π) — angle π is NOT in
  // [0, π/2], so it must be REJECTED by arc filtering.
  it('line hits arc endpoint at startAngle (angle in range)', () => {
    const line = { id: 'l', kind: 'line' as const, x1: -5, y1: 0, x2: 5, y2: 0 };
    const arc  = { id: 'a', kind: 'arc' as const, cx: 0, cy: 0, r: 5, startAngle: 0, endAngle: Math.PI / 2 };
    const hits = intersect(line, arc);
    expect(hits).toHaveLength(1);
    near(hits[0]!.x, 5); near(hits[0]!.y, 0);
    near(hits[0]!.tB, 0); // angle 0 = startAngle, normalized tB = 0/(π/2) = 0
  });

  it('line misses arc because hit angle is outside [start,end]', () => {
    // Line y=0 hits the full circle at x=±5.
    // Arc covers only [π, 3π/2] (third quadrant).
    // x=5 → angle=0 (not in [π, 3π/2]). x=-5 → angle=π which IS the start.
    const line = { id: 'l', kind: 'line' as const, x1: -5, y1: 0, x2: 5, y2: 0 };
    const arc  = { id: 'a', kind: 'arc' as const, cx: 0, cy: 0, r: 5, startAngle: Math.PI, endAngle: 3 * Math.PI / 2 };
    const hits = intersect(line, arc);
    // x=-5 angle=π IS in [π, 3π/2] → 1 hit; x=5 angle=0 is NOT → rejected.
    expect(hits).toHaveLength(1);
    near(hits[0]!.x, -5); near(hits[0]!.y, 0);
  });

  it('line fully misses arc (no qualifying angles)', () => {
    // Line x=10 (vertical, far right) — no intersection with circle r=5.
    const line = { id: 'l', kind: 'line' as const, x1: 10, y1: -5, x2: 10, y2: 5 };
    const arc  = { id: 'a', kind: 'arc' as const, cx: 0, cy: 0, r: 5, startAngle: 0, endAngle: Math.PI / 2 };
    expect(intersect(line, arc)).toHaveLength(0);
  });

  it('arc-line symmetric with line-arc', () => {
    const line = { id: 'l', kind: 'line' as const, x1: -5, y1: 0, x2: 5, y2: 0 };
    const arc  = { id: 'a', kind: 'arc' as const, cx: 0, cy: 0, r: 5, startAngle: 0, endAngle: Math.PI / 2 };
    const fwd = intersect(line, arc);
    const rev = intersect(arc, line);
    expect(fwd).toHaveLength(rev.length);
    fwd.forEach((h, i) => { near(h.x, rev[i]!.x); near(h.y, rev[i]!.y); });
  });
});
