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

  it('is a named, undoable Command', () => {
    const cmd = new RenumberCutListCommand({ result: { rows: [], bandTotals: [], excluded: { componentCount: 0, partCount: 0 } } });
    expect(cmd.name).toBe('RenumberCutList');
    expect(typeof cmd.revert).toBe('function');
  });

  it('revert restores the exact prior numbering, including keys dropped by renumber', async () => {
    useAppStore.setState({
      activeAssembly: {
        id: 'A', name: 'A', units: 'mm', parameters: {}, properties: {},
        components: [], constraints: [], groundedComponentPaths: [],
        colors: {}, bomItemNumbers: {},
        // Prior map has a stale key ('k-gone') that won't appear in the new
        // result's rows at all, plus a key that will be renumbered.
        cutListItemNumbers: { 'k-gone': 7, 'k-oak': 42 },
        colorOverrides: {}, materials: [],
      },
    } as any);
    const result: CutListResult = {
      rows: [
        { rowKey: 'k-oak', itemNumber: 99, qty: 1, length: 600, width: 400, thickness: 18, materialId: 'm-oak', materialName: 'Oak', grain: 'length', edgeBands: { front: null, back: null, left: null, right: null }, partPath: 'p', partName: 'P', componentPathKeys: [] },
      ],
      bandTotals: [],
      excluded: { componentCount: 0, partCount: 0 },
    };
    const cmd = new RenumberCutListCommand({ result });
    await cmd.apply();
    // Apply replaced the whole map — the stale key is gone.
    expect(useAppStore.getState().activeAssembly!.cutListItemNumbers).toEqual({ 'k-oak': 1 });

    await cmd.revert();
    expect(useAppStore.getState().activeAssembly!.cutListItemNumbers).toEqual({ 'k-gone': 7, 'k-oak': 42 });
  });

  it('revert no-ops when apply itself no-op\'d (activeAssembly was null)', async () => {
    useAppStore.setState({ activeAssembly: null });
    const cmd = new RenumberCutListCommand({ result: { rows: [], bandTotals: [], excluded: { componentCount: 0, partCount: 0 } } });
    await cmd.apply();
    await cmd.revert();
    expect(useAppStore.getState().activeAssembly).toBeNull();
  });
});
