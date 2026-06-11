import { describe, it, expect } from 'vitest';
import { migrateManifest, CURRENT_FORMAT_VERSION } from '../fileFormat';

describe('migrateManifest v24 → v25 (присадка slice 6: handleScrew additive, no-op)', () => {
  it('CURRENT_FORMAT_VERSION is 25', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(25);
  });

  it('migrates a v24 doc to v25 with no field loss', () => {
    const v24 = {
      formatVersion: 24,
      kind: 'part',
      document: {
        id: 'test-part',
        name: 'Front Panel',
        units: 'mm',
        parameters: {},
        featureTree: [],
        properties: {},
        materials: [],
        hardware: [],
        customTextures: [],
      },
    };
    const result = migrateManifest(v24) as { formatVersion: number; document: Record<string, unknown> };
    expect(result.formatVersion).toBe(25);
    expect((result.document as { name: string }).name).toBe('Front Panel');
  });

  it('v24 doc with a handleScrew bore survives migration intact', () => {
    const v24 = {
      formatVersion: 24,
      kind: 'part',
      document: {
        id: 'test-front',
        name: 'Drawer Front',
        units: 'mm',
        parameters: {},
        featureTree: [
          { kind: 'panel', id: 'p1', length: 500, width: 200, thickness: 19 },
        ],
        properties: {},
        materials: [],
        hardware: [],
        bores: [
          {
            id: 'bore-1',
            face: { featureId: 'panel', role: 'Top', instance: 0 },
            u: 250,
            v: 52,
            diameter: 5,
            depth: 'throughAll',
            role: 'handleScrew-face',
            connectorId: 'conn-1',
            connectorKind: 'handleScrew',
          },
        ],
      },
    };
    const result = migrateManifest(v24) as { formatVersion: number; document: Record<string, unknown> };
    expect(result.formatVersion).toBe(25);
    const bores = (result.document as { bores: Array<Record<string, unknown>> }).bores;
    expect(bores).toHaveLength(1);
    expect(bores[0]!.connectorKind).toBe('handleScrew');
    expect(bores[0]!.role).toBe('handleScrew-face');
  });
});
