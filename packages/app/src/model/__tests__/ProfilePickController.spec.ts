import { describe, it, expect } from 'vitest';
import { ProfilePickController } from '../ProfilePickController';

describe('ProfilePickController', () => {
  it('pick returns the sketchId whose bbox contains the point', () => {
    const ctrl = new ProfilePickController();
    ctrl.setCandidates([
      {
        sketchId: 'S1',
        primitives: [
          { id: 'R1', kind: 'rectangle', x: 0, y: 0, w: 10, h: 10 }
        ]
      },
      {
        sketchId: 'S2',
        primitives: [
          { id: 'R2', kind: 'rectangle', x: 100, y: 100, w: 10, h: 10 }
        ]
      }
    ]);
    expect(ctrl.pick({ x: 5, y: 5 })).toBe('S1');
    expect(ctrl.pick({ x: 105, y: 105 })).toBe('S2');
  });

  it('prefers the inner sketch when nested bounding boxes overlap', () => {
    const ctrl = new ProfilePickController();
    ctrl.setCandidates([
      {
        sketchId: 'OUTER',
        primitives: [
          { id: 'R_outer', kind: 'rectangle', x: 0, y: 0, w: 100, h: 100 }
        ]
      },
      {
        sketchId: 'INNER',
        primitives: [
          { id: 'R_inner', kind: 'rectangle', x: 40, y: 40, w: 20, h: 20 }
        ]
      }
    ]);
    // Point lies inside both bboxes; expect the smaller-area INNER sketch.
    expect(ctrl.pick({ x: 50, y: 50 })).toBe('INNER');
  });

  it('returns null when the point is outside all bboxes + tolerance', () => {
    const ctrl = new ProfilePickController();
    ctrl.setTolerance(1);
    ctrl.setCandidates([
      {
        sketchId: 'S1',
        primitives: [
          { id: 'R1', kind: 'rectangle', x: 0, y: 0, w: 10, h: 10 }
        ]
      }
    ]);
    expect(ctrl.pick({ x: 100, y: 100 })).toBeNull();
  });
});
