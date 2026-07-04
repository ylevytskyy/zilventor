import { describe, it, expect } from 'vitest';
import { SetBomItemNumberCommand } from '../SetBomItemNumberCommand';
import { useAppStore } from '../../store/useAppStore';

describe('SetBomItemNumberCommand', () => {
  it('has a stable command name', () => {
    expect(new SetBomItemNumberCommand({ rowKey: 'rowA', n: 1 }).name).toBe('SetBomItemNumber');
  });

  it('routes through store conflict-bump', async () => {
    useAppStore.setState({
      activeAssembly: {
        id: 'A', name: 'A', units: 'mm', parameters: {},
        components: [], constraints: [], groundedComponentPaths: [],
        colors: {}, bomItemNumbers: { rowA: 1, rowB: 2 },
      },
    } as any);
    await new SetBomItemNumberCommand({ rowKey: 'rowA', n: 2 }).apply();
    const map = useAppStore.getState().activeAssembly!.bomItemNumbers;
    expect(map.rowA).toBe(2);
    expect(map.rowB).toBe(3);
  });

  it('revert() restores the exact prior map, including a bumped collision partner', async () => {
    useAppStore.setState({
      activeAssembly: {
        id: 'A', name: 'A', units: 'mm', parameters: {},
        components: [], constraints: [], groundedComponentPaths: [],
        colors: {}, bomItemNumbers: { rowA: 1, rowB: 2 },
      },
    } as any);
    const cmd = new SetBomItemNumberCommand({ rowKey: 'rowA', n: 2 });
    await cmd.apply();
    const map = useAppStore.getState().activeAssembly!.bomItemNumbers;
    expect(map.rowA).toBe(2);
    expect(map.rowB).toBe(3); // bumped by the conflict-avoidance side effect
    await cmd.revert();
    const restored = useAppStore.getState().activeAssembly!.bomItemNumbers;
    expect(restored).toEqual({ rowA: 1, rowB: 2 });
  });
});
