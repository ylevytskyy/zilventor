import { describe, it, expect } from 'vitest';
import { migrateManifest, CURRENT_FORMAT_VERSION, type AnyManifest } from '../fileFormat';

describe('migrateManifest v34 → v35 (P3 W1 — machining presets / CAM metadata fields)', () => {
  it('CURRENT_FORMAT_VERSION is 35', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(36);
  });

  it('migrates a v34 part manifest to v35 (additive no-op)', () => {
    const v34: AnyManifest = {
      formatVersion: 34,
      kind: 'part',
      document: { id: 'p1', featureTree: [{ kind: 'panel', id: 'pf1' }] },
    };
    const out = migrateManifest(v34);
    expect(out.formatVersion).toBe(36);
    const tree = (out.document as { featureTree: unknown[] }).featureTree;
    const panel = tree.find((f) => (f as { kind?: string }).kind === 'panel') as { id: string } | undefined;
    expect(panel?.id).toBe('pf1');
  });

  it('v35 bore op with toolNumber/speed/presetLayerName round-trips through migrateManifest unchanged', () => {
    const bore = {
      id: 'b1', face: { featureId: 'panel', role: 'Left', instance: 0 },
      u: 10, v: 20, diameter: 5, depth: 13, role: 'confirmat-face',
      connectorId: 'c0', connectorKind: 'confirmat',
      toolNumber: 3, speed: 3200, presetLayerName: 'DRILL_D5',
    };
    const manifest: AnyManifest = {
      formatVersion: 36,
      kind: 'part',
      document: {
        id: 'p2', featureTree: [], properties: {}, materials: [], hardware: [], bores: [bore],
      },
    };
    const out = migrateManifest(JSON.parse(JSON.stringify(manifest)) as AnyManifest);
    const doc = out.document as { bores: Array<Record<string, unknown>> };
    expect(doc.bores[0]).toEqual(bore);
  });
});
