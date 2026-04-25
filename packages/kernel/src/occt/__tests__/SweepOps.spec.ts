import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct } from '../occtLoader';
import { buildWireFromSketch } from '../SweepOps';

describe('SweepOps — buildWireFromSketch', () => {
  let oc: any;
  beforeAll(async () => { oc = await loadOcct(); });

  it('builds a closed wire from a 4-line rectangle sketch', () => {
    const sketch: any = {
      id: 'S1', kind: 'sketch', plane: 'XY',
      primitives: [
        { id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
        { id: 'L2', kind: 'line', x1: 10, y1: 0, x2: 10, y2: 5 },
        { id: 'L3', kind: 'line', x1: 10, y1: 5, x2: 0, y2: 5 },
        { id: 'L4', kind: 'line', x1: 0, y1: 5, x2: 0, y2: 0 },
      ],
      constraints: [],
    };
    const wire = buildWireFromSketch(oc, sketch);
    expect((wire as any).IsNull?.()).not.toBe(true);
    expect((wire as any).Closed?.()).toBe(true);
  });

  it('builds an open wire from two connected line segments', () => {
    const sketch: any = {
      id: 'S1', kind: 'sketch', plane: 'XY',
      primitives: [
        { id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
        { id: 'L2', kind: 'line', x1: 10, y1: 0, x2: 10, y2: 5 },
      ],
      constraints: [],
    };
    const wire = buildWireFromSketch(oc, sketch);
    expect((wire as any).Closed?.()).toBe(false);
  });

  it('builds a closed wire from a single full circle', () => {
    const sketch: any = {
      id: 'S1', kind: 'sketch', plane: 'XY',
      primitives: [{ id: 'C1', kind: 'circle', cx: 0, cy: 0, r: 5 }],
      constraints: [],
    };
    const wire = buildWireFromSketch(oc, sketch);
    expect((wire as any).Closed?.()).toBe(true);
  });
});
