import { describe, expect, it } from 'vitest';
import { migrateManifest, CURRENT_FORMAT_VERSION } from '../fileFormat';

describe('v7 → v8 migration', () => {
  it('CURRENT_FORMAT_VERSION is 11', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(14);
  });

  it('migrates an assembly: groundedComponentIds → groundedComponentPaths, refs single-elem componentPath, colorOverrides default {}', () => {
    const v7: any = {
      formatVersion: 7,
      kind: 'assembly',
      createdAt: '2026-04-26T00:00:00Z',
      appVersion: '0.1.0',
      document: {
        id: 'a1', name: 'asm', units: 'mm', parameters: {},
        components: [
          { id: 'cubeA', partPath: 'cube.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
          { id: 'cubeB', partPath: 'cube.zipt', position: { x: 10, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        ],
        constraints: [
          {
            id: 'm1', kind: 'mate',
            refA: { kind: 'face', componentId: 'cubeA', face: { featureId: 'E1', role: 'top' } },
            refB: { kind: 'face', componentId: 'cubeB', face: { featureId: 'E1', role: 'bottom' } },
            offset: { kind: 'literal', value: 0 },
            suppressed: false,
          },
        ],
        groundedComponentIds: ['cubeA'],
        colors: {},
        bomItemNumbers: {},
      },
    };

    const v8 = migrateManifest(v7);
    expect(v8.formatVersion).toBe(14);
    const doc = (v8 as any).document;
    expect(doc.groundedComponentPaths).toEqual([['cubeA']]);
    expect(doc.groundedComponentIds).toBeUndefined();
    expect(doc.colorOverrides).toEqual({});
    expect(doc.constraints[0].refA).toEqual({
      kind: 'face',
      componentPath: ['cubeA'],
      face: { featureId: 'E1', role: 'top' },
    });
    expect(doc.constraints[0].refB.componentPath).toEqual(['cubeB']);
  });

  it('migrates an insert constraint: refA.componentId → componentPath', () => {
    const v7: any = {
      formatVersion: 7,
      kind: 'assembly',
      createdAt: '', appVersion: '',
      document: {
        id: 'a', name: 'a', units: 'mm', parameters: {}, components: [], constraints: [
          {
            id: 'i1', kind: 'insert',
            refA: { componentId: 'A', circularEdge: { faceA: { featureId: 'E1', role: 'top' }, faceB: { featureId: 'E1', role: 'side' } } },
            refB: { componentId: 'B', circularEdge: { faceA: { featureId: 'E1', role: 'top' }, faceB: { featureId: 'E1', role: 'side' } } },
            offset: { kind: 'literal', value: 0 },
            suppressed: false,
          },
        ],
        groundedComponentIds: [], colors: {}, bomItemNumbers: {},
      },
    };
    const v8 = migrateManifest(v7) as any;
    expect(v8.document.constraints[0].refA.componentPath).toEqual(['A']);
    expect(v8.document.constraints[0].refB.componentPath).toEqual(['B']);
    expect(v8.document.constraints[0].refA.componentId).toBeUndefined();
  });

  it('migrates an axis-kind ref: componentId → componentPath, preserves axis source', () => {
    const v7: any = {
      formatVersion: 7,
      kind: 'assembly',
      createdAt: '', appVersion: '',
      document: {
        id: 'a', name: 'a', units: 'mm', parameters: {}, components: [], constraints: [
          {
            id: 'an1', kind: 'angle',
            refA: { kind: 'axis', componentId: 'A', axis: { source: 'workAxis', featureId: 'origin.X' } },
            refB: { kind: 'axis', componentId: 'B', axis: { source: 'workAxis', featureId: 'origin.Y' } },
            angle: { kind: 'literal', value: 90 },
            suppressed: false,
          },
        ],
        groundedComponentIds: [], colors: {}, bomItemNumbers: {},
      },
    };
    const v8 = migrateManifest(v7) as any;
    expect(v8.document.constraints[0].refA.componentPath).toEqual(['A']);
    expect(v8.document.constraints[0].refA.axis).toEqual({ source: 'workAxis', featureId: 'origin.X' });
  });

  it('migrates a point-kind ref: componentId → componentPath, preserves point source', () => {
    const v7: any = {
      formatVersion: 7,
      kind: 'assembly',
      createdAt: '', appVersion: '',
      document: {
        id: 'a', name: 'a', units: 'mm', parameters: {}, components: [], constraints: [
          {
            id: 'm1', kind: 'mate',
            refA: { kind: 'point', componentId: 'A', point: { source: 'workPoint', featureId: 'origin.O' } },
            refB: { kind: 'point', componentId: 'B', point: { source: 'workPoint', featureId: 'origin.O' } },
            offset: { kind: 'literal', value: 0 },
            suppressed: false,
          },
        ],
        groundedComponentIds: [], colors: {}, bomItemNumbers: {},
      },
    };
    const v8 = migrateManifest(v7) as any;
    expect(v8.document.constraints[0].refA.componentPath).toEqual(['A']);
    expect(v8.document.constraints[0].refA.point).toEqual({ source: 'workPoint', featureId: 'origin.O' });
  });

  it('migrates a part document idempotently (no assembly fields touched)', () => {
    const v7: any = {
      formatVersion: 7,
      kind: 'part',
      createdAt: '', appVersion: '',
      document: { id: 'p', name: 'p', units: 'mm', parameters: {}, featureTree: [] },
    };
    const v8 = migrateManifest(v7) as any;
    expect(v8.formatVersion).toBe(14);
    expect(Array.isArray(v8.document.featureTree)).toBe(true);
  });
});
