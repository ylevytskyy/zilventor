import { describe, it, expect } from 'vitest';
import type { SketchPrimitive } from '../types';
import { inferFromGeometry } from '../inferFromGeometry';

const line = (id: string, x1: number, y1: number, x2: number, y2: number): SketchPrimitive =>
  ({ id, kind: 'line', x1, y1, x2, y2 });

describe('inferFromGeometry', () => {
  it('returns empty for empty input', () => {
    expect(inferFromGeometry([])).toEqual([]);
  });

  it('adds horizontal constraint for a line with dy < ε', () => {
    const cs = inferFromGeometry([line('L1', 0, 10, 50, 10.0005)]);
    const h = cs.find((c) => c.kind === 'horizontal');
    expect(h).toBeDefined();
    expect((h as { line: string }).line).toBe('L1');
  });

  it('adds vertical constraint for a line with dx < ε', () => {
    const cs = inferFromGeometry([line('L1', 10, 0, 10.0005, 40)]);
    expect(cs.some((c) => c.kind === 'vertical')).toBe(true);
    const v = cs.find((c) => c.kind === 'vertical');
    expect((v as { line: string }).line).toBe('L1');
  });

  it('adds coincident for endpoints within ε', () => {
    const cs = inferFromGeometry([
      line('L1', 0, 0, 10, 0),
      line('L2', 10.00005, 0.00005, 10, 10)
    ]);
    const coinc = cs.filter((c) => c.kind === 'coincident');
    expect(coinc).toHaveLength(1);
  });

  it('does NOT infer parallel/perpendicular/tangent/equal/symmetric', () => {
    const cs = inferFromGeometry([
      line('L1', 0, 0, 10, 0),      // horizontal
      line('L2', 20, 0, 30, 0),     // also horizontal — "parallel" not inferred
      line('L3', 0, 20, 0, 30)      // vertical — "perpendicular" not inferred
    ]);
    expect(cs.length).toBeGreaterThan(0);
    for (const c of cs) {
      expect(['horizontal', 'vertical', 'coincident']).toContain(c.kind);
    }
  });

  it('tags every output with source "inferred-migration"', () => {
    const cs = inferFromGeometry([line('L1', 0, 0, 10, 0)]);
    for (const c of cs) expect(c.source).toBe('inferred-migration');
  });

  it('ignores rectangles (rectangle-implicit constraints live in the worker, not here)', () => {
    const cs = inferFromGeometry([
      { id: 'R1', kind: 'rectangle', x: 0, y: 0, w: 100, h: 50 }
    ]);
    expect(cs).toEqual([]);
  });

  it('infers coincident when an arc endpoint meets a line endpoint', () => {
    // Arc from (10,0) to (0,10), center at origin, r=10
    const arc: SketchPrimitive = { id: 'A1', kind: 'arc', cx: 0, cy: 0, r: 10, startAngle: 0, endAngle: Math.PI / 2 };
    // Line starting at (10,0) — same as arc.start
    const ln: SketchPrimitive = { id: 'L1', kind: 'line', x1: 10, y1: 0, x2: 20, y2: 0 };
    const cs = inferFromGeometry([arc, ln]);
    const coinc = cs.filter((c) => c.kind === 'coincident');
    expect(coinc.length).toBeGreaterThanOrEqual(1);
  });
});
