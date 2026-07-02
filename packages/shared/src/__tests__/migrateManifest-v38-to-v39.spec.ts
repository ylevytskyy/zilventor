import { describe, it, expect } from 'vitest';
import { migrateManifest, CURRENT_FORMAT_VERSION, type AnyManifest } from '../fileFormat';

describe('migrateManifest v38 → v39 (P8 — producedPanels field)', () => {
  it('CURRENT_FORMAT_VERSION is 39', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(39);
  });

  it('migrates a v38 assembly to v39 without seeding producedPanels', () => {
    const v38: AnyManifest = {
      formatVersion: 38,
      kind: 'assembly',
      document: { id: 'a', name: 'A', hardware: [] },
    };
    const out = migrateManifest(v38);
    expect(out.formatVersion).toBe(39);
    expect((out.document as { producedPanels?: unknown }).producedPanels).toBeUndefined();
  });

  it('round-trips a producedPanels entry at v39', () => {
    const manifest: AnyManifest = {
      formatVersion: 39,
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
        producedPanels: { '3:1': true },
      },
    };
    const json = JSON.stringify(manifest);
    const parsed = JSON.parse(json) as AnyManifest;
    const out = migrateManifest(parsed);
    const doc = out.document as { producedPanels?: unknown };
    expect(doc.producedPanels).toEqual({ '3:1': true });
  });
});
