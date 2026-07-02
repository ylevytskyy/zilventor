import { describe, it, expect } from 'vitest';
import { migrateManifest, CURRENT_FORMAT_VERSION } from '../fileFormat';

describe('migrateManifest v21 → v22 (Phase 1 — присадка slice 2: doorSpec additive, no-op)', () => {
  it('CURRENT_FORMAT_VERSION is 22', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(38);
  });

  it('v21 part round-trips to v22 unchanged (no bores injected)', () => {
    const v21 = { formatVersion: 21, kind: 'part',
      document: { id: 'p', name: 'P', units: 'mm', parameters: {}, featureTree: [],
        properties: {}, materials: [], hardware: [], customTextures: [] } };
    const out = migrateManifest(v21) as { formatVersion: number; document: Record<string, unknown> };
    expect(out.formatVersion).toBe(38);
    expect(out.document.bores).toBeUndefined();
  });

  it('v21 assembly round-trips to v22 unchanged (no doorSpec injected)', () => {
    const v21 = { formatVersion: 21, kind: 'assembly',
      document: { id: 'a', name: 'A', units: 'mm', parameters: {}, components: [
        { id: 'C1', partPath: 'x.zipt', position: { x: 0, y: 0, z: 0 },
          rotation: { rx: 0, ry: 0, rz: 0 }, visible: true } ],
        constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {},
        cutListItemNumbers: {}, colorOverrides: {}, properties: {}, materials: [],
        hardware: [], customTextures: [] } };
    const out = migrateManifest(v21) as { formatVersion: number; document: { components: Array<Record<string, unknown>> } };
    expect(out.formatVersion).toBe(38);
    // additive: migration does NOT inject doorSpec; absent === unset at runtime
    expect(out.document.components[0]!.doorSpec).toBeUndefined();
  });

  it('leaves drawing documents untouched (advances version only)', () => {
    const v21 = { formatVersion: 21, kind: 'drawing',
      document: { id: 'd', name: 'D', units: 'mm', sheets: [], properties: {} } };
    const out = migrateManifest(v21) as { formatVersion: number };
    expect(out.formatVersion).toBe(38);
  });

  it('is idempotent for an already-v22 manifest', () => {
    const v22 = { formatVersion: 22, kind: 'part',
      document: { id: 'p', name: 'P', units: 'mm', parameters: {}, featureTree: [],
        properties: {}, materials: [], hardware: [], customTextures: [] } };
    const out = migrateManifest(v22) as { formatVersion: number };
    expect(out.formatVersion).toBe(38);
  });

  it('normalizes a bare-kind (no kind) v22 part to kind:"part"', () => {
    const bare = { formatVersion: 22,
      document: { id: 'p', name: 'P', units: 'mm', parameters: {}, featureTree: [],
        properties: {}, materials: [], hardware: [], customTextures: [] } };
    const out = migrateManifest(bare) as unknown as { kind: string };
    expect(out.kind).toBe('part');
  });
});
