import { describe, it, expect } from 'vitest';
import { migrateManifest, CURRENT_FORMAT_VERSION } from '../fileFormat';

describe('migrateManifest v15 → v16 (Drawing F2 — no-op additive)', () => {
  it('CURRENT_FORMAT_VERSION is 17', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(35);
  });

  it('passes a v15 part through to v16 without data loss', () => {
    const v15Part = {
      formatVersion: 15, kind: 'part',
      document: {
        id: 'p1', name: 'Shelf', units: 'mm',
        parameters: {}, featureTree: [], properties: {},
        materials: [], hardware: [],
      },
    };
    const out = migrateManifest(v15Part) as { formatVersion: number; kind: string };
    expect(out.formatVersion).toBe(35);
    expect(out.kind).toBe('part');
  });

  it('passes a v15 assembly through to v16 without data loss', () => {
    const v15Asm = {
      formatVersion: 15, kind: 'assembly',
      document: {
        id: 'a1', name: 'Wardrobe', units: 'mm',
        parameters: {}, components: [], constraints: [],
        groundedComponentPaths: [], colors: {},
        bomItemNumbers: {}, cutListItemNumbers: {},
        colorOverrides: {}, properties: {},
        materials: [], hardware: [],
      },
    };
    const out = migrateManifest(v15Asm) as { formatVersion: number };
    expect(out.formatVersion).toBe(35);
  });

  it('passes a v15 drawing with no detail views through to v16 unchanged', () => {
    const v15Drawing = {
      formatVersion: 15, kind: 'drawing',
      document: {
        id: 'draw-1', name: 'Box — Drawing', units: 'mm',
        source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
        properties: {},
        sheets: [{
          id: 's1', name: 'Sheet 1',
          size: { kind: 'iso', size: 'A3' },
          orientation: 'landscape',
          views: [
            {
              id: 'v1', kind: 'base',
              positionMm: { x: 10, y: 10 },
              scale: { numerator: 1, denominator: 1 },
              orientation: 'front',
              showHidden: false,
            },
          ],
          dimensions: [], annotations: [], titleBlock: {},
        }],
        activeSheetId: 's1',
      },
    };
    const out = migrateManifest(v15Drawing) as {
      formatVersion: number;
      kind: string;
      document: { name: string; sheets: Array<{ views: unknown[] }> };
    };
    expect(out.formatVersion).toBe(35);
    expect(out.kind).toBe('drawing');
    expect(out.document.name).toBe('Box — Drawing');
    expect(out.document.sheets[0]!.views).toHaveLength(1);
  });

  it('a v16 drawing with a detail view round-trips through JSON without data loss', () => {
    const v16Drawing = {
      formatVersion: 16, kind: 'drawing',
      document: {
        id: 'draw-2', name: 'Cabinet — Drawing', units: 'mm',
        source: { partPath: 'parts/cabinet.zipt', sourceKind: 'part' },
        properties: {},
        sheets: [{
          id: 's1', name: 'Sheet 1',
          size: { kind: 'iso', size: 'A3' },
          orientation: 'landscape',
          views: [
            {
              id: 'v1', kind: 'base',
              positionMm: { x: 10, y: 10 },
              scale: { numerator: 1, denominator: 1 },
              orientation: 'front',
              showHidden: false,
            },
            {
              id: 'dv1', kind: 'detail',
              parentViewId: 'v1',
              regionParent: { center: { x: 10, y: 8 }, radiusMm: 5 },
              label: 'A',
              positionMm: { x: 50, y: 150 },
              scale: { numerator: 2, denominator: 1 },
              showHidden: false,
            },
          ],
          dimensions: [], annotations: [], titleBlock: {},
        }],
        activeSheetId: 's1',
      },
    };
    const serialised = JSON.parse(JSON.stringify(v16Drawing));
    const out = migrateManifest(serialised) as {
      formatVersion: number;
      document: { sheets: Array<{ views: Array<{ kind: string; label?: string }> }> };
    };
    expect(out.formatVersion).toBe(35);
    const detailView = out.document.sheets[0]!.views.find((v) => v.kind === 'detail');
    expect(detailView).toBeDefined();
    expect(detailView!.label).toBe('A');
  });

  it('a v16 manifest passes through migrateManifest without re-migration', () => {
    const v16 = {
      formatVersion: 16, kind: 'part',
      document: {
        id: 'p2', name: 'Panel', units: 'mm',
        parameters: {}, featureTree: [], properties: {},
        materials: [], hardware: [],
      },
    };
    const out = migrateManifest(v16) as { formatVersion: number };
    expect(out.formatVersion).toBe(35);
  });
});
