import { describe, it, expect } from 'vitest';
import { migrateManifest, CURRENT_FORMAT_VERSION } from '../fileFormat';

describe('migrateManifest v14 → v15 (Drawing F1 — no-op additive)', () => {
  it('CURRENT_FORMAT_VERSION is 17 (advanced by Drawing F3)', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(22);
  });

  it('passes a v14 part through to v16 unchanged', () => {
    const v14Part = {
      formatVersion: 14, kind: 'part',
      document: {
        id: 'p1', name: 'Cabinet', units: 'mm',
        parameters: {}, featureTree: [], properties: {},
        materials: [], hardware: [],
      },
    };
    const out = migrateManifest(v14Part) as { formatVersion: number; kind: string };
    expect(out.formatVersion).toBe(22);
    expect(out.kind).toBe('part');
  });

  it('passes a v14 assembly through to v16 unchanged', () => {
    const v14Asm = {
      formatVersion: 14, kind: 'assembly',
      document: {
        id: 'a1', name: 'Wardrobe', units: 'mm',
        parameters: {}, components: [], constraints: [],
        groundedComponentPaths: [], colors: {},
        bomItemNumbers: {}, cutListItemNumbers: {},
        colorOverrides: {}, properties: {},
        materials: [], hardware: [],
      },
    };
    const out = migrateManifest(v14Asm) as { formatVersion: number };
    expect(out.formatVersion).toBe(22);
  });

  it('passes a v14 drawing through to v16 without data loss', () => {
    const v14Drawing = {
      formatVersion: 14, kind: 'drawing',
      document: {
        id: 'draw-1', name: 'Box — Drawing', units: 'mm',
        source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
        properties: {}, sheets: [], activeSheetId: '',
      },
    };
    const out = migrateManifest(v14Drawing) as {
      formatVersion: number;
      kind: string;
      document: { name: string };
    };
    expect(out.formatVersion).toBe(22);
    expect(out.kind).toBe('drawing');
    expect(out.document.name).toBe('Box — Drawing');
  });

  it('a v16 manifest passes through migrateManifest without re-migration', () => {
    const v16 = {
      formatVersion: 16, kind: 'part',
      document: {
        id: 'p2', name: 'Shelf', units: 'mm',
        parameters: {}, featureTree: [], properties: {},
        materials: [], hardware: [],
      },
    };
    const out = migrateManifest(v16) as { formatVersion: number };
    expect(out.formatVersion).toBe(22);
  });
});
