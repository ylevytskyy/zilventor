import { describe, it, expect } from 'vitest';
import { migrateManifest } from '../fileFormat';
import { BUILTIN_CATALOG } from '../hardware/builtinCatalog';

// ---------------------------------------------------------------------------
// v11 → v12: hardware field + built-in catalog seed
// ---------------------------------------------------------------------------
describe('migration v11→v12', () => {
  it('v11 PartDocument gains hardware: []', () => {
    const manifest = {
      formatVersion: 11,
      kind: 'part',
      document: {
        id: 'p1', name: 'Part', units: 'mm', parameters: {}, featureTree: [],
        properties: {}, materials: [],
      },
    };
    const result = migrateManifest(manifest);
    expect(result.formatVersion).toBe(12);
    expect((result.document as { hardware?: unknown }).hardware).toEqual([]);
  });

  it('v11 AssemblyDocument gains hardware with 7 built-in entries', () => {
    const manifest = {
      formatVersion: 11,
      kind: 'assembly',
      document: {
        id: 'a1', name: 'Asm', units: 'mm', parameters: {},
        components: [], constraints: [], groundedComponentPaths: [],
        colors: {}, bomItemNumbers: {}, cutListItemNumbers: {},
        colorOverrides: {}, properties: {}, materials: [],
      },
    };
    const result = migrateManifest(manifest);
    expect(result.formatVersion).toBe(12);
    const hw = (result.document as { hardware?: unknown[] }).hardware;
    expect(hw).toHaveLength(7);
    expect(hw!.map((e: unknown) => (e as { id: string }).id)).toEqual(
      BUILTIN_CATALOG.map((e) => e.id),
    );
  });

  it('v12 AssemblyDocument that already has hardware entries is not duplicated', () => {
    const manifest = {
      formatVersion: 11,
      kind: 'assembly',
      document: {
        id: 'a2', name: 'Asm2', units: 'mm', parameters: {},
        components: [], constraints: [], groundedComponentPaths: [],
        colors: {}, bomItemNumbers: {}, cutListItemNumbers: {},
        colorOverrides: {}, properties: {}, materials: [],
        hardware: [BUILTIN_CATALOG[0]],
      },
    };
    const result = migrateManifest(manifest);
    const hw = (result.document as { hardware?: unknown[] }).hardware;
    // Should have all 7, not 1 + 7.
    expect(hw).toHaveLength(7);
    const ids = hw!.map((e: unknown) => (e as { id: string }).id);
    expect(new Set(ids).size).toBe(7);
  });
});
