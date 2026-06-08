import { describe, it, expect } from 'vitest';
import { offsetPrimitive } from '../offset';

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
