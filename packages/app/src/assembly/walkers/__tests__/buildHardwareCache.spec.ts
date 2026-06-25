import { describe, it, expect } from 'vitest';
import { buildHardwareCache } from '../buildHardwareCache';
import type { AssemblyDocument } from '@zilventor/shared';
import type { HardwareCatalogEntry } from '@zilventor/shared/src/hardware/resolveCatalog';

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
    hardware: [],
  };
}

describe('buildHardwareCache', () => {
  it('case a: active assembly with one hardware ref → 1 part entry with synthesized HardwareFeature', () => {
    const asm = makeAsm([{ id: 'c1', partPath: 'hardware/hinge-35mm-cup-full.zipt' }]);
    const cache = buildHardwareCache(asm, {});

    expect(cache.size).toBe(1);
    const entry = cache.get('hardware/hinge-35mm-cup-full.zipt');
    expect(entry?.kind).toBe('part');
    if (entry?.kind !== 'part') throw new Error('unreachable');
    const feature = entry.document.featureTree[0] as Record<string, unknown>;
    expect(feature.kind).toBe('hardware');
    expect(feature.hardwareSkuId).toBe('hinge-35mm-cup-full');
    expect(feature.id).toBe('hf-hinge-35mm-cup-full');
  });

  it('case b: sub-assembly containing a hardware ref → both ok and part entries in cache', () => {
    const subAsm = makeAsm([{ id: 'c1', partPath: 'hardware/shelf-pin-5mm-steel.zipt' }]);
    const asm = makeAsm([{ id: 'sub1', partPath: 'cabinet.ziasm' }]);
    const cache = buildHardwareCache(asm, { 'cabinet.ziasm': subAsm });

    // 'ok' entry for the sub-assembly
    const okEntry = cache.get('cabinet.ziasm');
    expect(okEntry?.kind).toBe('ok');

    // 'part' entry for the hardware inside the sub-assembly
    const partEntry = cache.get('hardware/shelf-pin-5mm-steel.zipt');
    expect(partEntry?.kind).toBe('part');
    if (partEntry?.kind !== 'part') throw new Error('unreachable');
    const feature = partEntry.document.featureTree[0] as Record<string, unknown>;
    expect(feature.hardwareSkuId).toBe('shelf-pin-5mm-steel');
  });

  it('case c: unknown SKU → no entry added to cache', () => {
    const asm = makeAsm([{ id: 'c1', partPath: 'hardware/totally-unknown-sku.zipt' }]);
    const cache = buildHardwareCache(asm, {});

    expect(cache.has('hardware/totally-unknown-sku.zipt')).toBe(false);
    expect(cache.size).toBe(0);
  });

  it('case d: placed custom SKU in doc.customHardware → cache entry synthesized (M4-D BOM bug)', () => {
    const customEntry: HardwareCatalogEntry = {
      id: 'acme-pull-128',
      name: 'Acme Pull 128mm',
      category: 'drawerHandles',
      vendor: 'Acme',
      notes: '',
      bboxMm: { l: 128, w: 20, h: 10 },
      attachPoints: [],
    };
    const asm: AssemblyDocument = {
      ...makeAsm([{ id: 'c1', partPath: 'hardware/acme-pull-128.zipt' }]),
      customHardware: [customEntry],
    };
    const cache = buildHardwareCache(asm, {});

    expect(cache.has('hardware/acme-pull-128.zipt')).toBe(true);
    const entry = cache.get('hardware/acme-pull-128.zipt');
    expect(entry?.kind).toBe('part');
    if (entry?.kind !== 'part') throw new Error('unreachable');
    const feature = entry.document.featureTree[0] as Record<string, unknown>;
    expect(feature.kind).toBe('hardware');
    expect(feature.hardwareSkuId).toBe('acme-pull-128');
    expect(feature.id).toBe('hf-acme-pull-128');
  });
});
