import { describe, it, expect } from 'vitest';
import { migrateManifest, CURRENT_FORMAT_VERSION } from '../fileFormat';

describe('migrateManifest v29 → v30 (iPart configurations)', () => {
  it('CURRENT_FORMAT_VERSION is 30', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(33);
  });

  it('injects configurations:[] onto a v29 part document missing it', () => {
    const v29 = {
      formatVersion: 29,
      kind: 'part' as const,
      document: {
        id: 'p', name: 'Side', units: 'mm', parameters: {},
        featureTree: [],
        properties: {}, materials: [], hardware: [], rules: [], suppressedFeatureIds: [],
      },
    };
    const out = migrateManifest(v29 as unknown as Parameters<typeof migrateManifest>[0]) as {
      formatVersion: number;
      document: { configurations?: unknown[] };
    };
    expect(out.formatVersion).toBe(33);
    expect(out.document.configurations).toEqual([]);
  });

  it('preserves existing configurations on round-trip through the current format', () => {
    const atCurrent = {
      formatVersion: CURRENT_FORMAT_VERSION,
      kind: 'part' as const,
      document: {
        id: 'p', name: 'Side', units: 'mm', parameters: {},
        featureTree: [], properties: {}, materials: [], hardware: [], rules: [], suppressedFeatureIds: [],
        configurations: [{ name: 'Large', values: { width: '900' } }],
      },
    };
    const cloned = JSON.parse(JSON.stringify(atCurrent));
    const out = migrateManifest(cloned) as { formatVersion: number; document: { configurations?: unknown[] } };
    expect(out.formatVersion).toBe(CURRENT_FORMAT_VERSION);
    expect(out.document.configurations).toEqual([{ name: 'Large', values: { width: '900' } }]);
  });

  it('does not add configurations to assembly documents', () => {
    const v29asm = {
      formatVersion: 29,
      kind: 'assembly' as const,
      document: { id: 'a', name: 'Asm', units: 'mm', components: [] },
    };
    const out = migrateManifest(v29asm as unknown as Parameters<typeof migrateManifest>[0]) as {
      formatVersion: number;
      document: Record<string, unknown>;
    };
    expect(out.formatVersion).toBe(33);
    expect(out.document.configurations).toBeUndefined();
  });
});
