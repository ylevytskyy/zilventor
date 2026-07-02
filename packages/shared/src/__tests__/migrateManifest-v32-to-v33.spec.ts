import { describe, it, expect } from 'vitest';
import { migrateManifest, CURRENT_FORMAT_VERSION, type AnyManifest } from '../fileFormat';
import type { HardwareCatalogEntry } from '../hardware/resolveCatalog';

describe('migrateManifest v32 → v33 (M4 Slice D — customHardware field)', () => {
  it('CURRENT_FORMAT_VERSION is 33', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(38);
  });

  it('migrates a v32 assembly manifest to v33 without seeding customHardware', () => {
    const v32: AnyManifest = {
      formatVersion: 32,
      kind: 'assembly',
      document: { id: 'a', name: 'A', hardware: [] },
    };
    const out = migrateManifest(v32);
    expect(out.formatVersion).toBe(38);
    expect((out.document as { customHardware?: unknown }).customHardware).toBeUndefined();
  });

  it('round-trips a customHardware entry through JSON serialize → migrateManifest', () => {
    const entry: HardwareCatalogEntry = {
      id: 'acme-pull-128',
      name: 'ACME Bar Pull 128mm',
      category: 'drawerHandles',
      vendor: 'ACME',
      notes: 'x',
      bboxMm: { l: 140, w: 12, h: 30 },
      attachPoints: [{ name: 'screw-a', position: { x: 6, y: 0, z: 0 } }],
    };
    // Build a v33 assembly doc with customHardware, round-trip through JSON → migrateManifest.
    // migrateManifest at v33 is a no-op (no migrations above CURRENT); content must survive.
    const manifest: AnyManifest = {
      formatVersion: 33,
      kind: 'assembly',
      document: {
        id: 'a1',
        name: 'Cabinet',
        units: 'mm',
        parameters: {},
        components: [],
        constraints: [],
        groundedComponentPaths: [],
        colors: {},
        bomItemNumbers: {},
        cutListItemNumbers: {},
        colorOverrides: {},
        properties: {},
        materials: [],
        hardware: [],
        customHardware: [entry],
      },
    };
    const json = JSON.stringify(manifest);
    const parsed = JSON.parse(json) as AnyManifest;
    const out = migrateManifest(parsed);
    const doc = out.document as { customHardware?: unknown };
    expect(doc.customHardware).toEqual([entry]);
  });
});
