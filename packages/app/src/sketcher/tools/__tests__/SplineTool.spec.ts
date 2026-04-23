import { describe, it, expect } from 'vitest';
import { SplineTool } from '../SplineTool';

const noSnap = (p: { x: number; y: number }) => ({ point: p, kind: 'none' as const });

describe('SplineTool', () => {
  it('N clicks + Enter commits a spline with N control points (degree 3)', () => {
    const t = new SplineTool();
    for (const p of [{ x: 0, y: 0 }, { x: 10, y: 20 }, { x: 20, y: 20 }, { x: 30, y: 0 }]) {
      t.handle({ type: 'pointerClick', point: p, snap: noSnap(p) });
    }
    const out = t.handle({ type: 'enterPressed' });
    expect(out.kind).toBe('committed');
    if (out.kind === 'committed' && out.primitive.kind === 'spline') {
      expect(out.primitive.controlPoints.length).toBe(4);
      expect(out.primitive.degree).toBe(3);
      expect(out.primitive.closed).toBe(false);
    }
  });

  it('Enter before 2 clicks is a no-op', () => {
    const t = new SplineTool();
    t.handle({ type: 'pointerClick', point: { x: 0, y: 0 }, snap: noSnap({ x: 0, y: 0 }) });
    const out = t.handle({ type: 'enterPressed' });
    expect(out.kind).toBe('idle');
  });

  it('preview shows a polyline through control points + current cursor after >= 1 click', () => {
    const t = new SplineTool();
    t.handle({ type: 'pointerClick', point: { x: 0, y: 0 }, snap: noSnap({ x: 0, y: 0 }) });
    t.handle({ type: 'pointerClick', point: { x: 10, y: 10 }, snap: noSnap({ x: 10, y: 10 }) });
    const out = t.handle({ type: 'pointerMove', point: { x: 20, y: 5 }, snap: noSnap({ x: 20, y: 5 }) });
    expect(out.kind).toBe('preview');
    if (out.kind === 'preview') expect(out.polyline.length).toBeGreaterThan(2);
  });

  it('escape with points discards them and returns aborted', () => {
    const t = new SplineTool();
    t.handle({ type: 'pointerClick', point: { x: 0, y: 0 }, snap: noSnap({ x: 0, y: 0 }) });
    const out = t.handle({ type: 'escapePressed' });
    expect(out.kind).toBe('aborted');
    expect(t.getAnchor()).toBeNull();
  });

  it('numericFieldCount is always 0', () => {
    const t = new SplineTool();
    expect(t.numericFieldCount()).toBe(0);
    t.handle({ type: 'pointerClick', point: { x: 0, y: 0 }, snap: noSnap({ x: 0, y: 0 }) });
    expect(t.numericFieldCount()).toBe(0);
  });

  it('getAnchor returns the most recent control point', () => {
    const t = new SplineTool();
    expect(t.getAnchor()).toBeNull();
    t.handle({ type: 'pointerClick', point: { x: 5, y: 5 }, snap: noSnap({ x: 5, y: 5 }) });
    expect(t.getAnchor()).toEqual({ x: 5, y: 5 });
    t.handle({ type: 'pointerClick', point: { x: 10, y: 10 }, snap: noSnap({ x: 10, y: 10 }) });
    expect(t.getAnchor()).toEqual({ x: 10, y: 10 });
  });
});
