import { describe, it, expect, beforeEach } from 'vitest';
import { EditAssemblyConstraintCommand } from '../EditAssemblyConstraintCommand';
import { useAppStore } from '../../store/useAppStore';

beforeEach(() => {
  useAppStore.setState({
    activeAssembly: {
      id: 'A', name: 'a', units: 'mm', parameters: {}, components: [], groundedComponentPaths: [],
      constraints: [{ id: 'k1', kind: 'mate', suppressed: false, refA: {} as any, refB: {} as any, offset: { kind: 'literal', value: 0 } as any } as any],
    } as any,
    activeDocument: { kind: 'assembly', document: {} as any },
  });
});

describe('EditAssemblyConstraintCommand', () => {
  it('apply updates fields; revert restores prior', async () => {
    const cmd = new EditAssemblyConstraintCommand({ id: 'k1', patch: { offset: { kind: 'literal', value: 10 } as any } });
    await cmd.apply();
    const c = useAppStore.getState().activeAssembly!.constraints[0] as any;
    expect(c.offset.value).toBe(10);
    await cmd.revert();
    const c2 = useAppStore.getState().activeAssembly!.constraints[0] as any;
    expect(c2.offset.value).toBe(0);
  });
});
