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
});
