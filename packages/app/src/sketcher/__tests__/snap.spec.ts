import { describe, it, expect } from 'vitest';
import { resolveSnap } from '../snap';
import type { SketchPrimitive } from '@zilventor/shared';

const EMPTY_SKETCH: SketchPrimitive[] = [];

describe('resolveSnap', () => {
  it('returns the input unchanged for an empty sketch and no anchor', () => {
    const r = resolveSnap({ x: 10, y: 20 }, { primitives: EMPTY_SKETCH, pixelTolerance: 5 });
    expect(r.point).toEqual({ x: 10, y: 20 });
    expect(r.kind).toBe('none');
  });

  it('snaps to an endpoint of a line within tolerance', () => {
    const line: SketchPrimitive = { id: 'p1', kind: 'line', x1: 0, y1: 0, x2: 100, y2: 0 };
    const r = resolveSnap({ x: 99, y: 1 }, { primitives: [line], pixelTolerance: 5 });
    expect(r.point).toEqual({ x: 100, y: 0 });
    expect(r.kind).toBe('endpoint');
  });

  it('snaps to horizontal axis from anchor within 3°', () => {
    const r = resolveSnap({ x: 500, y: 5 }, { primitives: EMPTY_SKETCH, pixelTolerance: 5, anchor: { x: 0, y: 0 } });
    expect(r.point.y).toBeCloseTo(0, 3);
    expect(r.point.x).toBeCloseTo(500, 3);
    expect(r.kind).toBe('horizontal-axis');
  });

  it('snaps to vertical axis from anchor within 3°', () => {
    const r = resolveSnap({ x: 2, y: 100 }, { primitives: EMPTY_SKETCH, pixelTolerance: 5, anchor: { x: 0, y: 0 } });
    expect(r.point.x).toBeCloseTo(0, 3);
    expect(r.kind).toBe('vertical-axis');
  });

  it('does not snap to axis when angle exceeds 3°', () => {
    const r = resolveSnap({ x: 100, y: 50 }, { primitives: EMPTY_SKETCH, pixelTolerance: 5, anchor: { x: 0, y: 0 } });
    expect(r.kind).toBe('none');
  });

  it('endpoint snap wins over axis snap when both are candidates', () => {
    const line: SketchPrimitive = { id: 'p1', kind: 'line', x1: 500, y1: 1, x2: 600, y2: 1 };
    const r = resolveSnap({ x: 500, y: 1 }, { primitives: [line], pixelTolerance: 5, anchor: { x: 0, y: 0 } });
    expect(r.point).toEqual({ x: 500, y: 1 });
    expect(r.kind).toBe('endpoint');
  });

  it('rectangle contributes 4 corner endpoints', () => {
    const rect: SketchPrimitive = { id: 'p1', kind: 'rectangle', x: 0, y: 0, w: 100, h: 200 };
    const r = resolveSnap({ x: 101, y: 201 }, { primitives: [rect], pixelTolerance: 5 });
    expect(r.point).toEqual({ x: 100, y: 200 });
    expect(r.kind).toBe('endpoint');
  });

  it('arc contributes start and end point endpoints', () => {
    // Quarter arc centered at (0,0), r=50, angles 0..π/2 → start (50,0), end (0,50)
    const arc: SketchPrimitive = { id: 'p1', kind: 'arc', cx: 0, cy: 0, r: 50, startAngle: 0, endAngle: Math.PI / 2 };
    const r = resolveSnap({ x: 0.5, y: 50 }, { primitives: [arc], pixelTolerance: 5 });
    expect(r.point.x).toBeCloseTo(0, 3);
    expect(r.point.y).toBeCloseTo(50, 3);
    expect(r.kind).toBe('endpoint');
  });

  it('spline contributes first and last control point endpoints', () => {
    const spline: SketchPrimitive = {
      id: 'p1', kind: 'spline',
      controlPoints: [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 30, y: 0 }],
      degree: 3, closed: false
    };
    const r = resolveSnap({ x: 30.5, y: 0 }, { primitives: [spline], pixelTolerance: 5 });
    expect(r.point).toEqual({ x: 30, y: 0 });
    expect(r.kind).toBe('endpoint');
  });
});
