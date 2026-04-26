import { describe, it, expect, beforeEach } from 'vitest';
import { AddAssemblyConstraintCommand } from '../AddAssemblyConstraintCommand';
import { useAppStore } from '../../store/useAppStore';

beforeEach(() => {
  useAppStore.setState({
    activeAssembly: { id: 'A', name: 'a', units: 'mm', parameters: {}, components: [], constraints: [], groundedComponentIds: [] } as any,
    activeDocument: { kind: 'assembly', document: { id: 'A', name: 'a', units: 'mm', parameters: {}, components: [], constraints: [], groundedComponentIds: [] } as any },
    solverDirty: false,
  });
});

describe('AddAssemblyConstraintCommand', () => {
  it('apply adds constraint and sets solverDirty', async () => {
    const c = { id: 'k1', kind: 'mate', suppressed: false, refA: {} as any, refB: {} as any, offset: { kind: 'literal', value: 0 } as any } as any;
    const cmd = new AddAssemblyConstraintCommand({ constraint: c });
    await cmd.apply();
    expect(useAppStore.getState().activeAssembly!.constraints).toHaveLength(1);
    expect(useAppStore.getState().solverDirty).toBe(true);
  });
  it('revert removes the constraint', async () => {
    const c = { id: 'k1', kind: 'mate', suppressed: false, refA: {} as any, refB: {} as any, offset: { kind: 'literal', value: 0 } as any } as any;
    const cmd = new AddAssemblyConstraintCommand({ constraint: c });
    await cmd.apply();
    await cmd.revert();
    expect(useAppStore.getState().activeAssembly!.constraints).toHaveLength(0);
  });
});
