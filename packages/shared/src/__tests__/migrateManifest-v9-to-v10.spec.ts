import { describe, expect, it } from 'vitest';
import { migrateManifest, CURRENT_FORMAT_VERSION } from '../fileFormat';

describe('migrateManifest v9 → v10', () => {
  it('adds empty materials to a v9 part', () => {
    const v9 = {
      formatVersion: 9, kind: 'part', createdAt: '2026-01-01', appVersion: '0',
      document: { id: 'p', name: 'X', units: 'mm', parameters: {}, featureTree: [], properties: {} },
    };
    const out = migrateManifest(v9 as never);
    expect(out.formatVersion).toBe(22);
    expect((out.document as { materials: unknown }).materials).toEqual([]);
  });

  it('adds empty materials to a v9 assembly', () => {
    const v9 = {
      formatVersion: 9, kind: 'assembly', createdAt: '2026-01-01', appVersion: '0',
      document: {
        id: 'a', name: 'X', units: 'mm', parameters: {}, components: [], constraints: [],
        groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, colorOverrides: {}, properties: {},
      },
    };
    const out = migrateManifest(v9 as never);
    expect(out.formatVersion).toBe(22);
    expect((out.document as { materials: unknown }).materials).toEqual([]);
  });

  it('preserves a populated materials array when migrating through v10', () => {
    const v10 = {
      formatVersion: 10, kind: 'part', createdAt: '2026-01-01', appVersion: '0',
      document: {
        id: 'p', name: 'X', units: 'mm', parameters: {}, featureTree: [],
        properties: {},
        materials: [{ id: 'm1', name: 'Birch 18', defaultThickness: 18, color: '#d8c896' }],
      },
    };
    const out = migrateManifest(v10 as never);
    expect(out.formatVersion).toBe(22);
    expect((out.document as { materials: { id: string }[] }).materials[0]!.id).toBe('m1');
  });

  it('CURRENT_FORMAT_VERSION === 11', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(22);
  });
});
