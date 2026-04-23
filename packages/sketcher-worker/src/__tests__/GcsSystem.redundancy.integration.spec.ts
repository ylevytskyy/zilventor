import { describe, it, expect } from 'vitest';
import type { SketchPrimitive } from '@zilventor/shared';
import { GcsSystem } from '../GcsSystem';
import { loadPlanegcs } from '../planegcsLoader';

const line = (id: string, x1: number, y1: number, x2: number, y2: number): SketchPrimitive =>
  ({ id, kind: 'line', x1, y1, x2, y2 });

describe('GcsSystem redundancy/conflict integration', () => {
  it('adding a duplicate horizontal returns ok:false redundant', async () => {
    const { createWrapper } = await loadPlanegcs();
    const sys = new GcsSystem(createWrapper());
    await sys.loadSketch({
      primitives: [line('L1', 0, 0, 10, 0)],
      constraints: [{ id: 'c1', kind: 'horizontal', line: 'L1' }]
    });
    const r = await sys.addConstraint({ id: 'c2', kind: 'horizontal', line: 'L1' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('redundant');
      expect(r.offendingConstraintIds.length).toBeGreaterThanOrEqual(1);
    }
    await sys.unloadSketch();
  });

  it('adding a duplicate equal-length returns ok:false redundant', async () => {
    // planegcs classifies duplicate constraints as redundant (not conflicting)
    const { createWrapper } = await loadPlanegcs();
    const sys = new GcsSystem(createWrapper());
    await sys.loadSketch({
      primitives: [line('L1', 0, 0, 10, 0), line('L2', 0, 5, 7, 5)],
      constraints: [{ id: 'c1', kind: 'equal', a: 'L1', b: 'L2' }]
    });
    const r = await sys.addConstraint({ id: 'c2', kind: 'equal', a: 'L1', b: 'L2' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('redundant');
      expect(r.offendingConstraintIds).toContain('c2');
    }
    await sys.unloadSketch();
  });

  it('failed constraint is NOT added to domainConstraints (rolled back cleanly)', async () => {
    const { createWrapper } = await loadPlanegcs();
    const sys = new GcsSystem(createWrapper());
    await sys.loadSketch({
      primitives: [line('L1', 0, 0, 10, 0)],
      constraints: [{ id: 'c1', kind: 'horizontal', line: 'L1' }]
    });
    const dofBefore = sys.currentDof();
    await sys.addConstraint({ id: 'c2', kind: 'horizontal', line: 'L1' });
    const dofAfter = sys.currentDof();
    expect(dofAfter).toEqual(dofBefore);   // state rolled back cleanly
    await sys.unloadSketch();
  });
});
