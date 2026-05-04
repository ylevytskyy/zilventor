import { describe, it, expect } from 'vitest';
import { aggregateHardwareRecursive } from '../aggregateHardwareRecursive';
import type { AssemblyDocument } from '@zilventor/shared';
import type { HardwareRegistry } from '@zilventor/shared';

const registry: HardwareRegistry = [
  { id: 'hinge-35mm-cup-full', name: '35mm Cup Hinge — Full Overlay', category: 'hinges',    vendor: 'Blum',    notes: 'Requires 35mm Forstner bit' },
  { id: 'shelf-pin-5mm-steel', name: '5mm Shelf Pin — Steel',         category: 'shelfPins', vendor: 'Generic', notes: 'Press-fit into 5mm shelf-pin hole; steel' },
];

function makeHardwarePart(skuId: string) {
  return {
    kind: 'part' as const,
    document: {
      featureTree: [
        { kind: 'hardware', id: 'hf-1', hardwareSkuId: skuId, bboxMm: { l: 48, w: 35, h: 12 }, attachPoints: [] },
      ],
    },
  };
}

function makePanelPart() {
  return {
    kind: 'part' as const,
    document: {
      featureTree: [
        { kind: 'panel', id: 'pf-1' },
      ],
    },
  };
}

type DocumentCache = Map<string, { kind: 'ok'; doc: AssemblyDocument } | { kind: 'part'; document: { featureTree: unknown[] } }>;

function makeCache(entries: Record<string, ReturnType<typeof makeHardwarePart> | ReturnType<typeof makePanelPart>>): DocumentCache {
  return new Map(Object.entries(entries)) as unknown as DocumentCache;
}

function makeAsm(components: Array<{ id: string; partPath: string }>): AssemblyDocument {
  return {
    id: 'asm-1',
    name: 'Test',
    units: 'mm',
    parameters: {},
    components: components.map((c) => ({
      ...c,
      position: { x: 0, y: 0, z: 0 },
      rotation: { rx: 0, ry: 0, rz: 0 },
      visible: true,
    })),
    constraints: [],
    groundedComponentPaths: [],
    colors: {},
    bomItemNumbers: {},
    cutListItemNumbers: {},
    colorOverrides: {},
    properties: {},
    materials: [],
    hardware: [...registry],
  };
}

describe('aggregateHardwareRecursive', () => {
  it('assembly with 0 hardware components returns rows: []', () => {
    const asm = makeAsm([]);
    const result = aggregateHardwareRecursive(asm, new Map(), registry);
    expect(result.rows).toEqual([]);
  });

  it('2 instances of same SKU → 1 row with qty=2', () => {
    const asm = makeAsm([
      { id: 'c1', partPath: 'hardware/hinge-35mm-cup-full.zipt' },
      { id: 'c2', partPath: 'hardware/hinge-35mm-cup-full.zipt' },
    ]);
    const cache = makeCache({
      'hardware/hinge-35mm-cup-full.zipt': makeHardwarePart('hinge-35mm-cup-full'),
    });
    const result = aggregateHardwareRecursive(asm, cache as never, registry);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.skuId).toBe('hinge-35mm-cup-full');
    expect(result.rows[0]!.qty).toBe(2);
  });

  it('1 hinge + 1 shelf pin → 2 rows sorted by category then name', () => {
    const asm = makeAsm([
      { id: 'c1', partPath: 'hardware/hinge-35mm-cup-full.zipt' },
      { id: 'c2', partPath: 'hardware/shelf-pin-5mm-steel.zipt' },
    ]);
    const cache = makeCache({
      'hardware/hinge-35mm-cup-full.zipt': makeHardwarePart('hinge-35mm-cup-full'),
      'hardware/shelf-pin-5mm-steel.zipt': makeHardwarePart('shelf-pin-5mm-steel'),
    });
    const result = aggregateHardwareRecursive(asm, cache as never, registry);
    expect(result.rows).toHaveLength(2);
    // hinges < shelfPins alphabetically
    expect(result.rows[0]!.category).toBe('hinges');
    expect(result.rows[1]!.category).toBe('shelfPins');
  });

  it('hardware in a nested sub-assembly is counted in the parent walk', () => {
    const subAsm: AssemblyDocument = makeAsm([
      { id: 'c1', partPath: 'hardware/hinge-35mm-cup-full.zipt' },
    ]);
    const parentAsm = makeAsm([
      { id: 'sub1', partPath: 'cabinet.ziasm' },
    ]);
    const cache = new Map<string, { kind: 'ok'; doc: AssemblyDocument } | ReturnType<typeof makeHardwarePart>>([
      ['cabinet.ziasm', { kind: 'ok' as const, doc: subAsm }],
      ['hardware/hinge-35mm-cup-full.zipt', makeHardwarePart('hinge-35mm-cup-full')],
    ]);
    const result = aggregateHardwareRecursive(parentAsm, cache as never, registry);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.qty).toBe(1);
  });

  it('panel components are not included in hardware rows', () => {
    const asm = makeAsm([
      { id: 'c1', partPath: 'parts/panel.zipt' },
    ]);
    const cache = makeCache({
      'parts/panel.zipt': makePanelPart(),
    });
    const result = aggregateHardwareRecursive(asm, cache as never, registry);
    expect(result.rows).toEqual([]);
  });
});
