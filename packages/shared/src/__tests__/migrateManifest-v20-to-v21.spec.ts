import { describe, it, expect } from 'vitest';
import { migrateManifest, CURRENT_FORMAT_VERSION } from '../fileFormat';

describe('migrateManifest v20 → v21 (Phase 1 — присадка: bores/role additive, no-op)', () => {
  it('CURRENT_FORMAT_VERSION is 22', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(27);
  });

  it('v20 part round-trips to v22 unchanged (no bores injected)', () => {
    const v20 = { formatVersion: 20, kind: 'part',
      document: { id: 'p', name: 'P', units: 'mm', parameters: {}, featureTree: [],
        properties: {}, materials: [], hardware: [], customTextures: [] } };
    const out = migrateManifest(v20) as { formatVersion: number; document: Record<string, unknown> };
    expect(out.formatVersion).toBe(27);
    // additive: absent === [] at runtime, migration does NOT inject the key
    expect(out.document.bores).toBeUndefined();
  });

  it('v20 assembly round-trips to v22 unchanged (no role injected)', () => {
    const v20 = { formatVersion: 20, kind: 'assembly',
      document: { id: 'a', name: 'A', units: 'mm', parameters: {}, components: [
        { id: 'C1', partPath: 'x.zipt', position: { x: 0, y: 0, z: 0 },
          rotation: { rx: 0, ry: 0, rz: 0 }, visible: true } ],
        constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {},
        cutListItemNumbers: {}, colorOverrides: {}, properties: {}, materials: [],
        hardware: [], customTextures: [] } };
    const out = migrateManifest(v20) as { formatVersion: number; document: { components: Array<Record<string, unknown>> } };
    expect(out.formatVersion).toBe(27);
    expect(out.document.components[0]!.role).toBeUndefined();
  });

  it('leaves drawing documents untouched (advances version only)', () => {
    const v20 = { formatVersion: 20, kind: 'drawing',
      document: { id: 'd', name: 'D', units: 'mm', sheets: [], properties: {} } };
    const out = migrateManifest(v20) as { formatVersion: number };
    expect(out.formatVersion).toBe(27);
  });

  it('v21 input migrates forward to v22', () => {
    const v21 = { formatVersion: 21, kind: 'part',
      document: { id: 'p', name: 'P', units: 'mm', parameters: {}, featureTree: [],
        properties: {}, materials: [], hardware: [], customTextures: [] } };
    const out = migrateManifest(v21) as { formatVersion: number };
    expect(out.formatVersion).toBe(27);
  });

  it('normalizes a bare-kind (no kind) v21 part to kind:"part"', () => {
    const bare = { formatVersion: 21,
      document: { id: 'p', name: 'P', units: 'mm', parameters: {}, featureTree: [],
        properties: {}, materials: [], hardware: [], customTextures: [] } };
    const out = migrateManifest(bare) as unknown as { kind: string };
    expect(out.kind).toBe('part');
  });
});
