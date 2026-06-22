import { describe, expect, it } from 'vitest';
import { migrateManifest, CURRENT_FORMAT_VERSION } from '../fileFormat';

describe('migrateManifest v8 → v9', () => {
  it('CURRENT_FORMAT_VERSION is 14', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(32);
  });

  it('v8 part without properties gets properties: {} on v9', () => {
    const v8: any = {
      formatVersion: 8,
      kind: 'part',
      createdAt: '2026-04-29T00:00:00Z',
      appVersion: '0.0.1',
      document: {
        id: 'p1', name: 'X', units: 'mm', parameters: {}, featureTree: [],
      },
    };
    const v9 = migrateManifest(v8) as any;
    expect(v9.formatVersion).toBe(32);
    expect(v9.document.properties).toEqual({});
  });

  it('v8 assembly without properties gets properties: {} on v9', () => {
    const v8: any = {
      formatVersion: 8,
      kind: 'assembly',
      createdAt: '2026-04-29T00:00:00Z',
      appVersion: '0.0.1',
      document: {
        id: 'a1', name: 'A', units: 'mm', parameters: {},
        components: [], constraints: [], groundedComponentPaths: [],
        colors: {}, bomItemNumbers: {}, colorOverrides: {},
      },
    };
    const v9 = migrateManifest(v8) as any;
    expect(v9.formatVersion).toBe(32);
    expect(v9.document.properties).toEqual({});
  });

  it('v9 file with properties preserved (no clobber)', () => {
    const v9in: any = {
      formatVersion: 9,
      kind: 'part',
      createdAt: '2026-04-30T00:00:00Z',
      appVersion: '0.0.1',
      document: {
        id: 'p1', name: 'X', units: 'mm', parameters: {}, featureTree: [],
        properties: { partNumber: 'Z-1', mass: 1.5 },
      },
    };
    const v9out = migrateManifest(v9in) as any;
    expect(v9out.formatVersion).toBe(32);
    expect(v9out.document.properties).toEqual({ partNumber: 'Z-1', mass: 1.5 });
  });

  it('v7 part migrates all the way to v9 with properties: {}', () => {
    const v7: any = {
      formatVersion: 7,
      createdAt: '2026-04-20T00:00:00Z',
      appVersion: '0.0.1',
      document: { id: 'p1', name: 'X', units: 'mm', parameters: {}, featureTree: [] },
    };
    const v9 = migrateManifest(v7) as any;
    expect(v9.formatVersion).toBe(32);
    expect(v9.document.properties).toEqual({});
  });
});
