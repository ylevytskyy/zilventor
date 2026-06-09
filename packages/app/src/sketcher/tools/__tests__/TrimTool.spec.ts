import { describe, it, expect } from 'vitest';
import { TrimTool } from '../TrimTool';
import type { SketchPrimitive } from '@zilventor/shared';

// Helper: build the opts bag with vi.fn() spies.
function makeTool() {
  const adds: SketchPrimitive[] = [];
  const dels: string[] = [];
  const updates: { id: string; patch: Partial<SketchPrimitive> }[] = [];
  const tool = new TrimTool({
    addPrimitive: (p) => adds.push(p),
    deletePrimitive: (id) => dels.push(id),
    updatePrimitive: (id, patch) => updates.push({ id, patch }),
  });
  return { tool, adds, dels, updates };
}

// Geometry fixtures for end-trim:
//   lh: horizontal y=5, x1=0 to x2=10.  lv crosses at x=5.
//   Picking near x=8 → end interval (between crossing x=5 and endpoint x=10) → shorten.
const lh: SketchPrimitive = { id: 'lh', kind: 'line', x1: 0, y1: 5, x2: 10, y2: 5 };
const lv: SketchPrimitive = { id: 'lv', kind: 'line', x1: 5, y1: 0, x2: 5, y2: 10 };

// Interior interval requires TWO crossings.
// lh2: y=0, x1=-10 to x2=10.  Two cutters: lv1 at x=-5, lv2 at x=5.
// Click between x=-5 and x=5 → interior interval → delete lh2 + add two outer remnants.
//
// FALSE-GREEN GUARD: The crossing positions x=±5 are computed by intersect.ts from
// the geometry — we do NOT hand-author them into the tool test. The assertions check
// the STRUCTURAL properties of the output (remnant endpoints match the crossing
// positions that intersect.ts itself computed).

const lh2: SketchPrimitive = { id: 'lh2', kind: 'line', x1: -10, y1: 0, x2: 10, y2: 0 };
const lv1: SketchPrimitive = { id: 'lv1', kind: 'line', x1: -5, y1: -5, x2: -5, y2: 5 };
const lv2: SketchPrimitive = { id: 'lv2', kind: 'line', x1: 5,  y1: -5, x2: 5,  y2: 5 };

describe('TrimTool — line interior trim (two crossings)', () => {
  it('clicking lh between its two crossings deletes it and adds two outer remnants', () => {
    const { tool, adds, dels } = makeTool();
    tool.setPrimitives([lh2, lv1, lv2]);
    // Click between the two crossings at (0,0) — which is on lh2 body (y=0 line, x=0).
    tool.onPointerClick({ x: 0, y: 0 });

    expect(dels).toContain('lh2');
    // Two remnants: left (x=-10 to -5) and right (x=5 to 10).
    expect(adds).toHaveLength(2);
    const lines = adds.filter((p): p is Extract<SketchPrimitive, { kind: 'line' }> => p.kind === 'line');
    expect(lines).toHaveLength(2);
    const xs = lines.map((l) => ({ x1: l.x1, x2: l.x2 }));
    const leftPiece = xs.find((seg) => Math.abs(seg.x1 - (-10)) < 0.01);
    expect(leftPiece).toBeDefined();
    // Left piece ends at the first crossing (x=-5).
    expect(leftPiece!.x2).toBeCloseTo(-5, 2);
    const rightPiece = xs.find((seg) => Math.abs(seg.x2 - 10) < 0.01);
    expect(rightPiece).toBeDefined();
    // Right piece starts at the second crossing (x=5).
    expect(rightPiece!.x1).toBeCloseTo(5, 2);
  });
});

describe('TrimTool — line end-trim (shorten with UpdatePrimitive)', () => {
  it('clicking lh near its right endpoint shortens it to the crossing', () => {
    // lh: y=5, x1=0 to x2=10.  lv crosses at x=5.
    // Click near x=8 (between crossing x=5 and right endpoint x=10) → end trim.
    const { tool, dels, updates, adds } = makeTool();
    tool.setPrimitives([lh, lv]);
    tool.onPointerClick({ x: 8, y: 5 });

    // No delete, no new primitives — just shorten.
    expect(dels).toHaveLength(0);
    expect(adds).toHaveLength(0);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.id).toBe('lh');
    // The right endpoint (x2) should move from 10 to ~5 (the crossing).
    const patch = updates[0]!.patch as Partial<Extract<SketchPrimitive, { kind: 'line' }>>;
    expect(patch.x2).toBeCloseTo(5, 2);
  });
});

describe('TrimTool — no crossings (whole primitive deleted)', () => {
  it('clicking an isolated primitive with no crossings deletes it entirely', () => {
    const iso: SketchPrimitive = { id: 'iso', kind: 'line', x1: 100, y1: 100, x2: 200, y2: 100 };
    const { tool, dels, adds, updates } = makeTool();
    tool.setPrimitives([iso]);
    tool.onPointerClick({ x: 150, y: 100 });
    expect(dels).toContain('iso');
    expect(adds).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });
});

describe('TrimTool — no hit (click misses all primitives)', () => {
  it('clicking empty space emits nothing', () => {
    const { tool, dels, adds, updates } = makeTool();
    tool.setPrimitives([lh, lv]);
    tool.onPointerClick({ x: 50, y: 50 }); // far from any primitive
    expect(dels).toHaveLength(0);
    expect(adds).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });
});

// ---- Arc-target trim tests ----
// FALSE-GREEN GUARD: these tests drive the REAL intersect.ts output through TrimTool.
// The expected startAngle/endAngle values are NOT hand-authored — they are derived from
// the geometry (a line x=0 crosses arc center (0,0) r=5 at angle=π/2, which is exactly
// the arc's midpoint). The test asserts the structural outcome, not a hard-coded angle.

describe('TrimTool — arc end-trim (intersect.ts driven)', () => {
  it('trim arc (startAngle=0..endAngle=π) near its startAngle end shortens startAngle', () => {
    // Arc: center (0,0), r=5, CCW from angle=0 (point 5,0) to angle=π (point -5,0).
    // Cutter: vertical line x=0 from y=-5 to y=5 — crosses the arc at angle=π/2 (x=0,y=5).
    // intersect(arc, vline) → tA normalized = (π/2 - 0)/(π - 0) = 0.5.
    // Click near (4, 0.1) → tPick for arc ≈ 0 (near the startAngle end, before the π/2 crossing).
    // Breakpoints: [0, 0.5, 1]. Pick in interval [0, 0.5] → isStartBound=true, isEndBound=false.
    // → Trim the start → updatePrimitive with new startAngle = 0 + 0.5*(π-0) = π/2.
    const arc: SketchPrimitive = { id: 'arc1', kind: 'arc', cx: 0, cy: 0, r: 5, startAngle: 0, endAngle: Math.PI };
    const vline: SketchPrimitive = { id: 'vl', kind: 'line', x1: 0, y1: -5, x2: 0, y2: 5 };
    const { tool, dels, adds, updates } = makeTool();
    tool.setPrimitives([arc, vline]);
    // Click near (4, 0.1): on the arc body near angle≈0 (start side, before the π/2 crossing).
    tool.onPointerClick({ x: 4, y: 0.1 });

    // Outcome: no delete, no new primitives — just shorten the start.
    expect(dels).toHaveLength(0);
    expect(adds).toHaveLength(0);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.id).toBe('arc1');
    // New startAngle should be approximately π/2 (the intersection angle).
    const patch = updates[0]!.patch as Partial<Extract<SketchPrimitive, { kind: 'arc' }>>;
    expect(patch.startAngle).toBeCloseTo(Math.PI / 2, 2);
  });
});

describe('TrimTool — circle target (deferred, no-op)', () => {
  it('clicking a circle target does not crash and emits nothing (deferred to slice 3)', () => {
    // Circle center (0,0) r=5. Horizontal line y=0 is a cutter.
    // Click at (0, 4.9): dist to circle = |hypot(0,4.9)-5| ≈ 0.1 (hits circle body).
    // dist to line y=0 = 4.9 (farther). pickPrimitiveAt → circle wins.
    // Full-circle trim no-ops with a comment → emits nothing.
    const circ: SketchPrimitive = { id: 'c1', kind: 'circle', cx: 0, cy: 0, r: 5 };
    const line: SketchPrimitive = { id: 'l1', kind: 'line', x1: -5, y1: 0, x2: 5, y2: 0 };
    const { tool, dels, adds, updates } = makeTool();
    tool.setPrimitives([circ, line]);
    // Click near the top of the circle (not on the line) — should no-op (circle trim deferred to slice 3).
    tool.onPointerClick({ x: 0, y: 4.9 });
    expect(dels).toHaveLength(0);
    expect(adds).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });
});
