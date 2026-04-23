import { describe, it, expect } from 'vitest';
import { CircleTool } from '../CircleTool';

const noSnap = (p: { x: number; y: number }) => ({ point: p, kind: 'none' as const });

describe('CircleTool', () => {
  it('center then radius-point commits a circle', () => {
    const t = new CircleTool();
    t.handle({ type: 'pointerClick', point: { x: 50, y: 50 }, snap: noSnap({ x: 50, y: 50 }) });
    const out = t.handle({ type: 'pointerClick', point: { x: 60, y: 50 }, snap: noSnap({ x: 60, y: 50 }) });
    expect(out.kind).toBe('committed');
    if (out.kind === 'committed' && out.primitive.kind === 'circle') {
      expect(out.primitive).toMatchObject({ cx: 50, cy: 50, r: 10 });
    }
  });

  it('numeric commit of [r] after center click produces a circle with that radius', () => {
    const t = new CircleTool();
    t.handle({ type: 'pointerClick', point: { x: 0, y: 0 }, snap: noSnap({ x: 0, y: 0 }) });
    const out = t.handle({ type: 'numericCommit', values: [25] });
    expect(out.kind).toBe('committed');
    if (out.kind === 'committed' && out.primitive.kind === 'circle') {
      expect(out.primitive).toMatchObject({ cx: 0, cy: 0, r: 25 });
    }
  });

  it('zero-radius second click is a no-op (idle)', () => {
    const t = new CircleTool();
    t.handle({ type: 'pointerClick', point: { x: 0, y: 0 }, snap: noSnap({ x: 0, y: 0 }) });
    const out = t.handle({ type: 'pointerClick', point: { x: 0, y: 0 }, snap: noSnap({ x: 0, y: 0 }) });
    expect(out.kind).toBe('idle');
  });

  it('numeric commit of 0 is a no-op', () => {
    const t = new CircleTool();
    t.handle({ type: 'pointerClick', point: { x: 0, y: 0 }, snap: noSnap({ x: 0, y: 0 }) });
    const out = t.handle({ type: 'numericCommit', values: [0] });
    expect(out.kind).toBe('idle');
  });

  it('preview during WAITING_RADIUS is a 65-point polyline', () => {
    const t = new CircleTool();
    t.handle({ type: 'pointerClick', point: { x: 0, y: 0 }, snap: noSnap({ x: 0, y: 0 }) });
    const out = t.handle({ type: 'pointerMove', point: { x: 20, y: 0 }, snap: noSnap({ x: 20, y: 0 }) });
    expect(out.kind).toBe('preview');
    if (out.kind === 'preview') expect(out.polyline.length).toBe(65);
  });

  it('numericFieldCount: 0 → 1 → 0', () => {
    const t = new CircleTool();
    expect(t.numericFieldCount()).toBe(0);
    t.handle({ type: 'pointerClick', point: { x: 0, y: 0 }, snap: noSnap({ x: 0, y: 0 }) });
    expect(t.numericFieldCount()).toBe(1);
    t.handle({ type: 'pointerClick', point: { x: 10, y: 0 }, snap: noSnap({ x: 10, y: 0 }) });
    expect(t.numericFieldCount()).toBe(0);
  });
});
