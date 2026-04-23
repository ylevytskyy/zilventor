import { describe, it, expect } from 'vitest';
import type { SketchPrimitive } from '@zilventor/shared';
import { inferFromSnaps } from '../inferFromSnaps';

describe('inferFromSnaps', () => {
  it('produces coincident on endpoint snap', async () => {
    const line: SketchPrimitive = { id: 'L2', kind: 'line', x1: 10, y1: 0, x2: 20, y2: 5 };
    const cs = await inferFromSnaps(line, [
      { kind: 'endpoint', primitiveId: 'L1', anchor: 'end' }
    ]);
    const c = cs[0]!;
    expect(c.kind).toBe('coincident');
    expect(c.source).toBe('auto-snap');
  });

  it('produces horizontal on h-axis hint for a line', async () => {
    const line: SketchPrimitive = { id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 30, y2: 0 };
    const cs = await inferFromSnaps(line, [{ kind: 'axis', axis: 'h' }]);
    expect(cs[0]!.kind).toBe('horizontal');
  });

  it('ignores axis hints on non-lines', async () => {
    const circle: SketchPrimitive = { id: 'C1', kind: 'circle', cx: 0, cy: 0, r: 5 };
    const cs = await inferFromSnaps(circle, [{ kind: 'axis', axis: 'h' }]);
    expect(cs).toEqual([]);
  });

  it('returns empty for empty snap events', async () => {
    const line: SketchPrimitive = { id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 5 };
    expect(await inferFromSnaps(line, [])).toEqual([]);
  });
});
