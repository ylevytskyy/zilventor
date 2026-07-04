import { describe, it, expect } from 'vitest';
import { migrateManifest, CURRENT_FORMAT_VERSION, type AnyManifest } from '../fileFormat';

describe('migrateManifest v39 → v40 (P16 — keyholeSlot feature kind)', () => {
  it('CURRENT_FORMAT_VERSION is 40', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(41);
  });

  it('migrates a v39 part to v40 without mutating its featureTree entries', () => {
    const v39: AnyManifest = {
      formatVersion: 39,
      kind: 'part',
      document: { id: 'p', name: 'P', featureTree: [{ kind: 'panel', id: 'pf-1' }] },
    };
    const out = migrateManifest(v39);
    expect(out.formatVersion).toBe(41);
    // migrateManifest also seeds the standard origin features (unrelated to this
    // bump) — find the panel entry rather than asserting full array equality.
    const featureTree = (out.document as { featureTree: Array<{ kind: string; id: string }> }).featureTree;
    expect(featureTree.find((f) => f.id === 'pf-1')).toEqual({ kind: 'panel', id: 'pf-1' });
  });

  it('round-trips a keyholeSlot featureTree entry at v40', () => {
    const manifest: AnyManifest = {
      formatVersion: 40,
      kind: 'part',
      document: {
        id: 'p1',
        name: 'Panel',
        units: 'mm',
        parameters: {},
        featureTree: [
          {
            kind: 'keyholeSlot',
            id: 'ks-1',
            faceRole: 'Back',
            u: 9,
            v: 300,
            axis: 'v',
            direction: 1,
            entryDiameter: 15,
            slotWidth: 8,
            slotLength: 25,
            depth: 6,
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
    const doc = out.document as { featureTree: Array<{ kind: string; id: string }> };
    const inputFeatureTree = (manifest.document as { featureTree: Array<{ kind: string; id: string }> }).featureTree;
    expect(doc.featureTree.find((f) => f.id === 'ks-1')).toEqual(inputFeatureTree[0]);
  });
});
