import { describe, it, expect } from 'vitest';
import { AxisPickController } from '../AxisPickController';

describe('AxisPickController', () => {
  it('onPointerClick returns the primitive id of a hit line', () => {
    const ctrl = new AxisPickController();
    ctrl.setCandidates([
      { id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
      { id: 'L2', kind: 'line', x1: 0, y1: 5, x2: 10, y2: 5 }
    ]);
    expect(ctrl.pick({ x: 5, y: 0 })).toBe('L1');
    expect(ctrl.pick({ x: 5, y: 5 })).toBe('L2');
    expect(ctrl.pick({ x: 5, y: 2.5 })).toBeNull();
  });
});
