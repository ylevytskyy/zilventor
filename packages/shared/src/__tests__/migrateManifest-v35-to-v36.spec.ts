import { describe, it, expect } from 'vitest';
import { migrateManifest, CURRENT_FORMAT_VERSION, type AnyManifest } from '../fileFormat';

describe('migrateManifest v35 → v36 (P4 — statistics data model: MaterialEntry.kind, unitPrices)', () => {
  it('CURRENT_FORMAT_VERSION is 36', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(39);
  });

  it('migrates a v35 part manifest to v36 (additive no-op)', () => {
    const v35: AnyManifest = {
      formatVersion: 35,
      kind: 'part',
      document: { id: 'p1', featureTree: [{ kind: 'panel', id: 'pf1' }], materials: [] },
    };
    const out = migrateManifest(v35);
    expect(out.formatVersion).toBe(39);
    const tree = (out.document as { featureTree: unknown[] }).featureTree;
    const panel = tree.find((f) => (f as { kind?: string }).kind === 'panel') as { id: string } | undefined;
    expect(panel?.id).toBe('pf1');
  });

  it('migrates a v35 assembly manifest to v36 without mutating other fields', () => {
    const v35: AnyManifest = {
      formatVersion: 35,
      kind: 'assembly',
      document: {
        id: 'a1', name: 'A', units: 'mm', parameters: {},
        components: [], constraints: [], groundedComponentPaths: [],
        colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
        properties: {}, materials: [{ id: 'm1', name: 'Birch', defaultThickness: 18, color: '#d8c896' }],
        hardware: [],
      },
    };
    const out = migrateManifest(v35);
    expect(out.formatVersion).toBe(39);
    const doc = out.document as { materials: unknown[] };
    expect(doc.materials).toEqual([{ id: 'm1', name: 'Birch', defaultThickness: 18, color: '#d8c896' }]);
  });

  it('a v36 material with kind:"linear" and a document with unitPrices round-trips through migrateManifest unchanged', () => {
    const manifest: AnyManifest = {
      formatVersion: 36,
      kind: 'assembly',
      document: {
        id: 'a2', name: 'A2', units: 'mm', parameters: {},
        components: [], constraints: [], groundedComponentPaths: [],
        colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
        properties: {},
        materials: [{ id: 'm2', name: 'Edge trim', defaultThickness: 18, color: '#ffffff', kind: 'linear' }],
        hardware: [],
        unitPrices: { 'material:m2': 3.5 },
      },
    };
    const out = migrateManifest(JSON.parse(JSON.stringify(manifest)) as AnyManifest);
    const doc = out.document as { materials: Array<Record<string, unknown>>; unitPrices: Record<string, number> };
    expect(doc.materials[0]!.kind).toBe('linear');
    expect(doc.unitPrices).toEqual({ 'material:m2': 3.5 });
  });
});
