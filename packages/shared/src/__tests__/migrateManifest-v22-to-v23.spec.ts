import { describe, it, expect } from 'vitest';
import { migrateManifest, CURRENT_FORMAT_VERSION, type AnyManifest } from '../fileFormat';

/**
 * Dedicated migration tests for v22 → v23 (присадка slice 3: live-edit + hardware-BOM).
 * v23 adds BoreOp.edited?, BoreOp.jointDir?, PartDocument.suppressedConnectorIds? — all
 * additive/optional. The migration is a no-op: no fields are injected, so absent === unset.
 *
 * Moved/duplicated from fileFormat.spec.ts (~L626-700) to match the per-step file pattern
 * (migrateManifest-v21-to-v22.spec.ts). The embedded fileFormat.spec.ts tests are kept for
 * regression continuity; this file adds pattern-consistent discovery.
 */
describe('migrateManifest v22 → v23 (присадка slice 3: BoreOp.edited/jointDir, suppressedConnectorIds — additive no-op)', () => {
  it('CURRENT_FORMAT_VERSION is 25', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(28);
  });

  it('a v22 part manifest migrates to current without adding edited/jointDir/suppressedConnectorIds', () => {
    const v22: AnyManifest = {
      formatVersion: 22,
      kind: 'part',
      document: {
        id: 'p1', name: 'Panel', units: 'mm', parameters: {},
        featureTree: [], properties: {}, materials: [], hardware: [],
        bores: [
          {
            id: 'c0-face', face: { featureId: 'panel', role: 'Left', instance: 0 },
            u: 32, v: 100, diameter: 7, depth: 12,
            role: 'confirmat-face', connectorId: 'confirmat-0', connectorKind: 'confirmat',
          },
        ],
      },
    };
    const out = migrateManifest(v22);
    expect(out.formatVersion).toBe(28);
    const doc = out.document as {
      bores?: Array<Record<string, unknown>>;
      suppressedConnectorIds?: unknown;
    };
    // suppressedConnectorIds must be absent (not reified as [] or null)
    expect('suppressedConnectorIds' in doc).toBe(false);
    // bores must be unchanged
    expect(doc.bores).toHaveLength(1);
    const bore = doc.bores![0]!;
    // edited must be absent (not injected as false)
    expect('edited' in bore).toBe(false);
    // jointDir must be absent (not injected as undefined / null / {x:0,y:0,z:0})
    expect('jointDir' in bore).toBe(false);
  });

  it('a v22 assembly manifest migrates to current unchanged (no suppressedConnectorIds injected)', () => {
    const v22: AnyManifest = {
      formatVersion: 22,
      kind: 'assembly',
      document: {
        id: 'a1', name: 'Cab', units: 'mm', parameters: {},
        components: [], constraints: [], groundedComponentPaths: [],
        colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
        properties: {}, materials: [], hardware: [],
      },
    };
    const out = migrateManifest(v22);
    expect(out.formatVersion).toBe(28);
    const doc = out.document as Record<string, unknown>;
    expect('suppressedConnectorIds' in doc).toBe(false);
  });

  it('a v23 part manifest passes through unchanged (idempotent)', () => {
    const v23: AnyManifest = {
      formatVersion: 23,
      kind: 'part',
      document: { id: 'p', name: 'P', units: 'mm', parameters: {}, featureTree: [], properties: {}, materials: [], hardware: [] },
    };
    const out = migrateManifest(v23);
    expect(out.formatVersion).toBe(28);
  });

  it('a v23 manifest without a kind field does NOT throw in normalizeKind', () => {
    const v23: AnyManifest = {
      formatVersion: 23,
      // kind deliberately absent to exercise normalizeKind
      document: { properties: {}, materials: [] },
    };
    expect(() => migrateManifest(v23)).not.toThrow();
    expect(migrateManifest(v23).formatVersion).toBe(28);
  });

  it('leaves drawing documents untouched (advances version only)', () => {
    const v22: AnyManifest = {
      formatVersion: 22,
      kind: 'drawing',
      document: { id: 'd', name: 'D', units: 'mm', sheets: [], properties: {} },
    };
    const out = migrateManifest(v22);
    expect(out.formatVersion).toBe(28);
  });

  it('a v22 part with an explicitly-set edited bore field preserves it after migration', () => {
    // Unusual: a v22 file that was hand-edited to include the field already.
    // Migration is additive-only so the field should survive unchanged.
    const v22: AnyManifest = {
      formatVersion: 22,
      kind: 'part',
      document: {
        id: 'px', name: 'PX', units: 'mm', parameters: {}, featureTree: [],
        properties: {}, materials: [], hardware: [],
        bores: [
          {
            id: 'b0', face: { featureId: 'panel', role: 'Left', instance: 0 },
            u: 32, v: 100, diameter: 5, depth: 8,
            role: 'confirmat-face', connectorId: 'c0', connectorKind: 'confirmat',
            edited: true,
          },
        ],
      },
    };
    const out = migrateManifest(v22);
    const doc = out.document as { bores: Array<Record<string, unknown>> };
    expect(doc.bores[0]!['edited']).toBe(true);
  });
});
