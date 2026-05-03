import { describe, expect, it } from 'vitest';
import { mergeAndPruneCutList } from '../mergeCutListItemNumbers';
import type { AssemblyDocument } from '@zilventor/shared';
import type { CutListResult } from '@zilventor/shared/src/cutListRow';

const baseResult = (): CutListResult => ({
  rows: [
    { rowKey: 'k-live', itemNumber: 4, qty: 1, length: 600, width: 400, thickness: 18, materialId: 'm', materialName: 'M', grain: 'length', edgeBands: { front: null, back: null, left: null, right: null }, partPath: 'p', partName: 'P', componentPathKeys: [] },
  ],
  bandTotals: [],
  excluded: { componentCount: 0, partCount: 0 },
});

const baseAsm = (): AssemblyDocument => ({
  id: 'a', name: 'A', units: 'mm',
  parameters: {}, components: [], constraints: [],
  groundedComponentPaths: [], colors: {},
  bomItemNumbers: {}, cutListItemNumbers: { 'k-live': 4, 'k-stale': 9 },
  colorOverrides: {},
} as unknown as AssemblyDocument);

describe('mergeAndPruneCutList', () => {
  it('merges resolved item numbers from the result', () => {
    const result = baseResult();
    result.rows[0]!.itemNumber = 5; // resolved value differs from stored
    const a = baseAsm();
    const out = mergeAndPruneCutList(a, result, { cacheComplete: true });
    expect(out.cutListItemNumbers['k-live']).toBe(5);
  });

  it('prunes orphan keys when cacheComplete=true', () => {
    const out = mergeAndPruneCutList(baseAsm(), baseResult(), { cacheComplete: true });
    expect(out.cutListItemNumbers).not.toHaveProperty('k-stale');
  });

  it('preserves orphan keys when cacheComplete=false (cache incomplete)', () => {
    const out = mergeAndPruneCutList(baseAsm(), baseResult(), { cacheComplete: false });
    expect(out.cutListItemNumbers['k-stale']).toBe(9);
  });

  it('does not mutate the input assembly', () => {
    const a = baseAsm();
    const before = { ...a.cutListItemNumbers };
    mergeAndPruneCutList(a, baseResult(), { cacheComplete: true });
    expect(a.cutListItemNumbers).toEqual(before);
  });
});
