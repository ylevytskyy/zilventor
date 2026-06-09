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
