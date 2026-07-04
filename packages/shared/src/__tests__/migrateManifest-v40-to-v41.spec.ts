import { describe, it, expect } from 'vitest';
import { migrateManifest, CURRENT_FORMAT_VERSION, type AnyManifest } from '../fileFormat';

describe('migrateManifest v40 → v41 (BoreOp.sku field)', () => {
  it('CURRENT_FORMAT_VERSION is 41', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(41);
  });

  it('migrates a v40 part to v41 without mutating its featureTree entries', () => {
    const v40: AnyManifest = {
      formatVersion: 40,
      kind: 'part',
      document: { id: 'p', name: 'P', featureTree: [{ kind: 'panel', id: 'pf-1' }] },
    };
    const out = migrateManifest(v40);
    expect(out.formatVersion).toBe(41);
    // migrateManifest also seeds the standard origin features (unrelated to this
    // bump) — find the panel entry rather than asserting full array equality.
    const featureTree = (out.document as { featureTree: Array<{ kind: string; id: string }> }).featureTree;
    expect(featureTree.find((f) => f.id === 'pf-1')).toEqual({ kind: 'panel', id: 'pf-1' });
  });

  it('round-trips a BoreOp.sku value through JSON at v41', () => {
    const manifest: AnyManifest = {
      formatVersion: 41,
      kind: 'part',
      document: {
        id: 'p1',
        name: 'Panel',
        units: 'mm',
        parameters: {},
        featureTree: [
          {
            kind: 'panel',
            id: 'pf-1',
            bores: [
              {
                id: 'b1',
                face: { featureId: 'panel', role: 'Left', instance: 0 },
                u: 10,
                v: 20,
                diameter: 5,
                depth: 13,
                role: 'confirmat-face',
                connectorId: 'c0',
                connectorKind: 'confirmat',
                sku: 'BLUM-71B3550',
              },
            ],
          },
        ],
        properties: {},
        materials: [],
        hardware: [],
      },
    };
    const json = JSON.stringify(manifest);
    const parsed = JSON.parse(json) as AnyManifest;
    const out = migrateManifest(parsed);
    expect(out.formatVersion).toBe(41);
    const doc = out.document as { featureTree: Array<{ kind: string; id: string; bores?: Array<{ sku?: string }> }> };
    const panel = doc.featureTree.find((f) => f.id === 'pf-1');
    expect(panel?.bores?.[0]?.sku).toBe('BLUM-71B3550');
  });
});
