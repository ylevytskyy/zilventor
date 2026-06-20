import { describe, it, expect } from 'vitest';
import { migrateManifest, CURRENT_FORMAT_VERSION } from '../fileFormat';

describe('migrateManifest v26 → v27 (edge-band thickness)', () => {
  it('CURRENT_FORMAT_VERSION is 27', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(30);
  });

  it('back-fills thickness:0.4 onto non-null edge bands of panel features', () => {
    const v26 = {
      formatVersion: 26,
      kind: 'part' as const,
      document: {
        id: 'p', name: 'Side', units: 'mm', parameters: {},
        featureTree: [
          {
            kind: 'panel', id: 'pf1',
            length: { kind: 'literal', value: 600 },
            width: { kind: 'literal', value: 400 },
            thickness: { kind: 'literal', value: 18 },
            thicknessFromMaterial: true,
            materialId: 'm-birch', grain: 'length',
            edgeBands: {
              front: { materialId: 'm-pvc' },
              back: null,
              left: { materialId: 'm-pvc' },
              right: null,
            },
          },
        ],
        properties: {}, materials: [], hardware: [],
      },
    };
    const out = migrateManifest(v26 as unknown as Parameters<typeof migrateManifest>[0]) as {
      formatVersion: number;
      document: { featureTree: Array<{ kind: string; edgeBands?: Record<string, { thickness?: number } | null> }> };
    };
    expect(out.formatVersion).toBe(30);
    const eb = out.document.featureTree.find((f) => f.kind === 'panel')!.edgeBands!;
    expect(eb.front).toEqual({ materialId: 'm-pvc', thickness: 0.4 });
    expect(eb.left).toEqual({ materialId: 'm-pvc', thickness: 0.4 });
    expect(eb.back).toBeNull();
    expect(eb.right).toBeNull();
  });

  it('leaves an already-thicknessed band unchanged (idempotent)', () => {
    const v26 = {
      formatVersion: 26,
      kind: 'part' as const,
      document: {
        id: 'p', name: 'Side', units: 'mm', parameters: {},
        featureTree: [
          {
            kind: 'panel', id: 'pf1',
            length: { kind: 'literal', value: 600 },
            width: { kind: 'literal', value: 400 },
            thickness: { kind: 'literal', value: 18 },
            thicknessFromMaterial: true,
            materialId: 'm-birch', grain: 'length',
            edgeBands: {
              front: { materialId: 'm-pvc', thickness: 1.0 },
              back: null, left: null, right: null,
            },
          },
        ],
        properties: {}, materials: [], hardware: [],
      },
    };
    const out = migrateManifest(v26 as unknown as Parameters<typeof migrateManifest>[0]) as {
      formatVersion: number;
      document: { featureTree: Array<{ kind: string; edgeBands?: Record<string, { thickness?: number } | null> }> };
    };
    const panel = out.document.featureTree.find((f) => f.kind === 'panel')!;
    expect(panel.edgeBands!.front).toEqual({ materialId: 'm-pvc', thickness: 1.0 });
  });
});
