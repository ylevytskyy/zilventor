import { describe, it, expect } from 'vitest';
import { migrateManifest, CURRENT_FORMAT_VERSION } from '../fileFormat';

describe('migrateManifest v13 → v14 (6 — no-op additive)', () => {
  it('CURRENT_FORMAT_VERSION is 17 (advanced by Drawing F3)', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(39);
  });

  it('passes a v13 part through to v14 unchanged', () => {
    const v13Part = {
      formatVersion: 13, kind: 'part',
      document: {
        id: 'p1', name: 'Cabinet', units: 'mm',
        parameters: {}, featureTree: [], properties: {},
        materials: [], hardware: [],
      },
    };
    const out = migrateManifest(v13Part) as { formatVersion: number; kind: string };
    expect(out.formatVersion).toBe(39);
    expect(out.kind).toBe('part');
  });

  it('passes a v13 assembly through to v14 unchanged', () => {
    const v13Asm = {
      formatVersion: 13, kind: 'assembly',
      document: {
        id: 'a1', name: 'Wardrobe', units: 'mm',
        parameters: {}, components: [], constraints: [],
        groundedComponentPaths: [], colors: {},
        bomItemNumbers: {}, cutListItemNumbers: {},
        colorOverrides: {}, properties: {},
        materials: [], hardware: [],
      },
    };
    const out = migrateManifest(v13Asm) as { formatVersion: number; kind: string; document: Record<string, unknown> };
    expect(out.formatVersion).toBe(39);
    expect(out.kind).toBe('assembly');
    // nest stays absent — migration is no-op
    expect('nest' in out.document).toBe(false);
  });

  it('v13 assembly preserves all existing fields after migration', () => {
    const v13Asm = {
      formatVersion: 13, kind: 'assembly',
      document: {
        id: 'a2', name: 'Cabinet', units: 'mm',
        parameters: {}, components: [], constraints: [],
        groundedComponentPaths: [], colors: {},
        bomItemNumbers: { 'comp1': 1 }, cutListItemNumbers: {},
        colorOverrides: {}, properties: { designer: 'Alice' },
        materials: [{ id: 'm1', name: 'Birch', defaultThickness: 18, color: '#aabbcc' }],
        hardware: [],
      },
    };
    const out = migrateManifest(v13Asm) as unknown as { document: Record<string, unknown> };
    expect((out.document.bomItemNumbers as Record<string, unknown>)['comp1']).toBe(1);
    expect((out.document.properties as Record<string, unknown>)['designer']).toBe('Alice');
  });

  it('a v14 drawing manifest migrates to v15 and preserves kind', () => {
    const v14Drawing = {
      formatVersion: 14, kind: 'drawing',
      createdAt: '2026-05-05T00:00:00.000Z',
      appVersion: '0.6.0',
      document: {
        id: 'draw-1',
        name: 'Cabinet — Drawing',
        units: 'mm',
        source: { partPath: 'parts/cabinet1.zipt', sourceKind: 'part' },
        properties: {},
        sheets: [],
        activeSheetId: '',
      },
    };
    const out = migrateManifest(v14Drawing) as { formatVersion: number; kind: string };
    expect(out.formatVersion).toBe(39);
    expect(out.kind).toBe('drawing');
  });

  it('does not add sheet-stock fields to materials on v13→v14 migration', () => {
    const v13Asm = {
      formatVersion: 13, kind: 'assembly',
      document: {
        id: 'a3', name: 'A', units: 'mm',
        parameters: {}, components: [], constraints: [],
        groundedComponentPaths: [], colors: {},
        bomItemNumbers: {}, cutListItemNumbers: {},
        colorOverrides: {}, properties: {},
        materials: [{ id: 'm1', name: 'Birch', defaultThickness: 18, color: '#aabbcc' }],
        hardware: [],
      },
    };
    const out = migrateManifest(v13Asm) as unknown as { document: { materials: unknown[] } };
    const m = out.document.materials[0] as Record<string, unknown>;
    expect('sheetLengthMm' in m).toBe(false);
    expect('sheetWidthMm' in m).toBe(false);
  });
});
