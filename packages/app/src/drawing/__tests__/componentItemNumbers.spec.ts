import { describe, it, expect } from 'vitest';
import type { AssemblyDocument, PartInfo } from '@zilventor/shared';
import { pathKey } from '@zilventor/shared';
import { itemNumberByComponentPath, representativePathByItem } from '../componentItemNumbers';
import type { BomRow } from '@zilventor/shared/src/bomRow';
import { aggregateBomRecursive } from '../../assembly/walkers/aggregateBomRecursive';
import type { SubAssemblyCache } from '../../assembly/SubAssemblyCache';

const rows: BomRow[] = [
  { rowKey: 'p1::none', itemNumber: 1, qty: 2, partPath: 'p1', partName: 'A',
    color: undefined, componentIds: ['c1', 'c2'] },
  { rowKey: 'p2::none', itemNumber: 2, qty: 1, partPath: 'p2', partName: 'B',
    color: undefined, componentIds: ['c3'] },
];

describe('componentItemNumbers', () => {
  it('maps every component path to its row item number', () => {
    const m = itemNumberByComponentPath(rows);
    expect(m.get('c1')).toBe(1);
    expect(m.get('c2')).toBe(1);
    expect(m.get('c3')).toBe(2);
    expect(m.get('nope')).toBeUndefined();
  });

  it('maps each item number to its first representative path', () => {
    const m = representativePathByItem(rows);
    expect(m.get(1)).toBe('c1');
    expect(m.get(2)).toBe('c3');
  });

  it('handles empty rows without error', () => {
    expect(itemNumberByComponentPath([])).toEqual(new Map());
    expect(representativePathByItem([])).toEqual(new Map());
  });

  it('representativePathByItem keeps the FIRST path when multiple componentIds share an itemNumber', () => {
    const m = representativePathByItem(rows);
    // row itemNumber=1 has componentIds ['c1','c2'] — first is 'c1'
    expect(m.get(1)).toBe('c1');
  });

  it('nested .ziasm leaf paths appear in the map (same key space as projection)', () => {
    // Build a fixture with one nested .ziasm: top doc has component 'sub-1' pointing to 'drawer.ziasm',
    // drawer.ziasm contains leaf component 'leaf-1' pointing to 'panel.zipt'.
    // aggregateBomRecursive will produce componentIds containing pathKey(['sub-1','leaf-1']).
    const leafDoc: AssemblyDocument = {
      id: 'drawer', name: 'Drawer', units: 'mm', parameters: {}, constraints: [],
      groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, cutListItemNumbers: {},
      colorOverrides: {}, properties: {}, materials: [], hardware: [],
      components: [
        { id: 'leaf-1', partPath: 'panel.zipt',
          position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
    };
    const topDoc: AssemblyDocument = {
      id: 'top', name: 'Top', units: 'mm', parameters: {}, constraints: [],
      groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, cutListItemNumbers: {},
      colorOverrides: {}, properties: {}, materials: [], hardware: [],
      components: [
        { id: 'sub-1', partPath: 'drawer.ziasm',
          position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
    };
    const cacheMap = new Map<string, AssemblyDocument>([['drawer.ziasm', leafDoc]]);
    const cache: Pick<SubAssemblyCache, 'get'> = {
      get: (p: string) => cacheMap.has(p) ? { kind: 'ok', doc: cacheMap.get(p)!, partPath: p } : undefined,
    };
    const partInfo = new Map<string, PartInfo>([['panel.zipt', { name: 'Panel' }]]);

    const bomRows = aggregateBomRecursive(topDoc, cache, partInfo);
    const m = itemNumberByComponentPath(bomRows);

    // pathKey(['sub-1', 'leaf-1']) is the key that aggregateBomRecursive emits for the nested leaf
    expect(m.has(pathKey(['sub-1', 'leaf-1']))).toBe(true);
  });
});
