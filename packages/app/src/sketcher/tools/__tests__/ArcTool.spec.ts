import { describe, it, expect } from 'vitest';
import { ArcTool } from '../ArcTool';

const noSnap = (p: { x: number; y: number }) => ({ point: p, kind: 'none' as const });

describe('ArcTool', () => {
  it('three clicks produce a valid arc primitive (half-circle above)', () => {
    const t = new ArcTool();
    t.handle({ type: 'pointerClick', point: { x: 50, y: 0 }, snap: noSnap({ x: 50, y: 0 }) });
    t.handle({ type: 'pointerClick', point: { x: -50, y: 0 }, snap: noSnap({ x: -50, y: 0 }) });
    const out = t.handle({ type: 'pointerClick', point: { x: 0, y: 50 }, snap: noSnap({ x: 0, y: 50 }) });
    expect(out.kind).toBe('committed');
    if (out.kind === 'committed' && out.primitive.kind === 'arc') {
      expect(out.primitive.cx).toBeCloseTo(0, 3);
      expect(out.primitive.cy).toBeCloseTo(0, 3);
      expect(out.primitive.r).toBeCloseTo(50, 3);
    }
  });

  it('collinear points abort without committing', () => {
    const t = new ArcTool();
    t.handle({ type: 'pointerClick', point: { x: 0, y: 0 }, snap: noSnap({ x: 0, y: 0 }) });
    t.handle({ type: 'pointerClick', point: { x: 100, y: 0 }, snap: noSnap({ x: 100, y: 0 }) });
    const out = t.handle({ type: 'pointerClick', point: { x: 50, y: 0 }, snap: noSnap({ x: 50, y: 0 }) });
    expect(out.kind).toBe('idle');
  });

  it('numericFieldCount is always 0', () => {
    const t = new ArcTool();
    expect(t.numericFieldCount()).toBe(0);
    t.handle({ type: 'pointerClick', point: { x: 0, y: 0 }, snap: noSnap({ x: 0, y: 0 }) });
    expect(t.numericFieldCount()).toBe(0);
    t.handle({ type: 'pointerClick', point: { x: 100, y: 0 }, snap: noSnap({ x: 100, y: 0 }) });
    expect(t.numericFieldCount()).toBe(0);
  });

  it('escape after first click aborts', () => {
    const t = new ArcTool();
    t.handle({ type: 'pointerClick', point: { x: 0, y: 0 }, snap: noSnap({ x: 0, y: 0 }) });
    const out = t.handle({ type: 'escapePressed' });
    expect(out.kind).toBe('aborted');
    expect(t.getAnchor()).toBeNull();
  });

  it('getAnchor reflects current most-recent committed point', () => {
    const t = new ArcTool();
    expect(t.getAnchor()).toBeNull();
    t.handle({ type: 'pointerClick', point: { x: 50, y: 0 }, snap: noSnap({ x: 50, y: 0 }) });
    expect(t.getAnchor()).toEqual({ x: 50, y: 0 }); // start
    t.handle({ type: 'pointerClick', point: { x: -50, y: 0 }, snap: noSnap({ x: -50, y: 0 }) });
    expect(t.getAnchor()).toEqual({ x: -50, y: 0 }); // end (anchor moves to most recent click)
  });
});
