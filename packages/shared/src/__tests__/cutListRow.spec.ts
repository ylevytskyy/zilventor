import { describe, expect, it } from 'vitest';
import { cutListRowKey, normalizeLW, aggregateCutListLocal } from '../cutListRow';
import type { PanelSpec } from '../panel-feature';
import type { ComponentInstance, AssemblyDocument } from '../types';
import type { MaterialEntry } from '../material';

const baseSpec = (overrides: Partial<PanelSpec> = {}): PanelSpec => ({
  length: 600,
  width: 400,
  thickness: 18,
  materialId: 'm-birch',
  grain: 'length',
  edgeBands: { front: null, back: null, left: null, right: null },
  ...overrides,
});

describe('normalizeLW', () => {
  it('preserves L/W when grain = length', () => {
    expect(normalizeLW(baseSpec({ grain: 'length', length: 400, width: 600 }))).toEqual({ L: 400, W: 600 });
  });

  it('preserves L/W when grain = width', () => {
    expect(normalizeLW(baseSpec({ grain: 'width', length: 400, width: 600 }))).toEqual({ L: 400, W: 600 });
  });

  it('swaps so L >= W when grain = none', () => {
    expect(normalizeLW(baseSpec({ grain: 'none', length: 400, width: 600 }))).toEqual({ L: 600, W: 400 });
    expect(normalizeLW(baseSpec({ grain: 'none', length: 600, width: 400 }))).toEqual({ L: 600, W: 400 });
  });
});

describe('cutListRowKey', () => {
  it('produces identical keys for identical (L,W,T,M,G)', () => {
    const a = cutListRowKey(baseSpec(), { L: 600, W: 400 });
    const b = cutListRowKey(baseSpec(), { L: 600, W: 400 });
    expect(a).toBe(b);
  });

  it('different thickness yields different keys', () => {
    const a = cutListRowKey(baseSpec({ thickness: 18 }), { L: 600, W: 400 });
    const b = cutListRowKey(baseSpec({ thickness: 19 }), { L: 600, W: 400 });
    expect(a).not.toBe(b);
  });

  it('different grain yields different keys', () => {
    const a = cutListRowKey(baseSpec({ grain: 'length' }), { L: 600, W: 400 });
    const b = cutListRowKey(baseSpec({ grain: 'width' }), { L: 600, W: 400 });
    expect(a).not.toBe(b);
  });

  it('different materialId yields different keys', () => {
    const a = cutListRowKey(baseSpec({ materialId: 'm-birch' }), { L: 600, W: 400 });
    const b = cutListRowKey(baseSpec({ materialId: 'm-oak' }), { L: 600, W: 400 });
    expect(a).not.toBe(b);
  });

  it('key shape is disjoint from bomRowKey', () => {
    const cut = cutListRowKey(baseSpec(), { L: 600, W: 400 });
    expect(cut.startsWith('L=')).toBe(true);
    expect(cut.includes('::')).toBe(false);
  });
});

describe('aggregateCutListLocal', () => {
  const materials: MaterialEntry[] = [
    { id: 'm-birch', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' },
    { id: 'm-pvc', name: 'PVC 1mm white', defaultThickness: 1, color: '#ffffff' },
  ];

  const cmp = (id: string, partPath: string): ComponentInstance => ({
    id,
    partPath,
    position: { x: 0, y: 0, z: 0 },
    rotation: { rx: 0, ry: 0, rz: 0 },
    visible: true,
  });

  const emptyAsm = (components: ComponentInstance[] = []): AssemblyDocument => ({
    id: 'a1',
    name: 'A',
    units: 'mm',
    parameters: {},
    components,
    constraints: [],
    groundedComponentPaths: [],
    colors: {},
    bomItemNumbers: {},
    cutListItemNumbers: {},
    colorOverrides: {},
  } as unknown as AssemblyDocument);

  const specs = (entries: Array<[string, PanelSpec | null]>): Map<string, PanelSpec | null> => new Map(entries);

  it('groups two identical-spec panels into one row of QTY 2', () => {
    const asm = emptyAsm([cmp('c1', 'p/a.zipt'), cmp('c2', 'p/a.zipt')]);
    const map = specs([['p/a.zipt', baseSpec()]]);
    const result = aggregateCutListLocal(asm, map, materials);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.qty).toBe(2);
    expect(result.rows[0]!.materialName).toBe('Birch 18mm');
    expect(result.excluded).toEqual({ componentCount: 0, partCount: 0 });
  });

  it('splits rows by spec dimensions', () => {
    const asm = emptyAsm([cmp('c1', 'p/a.zipt'), cmp('c2', 'p/b.zipt')]);
    const map = specs([
      ['p/a.zipt', baseSpec()],
      ['p/b.zipt', baseSpec({ length: 800 })],
    ]);
    const result = aggregateCutListLocal(asm, map, materials);
    expect(result.rows).toHaveLength(2);
  });

  it('counts non-panel parts as exclusions', () => {
    const asm = emptyAsm([cmp('c1', 'p/a.zipt'), cmp('c2', 'p/x.zipt'), cmp('c3', 'p/x.zipt')]);
    const map = specs([
      ['p/a.zipt', baseSpec()],
      ['p/x.zipt', null],
    ]);
    const result = aggregateCutListLocal(asm, map, materials);
    expect(result.rows).toHaveLength(1);
    expect(result.excluded).toEqual({ componentCount: 2, partCount: 1 });
  });

  it('grain=none with swapped L/W merges to one row', () => {
    const asm = emptyAsm([cmp('c1', 'p/a.zipt'), cmp('c2', 'p/b.zipt')]);
    const map = specs([
      ['p/a.zipt', baseSpec({ grain: 'none', length: 600, width: 400 })],
      ['p/b.zipt', baseSpec({ grain: 'none', length: 400, width: 600 })],
    ]);
    const result = aggregateCutListLocal(asm, map, materials);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.qty).toBe(2);
    expect(result.rows[0]!.length).toBe(600);
    expect(result.rows[0]!.width).toBe(400);
  });

  it('grain=length with swapped L/W stays as two rows', () => {
    const asm = emptyAsm([cmp('c1', 'p/a.zipt'), cmp('c2', 'p/b.zipt')]);
    const map = specs([
      ['p/a.zipt', baseSpec({ grain: 'length', length: 600, width: 400 })],
      ['p/b.zipt', baseSpec({ grain: 'length', length: 400, width: 600 })],
    ]);
    const result = aggregateCutListLocal(asm, map, materials);
    expect(result.rows).toHaveLength(2);
  });

  it('broken material yields (missing material) and still emits the row', () => {
    const asm = emptyAsm([cmp('c1', 'p/a.zipt')]);
    const map = specs([['p/a.zipt', baseSpec({ materialId: 'm-ghost' })]]);
    const result = aggregateCutListLocal(asm, map, materials);
    expect(result.rows[0]!.materialName).toBe('(missing material)');
  });

  it('computes band totals: front+back use length, left+right use width, weighted by qty', () => {
    const asm = emptyAsm([cmp('c1', 'p/a.zipt'), cmp('c2', 'p/a.zipt'), cmp('c3', 'p/a.zipt')]);
    const map = specs([['p/a.zipt', baseSpec({
      length: 600,
      width: 400,
      edgeBands: {
        front: { materialId: 'm-pvc' },
        back: { materialId: 'm-pvc' },
        left: null,
        right: null,
      },
    })]]);
    const result = aggregateCutListLocal(asm, map, materials);
    expect(result.bandTotals).toHaveLength(1);
    expect(result.bandTotals[0]!.materialName).toBe('PVC 1mm white');
    expect(result.bandTotals[0]!.totalLengthMm).toBe(600 * 2 * 3);
  });

  it('left/right band uses width', () => {
    const asm = emptyAsm([cmp('c1', 'p/a.zipt')]);
    const map = specs([['p/a.zipt', baseSpec({
      length: 600,
      width: 400,
      edgeBands: {
        front: null,
        back: null,
        left: { materialId: 'm-pvc' },
        right: { materialId: 'm-pvc' },
      },
    })]]);
    const result = aggregateCutListLocal(asm, map, materials);
    expect(result.bandTotals[0]!.totalLengthMm).toBe(400 * 2);
  });

  it('reuses stored item numbers and assigns max+1 for new rows', () => {
    const asm = emptyAsm([cmp('c1', 'p/a.zipt'), cmp('c2', 'p/b.zipt')]);
    const map = specs([
      ['p/a.zipt', baseSpec()],
      ['p/b.zipt', baseSpec({ length: 800 })],
    ]);
    const knownKey = cutListRowKey(baseSpec(), { L: 600, W: 400 });
    asm.cutListItemNumbers = { [knownKey]: 7 };
    const result = aggregateCutListLocal(asm, map, materials);
    const knownRow = result.rows.find(r => r.rowKey === knownKey);
    const newRow = result.rows.find(r => r.rowKey !== knownKey);
    expect(knownRow!.itemNumber).toBe(7);
    expect(newRow!.itemNumber).toBe(8);
  });

  it('empty assembly returns empty result', () => {
    const result = aggregateCutListLocal(emptyAsm(), specs([]), materials);
    expect(result).toEqual({
      rows: [],
      bandTotals: [],
      excluded: { componentCount: 0, partCount: 0 },
    });
  });
});
