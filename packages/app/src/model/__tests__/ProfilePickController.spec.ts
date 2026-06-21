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

  it('picks a sketch whose only primitive is an axis-aligned ellipse (rotation=0)', () => {
    // ellipse cx=0,cy=0,rx=8,ry=3,rotation=0 → bbox [-8,-3,8,3]; tolerance=5 default
    const ctrl = new ProfilePickController();
    ctrl.setTolerance(0);
    ctrl.setCandidates([
      {
        sketchId: 'E1',
        primitives: [
          { id: 'e1', kind: 'ellipse', cx: 0, cy: 0, rx: 8, ry: 3, rotation: 0 }
        ]
      }
    ]);
    // Point at (0,0) is inside bbox
    expect(ctrl.pick({ x: 0, y: 0 })).toBe('E1');
    // Point well outside bbox (no tolerance) → null
    expect(ctrl.pick({ x: 20, y: 0 })).toBeNull();
  });

  it('ellipse bbox extents match the rotated-ellipse formula', () => {
    // rotation=0 → hx=rx=8, hy=ry=3
    const ctrl = new ProfilePickController();
    ctrl.setTolerance(0);
    ctrl.setCandidates([
      {
        sketchId: 'E2',
        primitives: [
          { id: 'e2', kind: 'ellipse', cx: 0, cy: 0, rx: 8, ry: 3, rotation: 0 }
        ]
      }
    ]);
    // xmax edge: pick at exactly x=8 should be inside (on boundary)
    expect(ctrl.pick({ x: 8, y: 0 })).toBe('E2');
    // Just outside xmax
    expect(ctrl.pick({ x: 8.1, y: 0 })).toBeNull();
    // ymax edge
    expect(ctrl.pick({ x: 0, y: 3 })).toBe('E2');
    expect(ctrl.pick({ x: 0, y: 3.1 })).toBeNull();
  });
});
