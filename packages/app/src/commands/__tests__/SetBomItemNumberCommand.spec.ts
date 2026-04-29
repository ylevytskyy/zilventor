import { describe, it, expect } from 'vitest';
import { SetBomItemNumberCommand } from '../SetBomItemNumberCommand';
import { useAppStore } from '../../store/useAppStore';

describe('SetBomItemNumberCommand', () => {
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
});
