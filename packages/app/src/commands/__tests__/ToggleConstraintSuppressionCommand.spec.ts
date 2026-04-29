import { describe, it, expect, beforeEach } from 'vitest';
import { ToggleConstraintSuppressionCommand } from '../ToggleConstraintSuppressionCommand';
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

describe('ToggleConstraintSuppressionCommand', () => {
  it('apply flips suppressed to true', async () => {
    const cmd = new ToggleConstraintSuppressionCommand({ id: 'k1' });
    await cmd.apply();
    expect(useAppStore.getState().activeAssembly!.constraints[0]!.suppressed).toBe(true);
  });
  it('revert flips suppressed back to false', async () => {
    const cmd = new ToggleConstraintSuppressionCommand({ id: 'k1' });
    await cmd.apply();
    await cmd.revert();
    expect(useAppStore.getState().activeAssembly!.constraints[0]!.suppressed).toBe(false);
  });
});
