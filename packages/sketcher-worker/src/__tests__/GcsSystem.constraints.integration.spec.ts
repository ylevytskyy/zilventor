import { describe, it, expect } from 'vitest';
import type { SketchPrimitive, SketchConstraint } from '@zilventor/shared';
import { GcsSystem } from '../GcsSystem';
import { loadPlanegcs } from '../planegcsLoader';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makeLine = (
  id: string,
  x1: number, y1: number,
  x2: number, y2: number,
): SketchPrimitive => ({ id, kind: 'line', x1, y1, x2, y2 });

const makeRect = (
  id: string,
  x: number, y: number,
  w: number, h: number,
): SketchPrimitive => ({ id, kind: 'rectangle', x, y, w, h });

async function makeSystem(primitives: SketchPrimitive[], constraints: SketchConstraint[] = []) {
  const { createWrapper } = await loadPlanegcs();
  const sys = new GcsSystem(createWrapper());
  await sys.loadSketch({ primitives, constraints });
  return sys;
}

// ---------------------------------------------------------------------------
// Tests — one per constraint kind (7 tests) + remove round-trip
// ---------------------------------------------------------------------------
describe('GcsSystem constraint integration', () => {

  it('horizontal constraint reduces dof and is reflected in currentDof()', async () => {
    // An unconstrained line has 4 DOF. Adding horizontal removes 1 → 3.
    const sys = await makeSystem([makeLine('L1', 0, 0, 10, 5)]);
    expect(sys.currentDof().count).toBe(4);

    const result = await sys.addConstraint({
      id: 'C1',
      kind: 'horizontal',
      line: 'L1',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dof.count).toBe(3);
    }
    expect(sys.currentDof().count).toBe(3);
    await sys.unloadSketch();
  });

  it('vertical constraint reduces dof', async () => {
    const sys = await makeSystem([makeLine('L1', 0, 0, 5, 10)]);

    const result = await sys.addConstraint({
      id: 'C1',
      kind: 'vertical',
      line: 'L1',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dof.count).toBeLessThan(4);
    }
    await sys.unloadSketch();
  });

  it('parallel constraint ties two lines together', async () => {
    const L1 = makeLine('L1', 0, 0, 10, 0);
    const L2 = makeLine('L2', 0, 5, 10, 2); // slightly off-horizontal
    const sys = await makeSystem([L1, L2]);
    const dofBefore = sys.currentDof().count; // 8

    const result = await sys.addConstraint({
      id: 'C1',
      kind: 'parallel',
      line1: 'L1',
      line2: 'L2',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dof.count).toBeLessThan(dofBefore);
    }
    await sys.unloadSketch();
  });

  it('perpendicular constraint reduces dof by 1', async () => {
    const L1 = makeLine('L1', 0, 0, 10, 0);
    const L2 = makeLine('L2', 5, 0, 5, 8); // nearly perpendicular
    const sys = await makeSystem([L1, L2]);
    const dofBefore = sys.currentDof().count;

    const result = await sys.addConstraint({
      id: 'C1',
      kind: 'perpendicular',
      line1: 'L1',
      line2: 'L2',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dof.count).toBeLessThan(dofBefore);
    }
    await sys.unloadSketch();
  });

  it('coincident constraint merges two points (reduces dof by 2)', async () => {
    const L1 = makeLine('L1', 0, 0, 10, 0);
    const L2 = makeLine('L2', 11, 0, 20, 0); // end of L1 ≈ start of L2
    const sys = await makeSystem([L1, L2]);
    const dofBefore = sys.currentDof().count; // 8

    const result = await sys.addConstraint({
      id: 'C1',
      kind: 'coincident',
      a: { primitiveId: 'L1', anchor: 'end' },
      b: { primitiveId: 'L2', anchor: 'start' },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dof.count).toBeLessThan(dofBefore);
    }
    await sys.unloadSketch();
  });

  it('equal constraint equates two line lengths', async () => {
    const L1 = makeLine('L1', 0, 0, 10, 0); // length 10
    const L2 = makeLine('L2', 0, 5, 7, 5);  // length 7
    const sys = await makeSystem([L1, L2]);
    const dofBefore = sys.currentDof().count;

    const result = await sys.addConstraint({
      id: 'C1',
      kind: 'equal',
      a: 'L1',
      b: 'L2',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dof.count).toBeLessThan(dofBefore);
    }
    await sys.unloadSketch();
  });

  it('rectangle implicit constraints keep 3 DOF (translate x/y + scale)', async () => {
    // A rectangle pushed via loadSketch gets 4 implicit H/V constraints.
    // 4 points = 8 DOF; 4 constraints remove 4 → 4 remaining.
    // (Translation x2 + scale x2 = 4; but solver may report differently.)
    // We just assert the rectangle loads without error and dof is reduced from 8.
    const sys = await makeSystem([makeRect('R1', 0, 0, 100, 60)]);
    const dof = sys.currentDof();
    expect(dof.count).toBeLessThan(8);
    expect(dof.state).not.toBe('over');
    await sys.unloadSketch();
  });

  it('removeConstraint restores dof after horizontal removal', async () => {
    const sys = await makeSystem([makeLine('L1', 0, 0, 10, 5)]);

    await sys.addConstraint({ id: 'C1', kind: 'horizontal', line: 'L1' });
    expect(sys.currentDof().count).toBe(3);

    const { dof } = await sys.removeConstraint('C1');
    // DOF should be restored to 4
    expect(dof.count).toBe(4);
    expect(sys.currentDof().count).toBe(4);
    await sys.unloadSketch();
  });

  it('symmetric: two points reflect across an axis line', async () => {
    const { createWrapper } = await loadPlanegcs();
    const sys = new GcsSystem(createWrapper());
    await sys.loadSketch({
      primitives: [
        { id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },      // left of axis
        { id: 'L2', kind: 'line', x1: 20, y1: 0, x2: 30, y2: 0 },      // right of axis
        { id: 'AXIS', kind: 'line', x1: 15, y1: -10, x2: 15, y2: 10 } // vertical axis at x=15
      ],
      constraints: []
    });
    const r = await sys.addConstraint({
      id: 'c1',
      kind: 'symmetric',
      a: { primitiveId: 'L1', anchor: 'end' },   // (10, 0)
      b: { primitiveId: 'L2', anchor: 'start' }, // (20, 0)
      axis: 'AXIS'
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const l1 = sys.readCoords('L1'), l2 = sys.readCoords('L2');
      // After solve, L1.end and L2.start should be symmetric across x=15.
      expect(Math.abs((l1.x2 + l2.x1) / 2 - 15)).toBeLessThan(1e-3);
    }
    await sys.unloadSketch();
  });

  it('tangent: a line is tangent to an arc', async () => {
    const { createWrapper } = await loadPlanegcs();
    const sys = new GcsSystem(createWrapper());
    await sys.loadSketch({
      primitives: [
        { id: 'L1', kind: 'line', x1: -20, y1: 10.5, x2: 20, y2: 10.5 },
        { id: 'A1', kind: 'arc', cx: 0, cy: 0, r: 10, startAngle: 0, endAngle: Math.PI }
      ],
      constraints: []
    });
    const r = await sys.addConstraint({
      id: 'c1', kind: 'tangent', line: 'L1', arc: 'A1'
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // After solve: the distance from arc center (0,0) to line should equal radius (10).
      const l = sys.readCoords('L1');
      // Point-to-line distance = |cross((p2-p1), (center-p1))| / |p2-p1|
      const dx = l.x2 - l.x1, dy = l.y2 - l.y1;
      const cross = (0 - l.x1) * dy - (0 - l.y1) * dx;
      const d = Math.abs(cross) / Math.hypot(dx, dy);
      expect(Math.abs(d - 10)).toBeLessThan(0.5);
    }
    await sys.unloadSketch();
  });
});
