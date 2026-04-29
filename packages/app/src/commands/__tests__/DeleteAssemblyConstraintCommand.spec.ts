import { describe, it, expect, beforeEach } from 'vitest';
import { DeleteAssemblyConstraintCommand } from '../DeleteAssemblyConstraintCommand';
import { useAppStore } from '../../store/useAppStore';

const constraint = { id: 'k1', kind: 'mate', suppressed: false, refA: {} as any, refB: {} as any, offset: { kind: 'literal', value: 0 } as any } as any;

beforeEach(() => {
  useAppStore.setState({
    activeAssembly: {
      id: 'A', name: 'a', units: 'mm', parameters: {}, components: [], groundedComponentPaths: [],
      constraints: [{ ...constraint }],
    } as any,
    activeDocument: { kind: 'assembly', document: {} as any },
    solverDirty: false,
  });
});

describe('DeleteAssemblyConstraintCommand', () => {
  it('apply removes the constraint', async () => {
    const cmd = new DeleteAssemblyConstraintCommand({ id: 'k1' });
    await cmd.apply();
    expect(useAppStore.getState().activeAssembly!.constraints).toHaveLength(0);
  });
  it('revert re-adds the constraint', async () => {
    const cmd = new DeleteAssemblyConstraintCommand({ id: 'k1' });
    await cmd.apply();
    await cmd.revert();
    expect(useAppStore.getState().activeAssembly!.constraints).toHaveLength(1);
    expect(useAppStore.getState().activeAssembly!.constraints[0]!.id).toBe('k1');
  });
});
