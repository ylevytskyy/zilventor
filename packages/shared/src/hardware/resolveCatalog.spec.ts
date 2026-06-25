import { describe, it, expect } from 'vitest';
import { resolveHardwareCatalog, type HardwareCatalogEntry } from './resolveCatalog';
import { BUILTIN_CATALOG } from './builtinCatalog';

const custom: HardwareCatalogEntry = {
  id: 'acme-pull-128',
  name: 'ACME Bar Pull 128mm',
  category: 'drawerHandles',
  vendor: 'ACME',
  notes: 'custom',
  bboxMm: { l: 140, w: 12, h: 30 },
  attachPoints: [{ name: 'screw-a', position: { x: 6, y: 0, z: 0 } }],
};

describe('resolveHardwareCatalog', () => {
  it('returns builtins alone when doc has no customHardware', () => {
    expect(resolveHardwareCatalog(undefined)).toEqual(BUILTIN_CATALOG);
    expect(resolveHardwareCatalog({})).toEqual(BUILTIN_CATALOG);
    expect(resolveHardwareCatalog({ customHardware: [] })).toEqual(BUILTIN_CATALOG);
  });

  it('appends customHardware after builtins, preserving order', () => {
    const out = resolveHardwareCatalog({ customHardware: [custom] });
    expect(out.length).toBe(BUILTIN_CATALOG.length + 1);
    expect(out[out.length - 1]).toEqual(custom);
    expect(out.slice(0, BUILTIN_CATALOG.length)).toEqual(BUILTIN_CATALOG);
  });
});
