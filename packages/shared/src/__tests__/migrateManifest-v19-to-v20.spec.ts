import { describe, it, expect } from 'vitest';
import { migrateManifest, CURRENT_FORMAT_VERSION } from '../fileFormat';

describe('migrateManifest v19 → v20 (Phase 2 — customTextures backfill)', () => {
  it('migrates a v19 part forward to the current version (21)', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(22);
  });
  it('v19 part without customTextures → current version has customTextures: []', () => {
    const v19 = { formatVersion: 19, kind: 'part',
      document: { id: 'p', name: 'P', units: 'mm', parameters: {}, featureTree: [],
        properties: {}, materials: [], hardware: [] } };
    const out = migrateManifest(v19) as { formatVersion: number; document: { customTextures: unknown[] } };
    expect(out.formatVersion).toBe(22);
    expect(out.document.customTextures).toEqual([]);
  });
  it('v19 assembly without customTextures → current version has customTextures: []', () => {
    const v19 = { formatVersion: 19, kind: 'assembly',
      document: { id: 'a', name: 'A', units: 'mm', parameters: {}, components: [],
        constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {},
        cutListItemNumbers: {}, colorOverrides: {}, properties: {}, materials: [], hardware: [] } };
    const out = migrateManifest(v19) as { formatVersion: number; document: { customTextures: unknown[] } };
    expect(out.formatVersion).toBe(22);
    expect(out.document.customTextures).toEqual([]);
  });
  it('does not clobber an existing customTextures array (idempotent)', () => {
    const existing = [{ id: 'custom-x', name: 'X', physicalWidthMm: 1000,
      physicalHeightMm: 1000, albedoBlobId: 'b' }];
    const v19 = { formatVersion: 19, kind: 'part',
      document: { id: 'p', name: 'P', units: 'mm', parameters: {}, featureTree: [],
        properties: {}, materials: [], hardware: [], customTextures: existing } };
    const out = migrateManifest(v19) as { document: { customTextures: unknown[] } };
    expect(out.document.customTextures).toEqual(existing);
  });
  it('leaves drawing documents untouched (no customTextures field)', () => {
    const v19 = { formatVersion: 19, kind: 'drawing',
      document: { id: 'd', name: 'D', units: 'mm', sheets: [], properties: {} } };
    const out = migrateManifest(v19) as { formatVersion: number; document: Record<string, unknown> };
    expect(out.formatVersion).toBe(22);
    expect(out.document.customTextures).toBeUndefined();
  });
});
