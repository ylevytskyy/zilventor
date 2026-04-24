import { describe, it, expect } from 'vitest';
import { AddDimensionCommand } from '../AddDimensionCommand';
import { RemoveDimensionCommand } from '../RemoveDimensionCommand';
import { UpdateDimensionValueCommand } from '../UpdateDimensionValueCommand';
import { useAppStore } from '../../store/useAppStore';

const resetStore = () =>
  useAppStore.getState().setActivePart({
    id: 'P1', name: 'P', units: 'mm', parameters: {},
    featureTree: [{ kind: 'sketch', id: 'S1', plane: 'XY', primitives: [], constraints: [] }]
  });

describe('dimension commands', () => {
  it('AddDimensionCommand.apply adds, revert removes', async () => {
    resetStore();
    const cmd = new AddDimensionCommand('S1', {
      id: 'd0', kind: 'dim-length', paramName: 'd0', line: 'L1',
      value: { kind: 'literal', value: 50 }
    });
    await cmd.apply();
    expect((useAppStore.getState().activePart!.featureTree[0] as { constraints: unknown[] }).constraints).toHaveLength(1);
    await cmd.revert();
    expect((useAppStore.getState().activePart!.featureTree[0] as { constraints: unknown[] }).constraints).toHaveLength(0);
  });

  it('RemoveDimensionCommand.apply removes, revert re-adds', async () => {
    resetStore();
    const snapshot = {
      id: 'd0', kind: 'dim-length' as const, paramName: 'd0', line: 'L1',
      value: { kind: 'literal' as const, value: 50 }
    };
    useAppStore.getState().addDimensionToActiveSketch('S1', snapshot);
    const cmd = new RemoveDimensionCommand('S1', snapshot);
    await cmd.apply();
    expect((useAppStore.getState().activePart!.featureTree[0] as { constraints: unknown[] }).constraints).toHaveLength(0);
    await cmd.revert();
    expect((useAppStore.getState().activePart!.featureTree[0] as { constraints: unknown[] }).constraints).toHaveLength(1);
  });

  it('UpdateDimensionValueCommand.apply/revert swaps value', async () => {
    resetStore();
    useAppStore.getState().addDimensionToActiveSketch('S1', {
      id: 'd0', kind: 'dim-length', paramName: 'd0', line: 'L1',
      value: { kind: 'literal', value: 50 }
    });
    const cmd = new UpdateDimensionValueCommand('S1', 'd0', 50, 100);
    await cmd.apply();
    const after = (useAppStore.getState().activePart!.featureTree[0] as { constraints: Array<{ value: { value: number } }> }).constraints[0]!.value.value;
    expect(after).toBe(100);
    await cmd.revert();
    const reverted = (useAppStore.getState().activePart!.featureTree[0] as { constraints: Array<{ value: { value: number } }> }).constraints[0]!.value.value;
    expect(reverted).toBe(50);
  });
});
