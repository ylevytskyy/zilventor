import { describe, it, expect } from 'vitest';
import { SetCutListItemNumberCommand } from '../SetCutListItemNumberCommand';
import { useAppStore } from '../../store/useAppStore';

describe('SetCutListItemNumberCommand', () => {
  it('has a stable command name', () => {
    expect(new SetCutListItemNumberCommand({ rowKey: 'k1', n: 1 }).name).toBe('SetCutListItemNumber');
  });

  it('writes through to setCutListItemNumber', async () => {
    useAppStore.setState({
      activeAssembly: {
        id: 'A', name: 'A', units: 'mm', parameters: {}, properties: {},
        components: [], constraints: [], groundedComponentPaths: [],
        colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {}, materials: [],
      },
    } as any);
    await new SetCutListItemNumberCommand({ rowKey: 'k1', n: 7 }).apply();
    expect(useAppStore.getState().activeAssembly!.cutListItemNumbers.k1).toBe(7);
  });

  it('revert() restores the exact prior map, including a bumped collision partner', async () => {
    useAppStore.setState({
      activeAssembly: {
        id: 'A', name: 'A', units: 'mm', parameters: {}, properties: {},
        components: [], constraints: [], groundedComponentPaths: [],
        colors: {}, bomItemNumbers: {}, cutListItemNumbers: { k1: 1, k2: 2 }, colorOverrides: {}, materials: [],
      },
    } as any);
    const cmd = new SetCutListItemNumberCommand({ rowKey: 'k1', n: 2 });
    await cmd.apply();
    const map = useAppStore.getState().activeAssembly!.cutListItemNumbers;
    expect(map.k1).toBe(2);
    expect(map.k2).toBe(3); // bumped by the conflict-avoidance side effect
    await cmd.revert();
    const restored = useAppStore.getState().activeAssembly!.cutListItemNumbers;
    expect(restored).toEqual({ k1: 1, k2: 2 });
  });
});
