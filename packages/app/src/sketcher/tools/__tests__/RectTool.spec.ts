import { describe, it, expect } from 'vitest';
import { RectTool } from '../RectTool';

const noSnap = (p: { x: number; y: number }) => ({ point: p, kind: 'none' as const });

describe('RectTool', () => {
  it('two clicks at opposite corners commit a rectangle with normalized x/y/w/h', () => {
    const t = new RectTool();
    t.handle({ type: 'pointerClick', point: { x: 100, y: 200 }, snap: noSnap({ x: 100, y: 200 }) });
    const out = t.handle({ type: 'pointerClick', point: { x: 0, y: 0 }, snap: noSnap({ x: 0, y: 0 }) });
    expect(out.kind).toBe('committed');
    if (out.kind === 'committed' && out.primitive.kind === 'rectangle') {
      expect(out.primitive).toMatchObject({ x: 0, y: 0, w: 100, h: 200 });
    }
  });

  it('numeric commit of [w, h] after first click produces a rectangle anchored at first click', () => {
    const t = new RectTool();
    t.handle({ type: 'pointerClick', point: { x: 10, y: 20 }, snap: noSnap({ x: 10, y: 20 }) });
    const out = t.handle({ type: 'numericCommit', values: [100, 200] });
    expect(out.kind).toBe('committed');
    if (out.kind === 'committed' && out.primitive.kind === 'rectangle') {
      expect(out.primitive).toMatchObject({ x: 10, y: 20, w: 100, h: 200 });
    }
  });

  it('preview during pointerMove after first click shows a 5-point rect outline', () => {
    const t = new RectTool();
    t.handle({ type: 'pointerClick', point: { x: 0, y: 0 }, snap: noSnap({ x: 0, y: 0 }) });
    const out = t.handle({ type: 'pointerMove', point: { x: 50, y: 30 }, snap: noSnap({ x: 50, y: 30 }) });
    expect(out.kind).toBe('preview');
    if (out.kind === 'preview') {
      expect(out.polyline.length).toBe(5);
    }
  });

  it('numericFieldCount is 0 before first click, 2 after', () => {
    const t = new RectTool();
    expect(t.numericFieldCount()).toBe(0);
    t.handle({ type: 'pointerClick', point: { x: 0, y: 0 }, snap: noSnap({ x: 0, y: 0 }) });
    expect(t.numericFieldCount()).toBe(2);
  });

  it('escape after first click aborts and resets', () => {
    const t = new RectTool();
    t.handle({ type: 'pointerClick', point: { x: 0, y: 0 }, snap: noSnap({ x: 0, y: 0 }) });
    const out = t.handle({ type: 'escapePressed' });
    expect(out.kind).toBe('aborted');
    expect(t.getAnchor()).toBeNull();
  });
});
