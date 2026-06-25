/**
 * Regression test: BoreOp.edited?, BoreOp.jointDir?, PartDocument.suppressedConnectorIds?
 * must remain ABSENT (key not present in JSON) after a v22 → v23 migration round-trip.
 * Tests the absent-not-reified contract required by exactOptionalPropertyTypes.
 */
import { describe, it, expect } from 'vitest';
import { migrateManifest, type AnyManifest } from '../fileFormat';

const V22_PART_WITH_BORES: AnyManifest = {
  formatVersion: 22,
  kind: 'part',
  document: {
    id: 'panel-left',
    name: 'Left Panel',
    units: 'mm',
    parameters: {},
    featureTree: [],
    properties: {},
    materials: [],
    hardware: [],
    bores: [
      {
        id: 'confirmat-0-face',
        face: { featureId: 'panel', role: 'Left', instance: 0 },
        u: 32,
        v: 96,
        diameter: 7,
        depth: 12,
        role: 'confirmat-face',
        connectorId: 'confirmat-0',
        connectorKind: 'confirmat',
      },
      {
        id: 'confirmat-0-edge',
        face: { featureId: 'panel', role: 'Bottom', instance: 0 },
        u: 8,
        v: 96,
        diameter: 5,
        depth: 30,
        role: 'confirmat-edge',
        connectorId: 'confirmat-0',
        connectorKind: 'confirmat',
      },
    ],
  },
};

describe('v22→v23 absent-not-reified round-trip', () => {
  it('migrated manifest has formatVersion 24', () => {
    const out = migrateManifest(V22_PART_WITH_BORES);
    expect(out.formatVersion).toBe(33);
  });

  it('suppressedConnectorIds key is absent on the document (not [] or null or undefined)', () => {
    const out = migrateManifest(V22_PART_WITH_BORES);
    const doc = out.document as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(doc, 'suppressedConnectorIds')).toBe(false);
  });

  it('suppressedConnectorIds is absent from the serialised JSON string', () => {
    const out = migrateManifest(V22_PART_WITH_BORES);
    const json = JSON.stringify(out);
    expect(json).not.toContain('suppressedConnectorIds');
  });

  it('each bore lacks the edited key entirely (not false / undefined)', () => {
    const out = migrateManifest(V22_PART_WITH_BORES);
    const doc = out.document as { bores?: Array<Record<string, unknown>> };
    expect(doc.bores).toHaveLength(2);
    for (const bore of doc.bores!) {
      expect(Object.prototype.hasOwnProperty.call(bore, 'edited')).toBe(false);
    }
  });

  it('edited is absent from the serialised JSON string', () => {
    const out = migrateManifest(V22_PART_WITH_BORES);
    const json = JSON.stringify(out);
    expect(json).not.toContain('"edited"');
  });

  it('each bore lacks the jointDir key entirely (not null / undefined / {x:0,y:0,z:0})', () => {
    const out = migrateManifest(V22_PART_WITH_BORES);
    const doc = out.document as { bores?: Array<Record<string, unknown>> };
    for (const bore of doc.bores!) {
      expect(Object.prototype.hasOwnProperty.call(bore, 'jointDir')).toBe(false);
    }
  });

  it('jointDir is absent from the serialised JSON string', () => {
    const out = migrateManifest(V22_PART_WITH_BORES);
    const json = JSON.stringify(out);
    expect(json).not.toContain('"jointDir"');
  });

  it('a bore that had edited:true before migration survives unchanged (migration is no-op)', () => {
    // Simulate a file that was already written with edited:true (future file opened on old → new)
    const v22WithEdited: AnyManifest = {
      ...V22_PART_WITH_BORES,
      document: {
        ...(V22_PART_WITH_BORES.document as object),
        bores: [
          {
            id: 'confirmat-0-face',
            face: { featureId: 'panel', role: 'Left', instance: 0 },
            u: 35,
            v: 96,
            diameter: 7,
            depth: 12,
            role: 'confirmat-face',
            connectorId: 'confirmat-0',
            connectorKind: 'confirmat',
            edited: true,
          },
        ],
      },
    };
    const out = migrateManifest(v22WithEdited);
    expect(out.formatVersion).toBe(33);
    const doc = out.document as { bores?: Array<Record<string, unknown>> };
    expect(doc.bores![0]!['edited']).toBe(true);
  });

  it('a bore that had jointDir set before migration survives unchanged (migration is no-op)', () => {
    const v22WithJointDir: AnyManifest = {
      ...V22_PART_WITH_BORES,
      document: {
        ...(V22_PART_WITH_BORES.document as object),
        bores: [
          {
            id: 'confirmat-0-face',
            face: { featureId: 'panel', role: 'Left', instance: 0 },
            u: 32,
            v: 96,
            diameter: 7,
            depth: 12,
            role: 'confirmat-face',
            connectorId: 'confirmat-0',
            connectorKind: 'confirmat',
            jointDir: { x: 0, y: 1, z: 0 },
          },
        ],
      },
    };
    const out = migrateManifest(v22WithJointDir);
    expect(out.formatVersion).toBe(33);
    const doc = out.document as { bores?: Array<Record<string, unknown>> };
    expect(doc.bores![0]!['jointDir']).toEqual({ x: 0, y: 1, z: 0 });
  });
});

// ── TWO-WAY round-trip: fields written survive JSON serialisation ──────────────

describe('v23 two-way round-trip: edited + jointDir + suppressedConnectorIds survive pack/unpack', () => {
  /**
   * Simulate what ClearBoresCommand.persist() does: mutate in-memory manifest,
   * JSON.stringify, then parse back and run migrateManifest (which is a no-op at v23).
   * Asserts the three new fields survive the wire format without coercion.
   */

  const BASE_DOC = {
    id: 'panel-left', name: 'Left Panel', units: 'mm' as const,
    parameters: {}, featureTree: [], properties: {}, materials: [], hardware: [],
  };

  it('edited:true survives JSON round-trip on a v23 bore', () => {
    const manifest = {
      formatVersion: 23,
      kind: 'part',
      document: {
        ...BASE_DOC,
        bores: [
          {
            id: 'confirmat-0-face',
            face: { featureId: 'panel', role: 'Left', instance: 0 },
            u: 35, v: 96, diameter: 7, depth: 12,
            role: 'confirmat-face', connectorId: 'confirmat-0', connectorKind: 'confirmat',
            edited: true,
          },
        ],
      },
    } as AnyManifest;

    const json = JSON.stringify(manifest);
    const parsed = JSON.parse(json) as AnyManifest;
    const out = migrateManifest(parsed);   // no-op at v23

    const doc = out.document as { bores?: Array<Record<string, unknown>> };
    expect(doc.bores).toHaveLength(1);
    expect(doc.bores![0]!['edited']).toBe(true);
    // key must actually be present (not undefined from JSON.parse omission)
    expect(Object.prototype.hasOwnProperty.call(doc.bores![0], 'edited')).toBe(true);
  });

  it('jointDir:{x,y,z} survives JSON round-trip on a v23 bore', () => {
    const manifest = {
      formatVersion: 23,
      kind: 'part',
      document: {
        ...BASE_DOC,
        bores: [
          {
            id: 'confirmat-0-edge',
            face: { featureId: 'panel', role: 'Bottom', instance: 0 },
            u: 8, v: 96, diameter: 5, depth: 30,
            role: 'confirmat-edge', connectorId: 'confirmat-0', connectorKind: 'confirmat',
            jointDir: { x: 0, y: 1, z: 0 },
          },
        ],
      },
    } as AnyManifest;

    const json = JSON.stringify(manifest);
    const parsed = JSON.parse(json) as AnyManifest;
    const out = migrateManifest(parsed);

    const doc = out.document as { bores?: Array<Record<string, unknown>> };
    expect(doc.bores![0]!['jointDir']).toEqual({ x: 0, y: 1, z: 0 });
  });

  it('suppressedConnectorIds:["c0"] survives JSON round-trip on a v23 part doc', () => {
    const manifest = {
      formatVersion: 23,
      kind: 'part',
      document: {
        ...BASE_DOC,
        suppressedConnectorIds: ['confirmat-0', 'pin-col-front'],
      },
    } as AnyManifest;

    const json = JSON.stringify(manifest);
    const parsed = JSON.parse(json) as AnyManifest;
    const out = migrateManifest(parsed);

    const doc = out.document as Record<string, unknown>;
    expect(doc['suppressedConnectorIds']).toEqual(['confirmat-0', 'pin-col-front']);
  });

  it('absent edited/jointDir/suppressedConnectorIds remain absent after round-trip (not reified)', () => {
    // A bore with NO edited/jointDir and a doc with NO suppressedConnectorIds
    const manifest = {
      formatVersion: 23,
      kind: 'part',
      document: {
        ...BASE_DOC,
        bores: [
          {
            id: 'confirmat-0-face',
            face: { featureId: 'panel', role: 'Left', instance: 0 },
            u: 32, v: 96, diameter: 7, depth: 12,
            role: 'confirmat-face', connectorId: 'confirmat-0', connectorKind: 'confirmat',
          },
        ],
      },
    } as AnyManifest;

    const json = JSON.stringify(manifest);
    // Confirm: absent optional fields are NOT in the JSON string at all
    expect(json).not.toContain('"edited"');
    expect(json).not.toContain('"jointDir"');
    expect(json).not.toContain('"suppressedConnectorIds"');

    const parsed = JSON.parse(json) as AnyManifest;
    const out = migrateManifest(parsed);
    const doc = out.document as Record<string, unknown>;
    const bore = (doc['bores'] as Array<Record<string, unknown>>)[0]!;

    expect(Object.prototype.hasOwnProperty.call(bore, 'edited')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(bore, 'jointDir')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(doc, 'suppressedConnectorIds')).toBe(false);
  });
});
