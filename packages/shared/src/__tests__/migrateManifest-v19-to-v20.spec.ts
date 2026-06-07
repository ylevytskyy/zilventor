import { describe, it, expect } from 'vitest';
import { migrateManifest, CURRENT_FORMAT_VERSION } from '../fileFormat';

describe('migrateManifest v19 → v20 (Phase 2 — customTextures backfill)', () => {
  it('CURRENT_FORMAT_VERSION is 20', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(20);
  });
  it('v19 part without customTextures → v20 has customTextures: []', () => {
    const v19 = { formatVersion: 19, kind: 'part',
      document: { id: 'p', name: 'P', units: 'mm', parameters: {}, featureTree: [],
        properties: {}, materials: [], hardware: [] } };
    const out = migrateManifest(v19) as { formatVersion: number; document: { customTextures: unknown[] } };
    expect(out.formatVersion).toBe(20);
    expect(out.document.customTextures).toEqual([]);
  });
  it('v19 assembly without customTextures → v20 has customTextures: []', () => {
    const v19 = { formatVersion: 19, kind: 'assembly',
      document: { id: 'a', name: 'A', units: 'mm', parameters: {}, components: [],
        constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {},
        cutListItemNumbers: {}, colorOverrides: {}, properties: {}, materials: [], hardware: [] } };
    const out = migrateManifest(v19) as { formatVersion: number; document: { customTextures: unknown[] } };
    expect(out.formatVersion).toBe(20);
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
    expect(out.formatVersion).toBe(20);
    expect(out.document.customTextures).toBeUndefined();
  });
});
