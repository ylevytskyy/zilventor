import { describe, expect, it } from 'vitest';
import { aggregateBoresRecursive } from '../aggregateBoresRecursive';
import type { AssemblyDocument, ComponentInstance, BoreOp, PartInfo, PanelSpec } from '@zilventor/shared';

const bore = (id: string): BoreOp => ({
  id, face: { featureId: 'panel', role: 'Top', instance: 0 }, u: 100, v: 50, diameter: 5, depth: 34,
  role: 'confirmat-face', connectorId: 'k1', connectorKind: 'confirmat',
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

const partInfoOf = (entries: Array<[string, string]>): Map<string, PartInfo> =>
  new Map(entries.map(([k, v]) => [k, { name: v }]));

describe('aggregateBoresRecursive', () => {
  it('flat assembly: groups bores per distinct part with instance qty', () => {
    const a = asm('a', [
      cmp('c1', 'p/side.zipt'),
      cmp('c2', 'p/side.zipt'),   // second instance of the same drilled part
      cmp('c3', 'p/plain.zipt'),  // part with no bores -> excluded from result
    ]);
    const partBores = new Map<string, BoreOp[]>([
      ['p/side.zipt', [bore('b1'), bore('b2')]],
      ['p/plain.zipt', []],
    ]);
    const result = aggregateBoresRecursive(
      a, cacheOf([]), partBores, partInfoOf([['p/side.zipt', 'Side']]),
    );
    expect(result.panels).toHaveLength(1);
    const g = result.panels[0]!;
    expect(g.partPath).toBe('p/side.zipt');
    expect(g.partName).toBe('Side');
    expect(g.qty).toBe(2);
    expect(g.bores.map((b) => b.id)).toEqual(['b1', 'b2']);
    expect(g.componentPathKeys).toHaveLength(2);
  });

  it('recurses into .ziasm sub-assemblies and accumulates instance qty', () => {
    const inner = asm('inner', [cmp('p1', 'p/side.zipt')]);
    const outer = asm('outer', [
      cmp('s1', 'sub/inner.ziasm'),
      cmp('s2', 'sub/inner.ziasm'),
    ]);
    const partBores = new Map<string, BoreOp[]>([['p/side.zipt', [bore('b1')]]]);
    const result = aggregateBoresRecursive(
      outer, cacheOf([['sub/inner.ziasm', inner]]), partBores, partInfoOf([]),
    );
    expect(result.panels).toHaveLength(1);
    expect(result.panels[0]!.qty).toBe(2);
    expect(result.panels[0]!.partName).toBe('(missing part)');
  });

  it('skips parts whose bores[] is empty or absent', () => {
    const a = asm('a', [cmp('c1', 'p/plain.zipt')]);
    const result = aggregateBoresRecursive(a, cacheOf([]), new Map(), partInfoOf([]));
    expect(result.panels).toHaveLength(0);
  });

  it('NESTED cabinet structure: top-level role-less .ziasm → inner sub-asm with panel parts', () => {
    // Mirrors real CreateCabinetCommand output:
    //   outer (active doc) → one role-less component 'cab.ziasm'
    //   cab.ziasm → side.zipt (has bores), back.zipt (no bores)
    const inner = asm('cabinet', [
      cmp('side1', 'parts/side.zipt'),
      cmp('back1', 'parts/back.zipt'),
    ]);
    const outer = asm('root', [cmp('cabinet-inst', 'cabinets/cab.ziasm')]);
    const partBores = new Map<string, BoreOp[]>([
      ['parts/side.zipt', [bore('b1'), bore('b2')]],
      ['parts/back.zipt', []],
    ]);
    const cache = cacheOf([['cabinets/cab.ziasm', inner]]);
    const result = aggregateBoresRecursive(
      outer, cache, partBores, partInfoOf([['parts/side.zipt', 'Side Panel']]),
    );
    // Must find the panel through 2-level recursion (outer → cab.ziasm → side.zipt)
    expect(result.panels).toHaveLength(1);
    expect(result.panels[0]!.partPath).toBe('parts/side.zipt');
    expect(result.panels[0]!.partName).toBe('Side Panel');
    expect(result.panels[0]!.qty).toBe(1);
    expect(result.panels[0]!.bores).toHaveLength(2);
  });

  it('threads PanelSpec length/width/thickness onto the panel group when a matching entry is present', () => {
    const a = asm('a', [cmp('c1', 'p/side.zipt')]);
    const partBores = new Map<string, BoreOp[]>([['p/side.zipt', [bore('b1')]]]);
    const spec = { length: 720, width: 560, thickness: 18 } as PanelSpec;
    const panelSpecs = new Map<string, PanelSpec | null>([['p/side.zipt', spec]]);
    const result = aggregateBoresRecursive(
      a, cacheOf([]), partBores, partInfoOf([['p/side.zipt', 'Side']]), panelSpecs,
    );
    expect(result.panels).toHaveLength(1);
    const g = result.panels[0]!;
    expect(g.length).toBe(720);
    expect(g.width).toBe(560);
    expect(g.thickness).toBe(18);
  });

  it('sets length/width/thickness to null when the panelSpecs entry is null or absent', () => {
    const a = asm('a', [
      cmp('c1', 'p/side.zipt'),
      cmp('c2', 'p/back.zipt'),
    ]);
    const partBores = new Map<string, BoreOp[]>([
      ['p/side.zipt', [bore('b1')]],
      ['p/back.zipt', [bore('b2')]],
    ]);
    // side.zipt → explicit null entry; back.zipt → absent from map
    const panelSpecs = new Map<string, PanelSpec | null>([['p/side.zipt', null]]);
    const result = aggregateBoresRecursive(
      a, cacheOf([]), partBores, partInfoOf([]), panelSpecs,
    );
    expect(result.panels).toHaveLength(2);
    for (const g of result.panels) {
      expect(g.length).toBeNull();
      expect(g.width).toBeNull();
      expect(g.thickness).toBeNull();
    }
  });
});
