import { describe, expect, it } from 'vitest';
import { aggregateCutListRecursive } from '../aggregateCutListRecursive';
import type { AssemblyDocument, ComponentInstance } from '@zilventor/shared';
import type { PanelSpec } from '@zilventor/shared/src/panel-feature';
import type { MaterialEntry } from '@zilventor/shared/src/material';

const MAT: MaterialEntry[] = [
  { id: 'm-birch', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' },
];

const SPEC = (overrides: Partial<PanelSpec> = {}): PanelSpec => ({
  length: 600,
  width: 400,
  thickness: 18,
  materialId: 'm-birch',
  grain: 'length',
  edgeBands: { front: null, back: null, left: null, right: null },
  ...overrides,
});

const cmp = (id: string, partPath: string): ComponentInstance => ({
  id, partPath,
  position: { x: 0, y: 0, z: 0 },
  rotation: { rx: 0, ry: 0, rz: 0 },
  visible: true,
});

const asm = (id: string, components: ComponentInstance[]): AssemblyDocument => ({
  id, name: id, units: 'mm',
  parameters: {}, components, constraints: [],
  groundedComponentPaths: [],
  colors: {}, bomItemNumbers: {}, cutListItemNumbers: {},
  colorOverrides: {},
} as unknown as AssemblyDocument);

const cacheOf = (entries: Array<[string, AssemblyDocument]>) => ({
  get: (path: string) => {
    const found = entries.find(([p]) => p === path);
    return found ? { kind: 'ok' as const, doc: found[1], partPath: path } : undefined;
  },
});

const partInfoOf = (entries: Array<[string, string]>) =>
  new Map(entries.map(([k, v]) => [k, { name: v }]));

describe('aggregateCutListRecursive', () => {
  it('flat assembly: 2 panels (1 pair, 1 distinct) + 1 non-panel', () => {
    const a = asm('a', [
      cmp('c1', 'p/a.zipt'),
      cmp('c2', 'p/a.zipt'),
      cmp('c3', 'p/b.zipt'),
      cmp('c4', 'p/x.zipt'),
    ]);
    const specs = new Map<string, PanelSpec | null>([
      ['p/a.zipt', SPEC()],
      ['p/b.zipt', SPEC({ length: 800 })],
      ['p/x.zipt', null],
    ]);
    const result = aggregateCutListRecursive(a, cacheOf([]), specs, MAT, partInfoOf([]));
    expect(result.rows).toHaveLength(2);
    expect(result.rows.find(r => r.length === 600)!.qty).toBe(2);
    expect(result.rows.find(r => r.length === 800)!.qty).toBe(1);
    expect(result.excluded).toEqual({ componentCount: 1, partCount: 1 });
  });

  it('two-level recursion: outer with 2 inner instances; inner has 2 panels', () => {
    const inner = asm('inner', [cmp('p1', 'p/a.zipt'), cmp('p2', 'p/b.zipt')]);
    const outer = asm('outer', [
      cmp('s1', 'sub/inner.ziasm'),
      cmp('s2', 'sub/inner.ziasm'),
    ]);
    const specs = new Map<string, PanelSpec | null>([
      ['p/a.zipt', SPEC()],
      ['p/b.zipt', SPEC({ length: 800 })],
    ]);
    const result = aggregateCutListRecursive(
      outer,
      cacheOf([['sub/inner.ziasm', inner]]),
      specs,
      MAT,
      partInfoOf([]),
    );
    expect(result.rows).toHaveLength(2);
    expect(result.rows.find(r => r.length === 600)!.qty).toBe(2);
    expect(result.rows.find(r => r.length === 800)!.qty).toBe(2);
  });

  it('three-level recursion: componentPathKeys carries the full path', () => {
    const leaf = asm('leaf', [cmp('p1', 'p/a.zipt')]);
    const mid = asm('mid', [cmp('m1', 'sub/leaf.ziasm')]);
    const top = asm('top', [cmp('t1', 'sub/mid.ziasm')]);
    const specs = new Map<string, PanelSpec | null>([['p/a.zipt', SPEC()]]);
    const result = aggregateCutListRecursive(
      top,
      cacheOf([['sub/mid.ziasm', mid], ['sub/leaf.ziasm', leaf]]),
      specs, MAT, partInfoOf([]),
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.componentPathKeys).toHaveLength(1);
    expect(result.rows[0]!.componentPathKeys[0]!).toContain('t1');
    expect(result.rows[0]!.componentPathKeys[0]!).toContain('m1');
    expect(result.rows[0]!.componentPathKeys[0]!).toContain('p1');
  });

  it('mixed grain: grain=none with swapped L/W merges; grain=length does not', () => {
    const a = asm('a', [
      cmp('c1', 'p/a.zipt'),
      cmp('c2', 'p/b.zipt'),
      cmp('c3', 'p/c.zipt'),
      cmp('c4', 'p/d.zipt'),
    ]);
    const specs = new Map<string, PanelSpec | null>([
      ['p/a.zipt', SPEC({ grain: 'none', length: 600, width: 400 })],
      ['p/b.zipt', SPEC({ grain: 'none', length: 400, width: 600 })],
      ['p/c.zipt', SPEC({ grain: 'length', length: 600, width: 400 })],
      ['p/d.zipt', SPEC({ grain: 'length', length: 400, width: 600 })],
    ]);
    const result = aggregateCutListRecursive(a, cacheOf([]), specs, MAT, partInfoOf([]));
    expect(result.rows).toHaveLength(3); // grain=none merges 2 into 1; grain=length stays 2
  });

  it('broken material: row emits with (missing material)', () => {
    const a = asm('a', [cmp('c1', 'p/a.zipt')]);
    const specs = new Map<string, PanelSpec | null>([['p/a.zipt', SPEC({ materialId: 'm-ghost' })]]);
    const result = aggregateCutListRecursive(a, cacheOf([]), specs, MAT, partInfoOf([]));
    expect(result.rows[0]!.materialName).toBe('(missing material)');
  });

  it('all non-panel: zero rows + accurate exclusion counts', () => {
    const a = asm('a', [cmp('c1', 'p/x.zipt'), cmp('c2', 'p/x.zipt'), cmp('c3', 'p/y.zipt')]);
    const specs = new Map<string, PanelSpec | null>([['p/x.zipt', null], ['p/y.zipt', null]]);
    const result = aggregateCutListRecursive(a, cacheOf([]), specs, MAT, partInfoOf([]));
    expect(result.rows).toHaveLength(0);
    expect(result.excluded).toEqual({ componentCount: 3, partCount: 2 });
  });

  it('empty assembly returns empty result', () => {
    const result = aggregateCutListRecursive(asm('a', []), cacheOf([]), new Map(), MAT, partInfoOf([]));
    expect(result).toEqual({
      rows: [],
      bandTotals: [],
      excluded: { componentCount: 0, partCount: 0 },
    });
  });
});
