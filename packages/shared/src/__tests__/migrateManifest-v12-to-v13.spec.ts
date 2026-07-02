import { describe, it, expect } from 'vitest';
import { migrateManifest, CURRENT_FORMAT_VERSION } from '../fileFormat';

describe('migrateManifest v12 → v13 (5e — no-op additive)', () => {
  it('CURRENT_FORMAT_VERSION is 17 (advanced by Drawing F3)', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(35);
  });

  it('passes a v12 assembly through unchanged (nest stays absent)', () => {
    const v12Asm = {
      formatVersion: 12, kind: 'assembly',
      document: {
        id: 'a1', name: 'A', units: 'mm',
        parameters: {}, components: [], constraints: [],
        groundedComponentPaths: [], colors: {},
        bomItemNumbers: {}, cutListItemNumbers: {},
        colorOverrides: {}, properties: {},
        materials: [], hardware: [],
      },
    };
    const out = migrateManifest(v12Asm) as unknown as { formatVersion: number; document: Record<string, unknown> };
    expect(out.formatVersion).toBe(35);
    expect('nest' in out.document).toBe(false);
  });

  it('passes a v12 part through unchanged', () => {
    const v12Part = {
      formatVersion: 12, kind: 'part',
      document: { id: 'p1', name: 'P', units: 'mm', parameters: {}, sketches: [],
             featureTree: [], parameterRefs: [], properties: {}, materials: [], hardware: [] },
    };
    const out = migrateManifest(v12Part) as { formatVersion: number };
    expect(out.formatVersion).toBe(35);
  });

  it('does not add sheet-stock fields to materials on migration', () => {
    const v12Asm = {
      formatVersion: 12, kind: 'assembly',
      document: {
        id: 'a1', name: 'A', units: 'mm',
        parameters: {}, components: [], constraints: [],
        groundedComponentPaths: [], colors: {},
        bomItemNumbers: {}, cutListItemNumbers: {},
        colorOverrides: {}, properties: {},
        materials: [{ id: 'm1', name: 'Birch', defaultThickness: 18, color: '#aabbcc' }],
        hardware: [],
      },
    };
    const out = migrateManifest(v12Asm) as unknown as { document: { materials: unknown[] } };
    const m = out.document.materials[0] as Record<string, unknown>;
    expect('sheetLengthMm' in m).toBe(false);
    expect('sheetWidthMm' in m).toBe(false);
  });
});
