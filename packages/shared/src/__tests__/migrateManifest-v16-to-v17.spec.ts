import { describe, it, expect } from 'vitest';
import { migrateManifest, CURRENT_FORMAT_VERSION } from '../fileFormat';

describe('migrateManifest v16 → v17 (Drawing F3 — no-op additive)', () => {
  it('CURRENT_FORMAT_VERSION is 17', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(20);
  });

  it('passes a v16 part through to v17 without data loss', () => {
    const v16Part = {
      formatVersion: 16, kind: 'part',
      document: {
        id: 'p1', name: 'Shelf', units: 'mm',
        parameters: {}, featureTree: [], properties: {},
        materials: [], hardware: [],
      },
    };
    const out = migrateManifest(v16Part) as { formatVersion: number; kind: string };
    expect(out.formatVersion).toBe(20);
    expect(out.kind).toBe('part');
  });

  it('passes a v16 assembly through to v17 without data loss', () => {
    const v16Asm = {
      formatVersion: 16, kind: 'assembly',
      document: {
        id: 'a1', name: 'Wardrobe', units: 'mm',
        parameters: {}, components: [], constraints: [],
        groundedComponentPaths: [], colors: {},
        bomItemNumbers: {}, cutListItemNumbers: {},
        colorOverrides: {}, properties: {},
        materials: [], hardware: [],
      },
    };
    const out = migrateManifest(v16Asm) as { formatVersion: number };
    expect(out.formatVersion).toBe(20);
  });

  it('passes a v16 drawing with no breaks through to v17 unchanged', () => {
    const v16Drawing = {
      formatVersion: 16, kind: 'drawing',
      document: {
        id: 'draw-1', name: 'Box — Drawing', units: 'mm',
        source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
        properties: {},
        sheets: [{
          id: 's1', name: 'Sheet 1',
          size: { kind: 'iso', size: 'A3' },
          orientation: 'landscape',
          views: [{
            id: 'v1', kind: 'base',
            positionMm: { x: 10, y: 10 },
            scale: { numerator: 1, denominator: 1 },
            orientation: 'front',
            showHidden: false,
          }],
          dimensions: [], annotations: [], titleBlock: {},
        }],
        activeSheetId: 's1',
      },
    };
    const out = migrateManifest(v16Drawing) as {
      formatVersion: number;
      kind: string;
      document: { name: string; sheets: Array<{ views: Array<{ breaks?: unknown }> }> };
    };
    expect(out.formatVersion).toBe(20);
    expect(out.kind).toBe('drawing');
    expect(out.document.name).toBe('Box — Drawing');
    // No breaks field injected — additive only
    expect(out.document.sheets[0]!.views[0]!.breaks).toBeUndefined();
  });

  it('v17 drawing with BaseView carrying breaks round-trips through JSON intact', () => {
    const v17Drawing = {
      formatVersion: 17, kind: 'drawing',
      document: {
        id: 'draw-2', name: 'Cabinet — Drawing', units: 'mm',
        source: { partPath: 'parts/cabinet.zipt', sourceKind: 'part' },
        properties: {},
        sheets: [{
          id: 's1', name: 'Sheet 1',
          size: { kind: 'iso', size: 'A3' },
          orientation: 'landscape',
          views: [{
            id: 'v1', kind: 'base',
            positionMm: { x: 10, y: 10 },
            scale: { numerator: 1, denominator: 1 },
            orientation: 'front',
            showHidden: false,
            breaks: [{ id: 'b1', axis: 'x', coordA: 50, coordB: 150, gapMm: 5, style: 'zigzag' }],
          }],
          dimensions: [], annotations: [], titleBlock: {},
        }],
        activeSheetId: 's1',
      },
    };
    const serialised = JSON.parse(JSON.stringify(v17Drawing));
    const out = migrateManifest(serialised) as {
      formatVersion: number;
      document: { sheets: Array<{ views: Array<{ breaks?: Array<{ axis: string }> }> }> };
    };
    expect(out.formatVersion).toBe(20);
    const view = out.document.sheets[0]!.views[0]!;
    expect(view.breaks).toHaveLength(1);
    expect(view.breaks![0]!.axis).toBe('x');
  });

  it('a v17 manifest passes through migrateManifest without re-migration', () => {
    const v17 = {
      formatVersion: 17, kind: 'part',
      document: {
        id: 'p2', name: 'Panel', units: 'mm',
        parameters: {}, featureTree: [], properties: {},
        materials: [], hardware: [],
      },
    };
    const out = migrateManifest(v17) as { formatVersion: number };
    expect(out.formatVersion).toBe(20);
  });
});
