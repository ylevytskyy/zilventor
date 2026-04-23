import { describe, it, expect } from 'vitest';
import { LineTool } from '../LineTool';

const noSnap = (p: { x: number; y: number }) => ({ point: p, kind: 'none' as const });

describe('LineTool', () => {
  it('emits idle before the first click', () => {
    const t = new LineTool();
    const out = t.handle({ type: 'pointerMove', point: { x: 10, y: 10 }, snap: noSnap({ x: 10, y: 10 }) });
    expect(out.kind).toBe('idle');
  });

  it('after first click, emits preview on pointerMove', () => {
    const t = new LineTool();
    t.handle({ type: 'pointerClick', point: { x: 0, y: 0 }, snap: noSnap({ x: 0, y: 0 }) });
    const out = t.handle({ type: 'pointerMove', point: { x: 50, y: 0 }, snap: noSnap({ x: 50, y: 0 }) });
    expect(out.kind).toBe('preview');
    if (out.kind === 'preview') {
      expect(out.polyline).toEqual([{ x: 0, y: 0 }, { x: 50, y: 0 }]);
    }
  });

  it('second click commits a line primitive', () => {
    const t = new LineTool();
    t.handle({ type: 'pointerClick', point: { x: 0, y: 0 }, snap: noSnap({ x: 0, y: 0 }) });
    const out = t.handle({ type: 'pointerClick', point: { x: 100, y: 0 }, snap: noSnap({ x: 100, y: 0 }) });
    expect(out.kind).toBe('committed');
    if (out.kind === 'committed') {
      expect(out.primitive.kind).toBe('line');
      expect(out.primitive).toMatchObject({ x1: 0, y1: 0, x2: 100, y2: 0 });
      expect(out.primitive.id).toMatch(/^p-/);
    }
  });

  it('numeric commit of 500 with horizontal direction → 500mm line', () => {
    const t = new LineTool();
    t.handle({ type: 'pointerClick', point: { x: 0, y: 0 }, snap: noSnap({ x: 0, y: 0 }) });
    t.handle({ type: 'pointerMove', point: { x: 10, y: 0 }, snap: noSnap({ x: 10, y: 0 }) });
    const out = t.handle({ type: 'numericCommit', values: [500] });
    expect(out.kind).toBe('committed');
    if (out.kind === 'committed' && out.primitive.kind === 'line') {
      expect(out.primitive.x2).toBeCloseTo(500, 5);
      expect(out.primitive.y2).toBeCloseTo(0, 5);
    }
  });

  it('escapePressed after first click aborts and resets to IDLE', () => {
    const t = new LineTool();
    t.handle({ type: 'pointerClick', point: { x: 0, y: 0 }, snap: noSnap({ x: 0, y: 0 }) });
    const out = t.handle({ type: 'escapePressed' });
    expect(out.kind).toBe('aborted');
    expect(t.getAnchor()).toBeNull();
  });

  it('numericFieldCount is 0 before first click, 1 after', () => {
    const t = new LineTool();
    expect(t.numericFieldCount()).toBe(0);
    t.handle({ type: 'pointerClick', point: { x: 0, y: 0 }, snap: noSnap({ x: 0, y: 0 }) });
    expect(t.numericFieldCount()).toBe(1);
  });
});
