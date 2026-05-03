import { describe, it, expect } from 'vitest';
import { SetCutListItemNumberCommand } from '../SetCutListItemNumberCommand';
import { useAppStore } from '../../store/useAppStore';

describe('SetCutListItemNumberCommand', () => {
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
});
