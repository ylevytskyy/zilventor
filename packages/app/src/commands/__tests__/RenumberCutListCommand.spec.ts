import { describe, expect, it } from 'vitest';
import { RenumberCutListCommand } from '../RenumberCutListCommand';
import { useAppStore } from '../../store/useAppStore';
import type { CutListResult } from '@zilventor/shared/src/cutListRow';

describe('RenumberCutListCommand', () => {
  it('writes 1..N keyed by sort-order rowKeys', async () => {
    useAppStore.setState({
      activeAssembly: {
        id: 'A', name: 'A', units: 'mm', parameters: {}, properties: {},
        components: [], constraints: [], groundedComponentPaths: [],
        colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {}, materials: [],
      },
    } as any);
    const result: CutListResult = {
      rows: [
        { rowKey: 'k-oak', itemNumber: 99, qty: 1, length: 600, width: 400, thickness: 18, materialId: 'm-oak', materialName: 'Oak', grain: 'length', edgeBands: { front: null, back: null, left: null, right: null }, partPath: 'p', partName: 'P', componentPathKeys: [] },
        { rowKey: 'k-birch-large', itemNumber: 99, qty: 1, length: 800, width: 400, thickness: 18, materialId: 'm-birch', materialName: 'Birch', grain: 'length', edgeBands: { front: null, back: null, left: null, right: null }, partPath: 'p', partName: 'P', componentPathKeys: [] },
        { rowKey: 'k-birch-small', itemNumber: 99, qty: 1, length: 600, width: 400, thickness: 18, materialId: 'm-birch', materialName: 'Birch', grain: 'length', edgeBands: { front: null, back: null, left: null, right: null }, partPath: 'p', partName: 'P', componentPathKeys: [] },
      ],
      bandTotals: [],
      excluded: { componentCount: 0, partCount: 0 },
    };
    await new RenumberCutListCommand({ result }).apply();
    const m = useAppStore.getState().activeAssembly!.cutListItemNumbers;
    // Sort: materialName ASC (Birch < Oak), then length DESC.
    expect(m['k-birch-large']).toBe(1);
    expect(m['k-birch-small']).toBe(2);
    expect(m['k-oak']).toBe(3);
  });

  it('no-ops when activeAssembly is null', async () => {
    useAppStore.setState({ activeAssembly: null });
    await new RenumberCutListCommand({ result: { rows: [], bandTotals: [], excluded: { componentCount: 0, partCount: 0 } } }).apply();
    expect(useAppStore.getState().activeAssembly).toBeNull();
  });
});
