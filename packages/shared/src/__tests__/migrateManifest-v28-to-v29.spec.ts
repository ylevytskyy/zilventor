import { describe, it, expect } from 'vitest';
import { migrateManifest, CURRENT_FORMAT_VERSION } from '../fileFormat';

describe('migrateManifest v28 → v29 (feature suppression)', () => {
  it('CURRENT_FORMAT_VERSION is 29', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(34);
  });

  it('injects suppressedFeatureIds:[] onto a v28 part document missing it', () => {
    const v28 = {
      formatVersion: 28,
      kind: 'part' as const,
      document: {
        id: 'p', name: 'Side', units: 'mm', parameters: {},
        featureTree: [],
        properties: {}, materials: [], hardware: [], rules: [],
      },
    };
    const out = migrateManifest(v28 as unknown as Parameters<typeof migrateManifest>[0]) as {
      formatVersion: number;
      document: { suppressedFeatureIds?: string[] };
    };
    expect(out.formatVersion).toBe(34);
    expect(out.document.suppressedFeatureIds).toEqual([]);
  });

  it('preserves existing suppressedFeatureIds on round-trip through the current format', () => {
    const atCurrent = {
      formatVersion: CURRENT_FORMAT_VERSION,
      kind: 'part' as const,
      document: {
        id: 'p', name: 'Side', units: 'mm', parameters: {},
        featureTree: [], properties: {}, materials: [], hardware: [], rules: [],
        suppressedFeatureIds: ['f1', 'f2'],
      },
    };
    const cloned = JSON.parse(JSON.stringify(atCurrent));
    const out = migrateManifest(cloned) as { formatVersion: number; document: { suppressedFeatureIds?: string[] } };
    expect(out.formatVersion).toBe(CURRENT_FORMAT_VERSION);
    expect(out.document.suppressedFeatureIds).toEqual(['f1', 'f2']);
  });

  it('does not add suppressedFeatureIds to assembly documents', () => {
    const v28asm = {
      formatVersion: 28,
      kind: 'assembly' as const,
      document: { id: 'a', name: 'Asm', units: 'mm', components: [] },
    };
    const out = migrateManifest(v28asm as unknown as Parameters<typeof migrateManifest>[0]) as {
      formatVersion: number;
      document: Record<string, unknown>;
    };
    expect(out.formatVersion).toBe(34);
    expect(out.document.suppressedFeatureIds).toBeUndefined();
  });
});
