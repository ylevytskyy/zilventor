import { describe, it, expect } from 'vitest';
import type { SketchConstraint } from '@zilventor/shared';
import { AddConstraintCommand } from '../AddConstraintCommand';
import { RemoveConstraintCommand } from '../RemoveConstraintCommand';
import { useAppStore } from '../../store/useAppStore';

const mkPart = () => ({
  id: 'P1', name: 'Part1', units: 'mm' as const, parameters: {}, properties: {},
  featureTree: [{ kind: 'sketch' as const, id: 'S1', plane: { source: 'workPlane', featureId: 'origin.XY' } as const, primitives: [], constraints: [] }]
});

describe('AddConstraintCommand / RemoveConstraintCommand', () => {
  it('AddConstraintCommand.apply appends; revert removes', async () => {
    useAppStore.getState().setActivePart(mkPart());
    const c: SketchConstraint = { id: 'c1', kind: 'horizontal', line: 'L1' };
    const cmd = new AddConstraintCommand('S1', c);
    await cmd.apply();
    expect((useAppStore.getState().activePart!.featureTree[0] as { constraints: SketchConstraint[] }).constraints).toHaveLength(1);
    await cmd.revert();
    expect((useAppStore.getState().activePart!.featureTree[0] as { constraints: SketchConstraint[] }).constraints).toHaveLength(0);
  });

  it('RemoveConstraintCommand.apply removes; revert re-adds', async () => {
    const c: SketchConstraint = { id: 'c1', kind: 'horizontal', line: 'L1' };
    useAppStore.getState().setActivePart({
      ...mkPart(),
      featureTree: [{ kind: 'sketch', id: 'S1', plane: { source: 'workPlane', featureId: 'origin.XY' }, primitives: [], constraints: [c] }]
    });
    const cmd = new RemoveConstraintCommand('S1', c);
    await cmd.apply();
    expect((useAppStore.getState().activePart!.featureTree[0] as { constraints: SketchConstraint[] }).constraints).toHaveLength(0);
    await cmd.revert();
    expect((useAppStore.getState().activePart!.featureTree[0] as { constraints: SketchConstraint[] }).constraints).toHaveLength(1);
  });
});
