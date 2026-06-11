import { describe, it, expect } from 'vitest';
import { migrateManifest, CURRENT_FORMAT_VERSION } from '../fileFormat';

describe('migrateManifest v17 → v18 (Drawing F1.1 — half-section mode back-fill)', () => {
  it('CURRENT_FORMAT_VERSION is 18', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(25);
  });

  it('v17 drawing with SectionView missing mode → v18 view has mode: full', () => {
    const v17 = {
      formatVersion: 17, kind: 'drawing',
      document: {
        id: 'draw-1', name: 'Box Drawing', units: 'mm',
        source: { partPath: 'parts/box.zipt', sourceKind: 'part' }, properties: {},
        sheets: [{
          id: 's1', name: 'Sheet 1',
          size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
          views: [
            { id: 'base-1', kind: 'base', positionMm: { x: 10, y: 10 }, scale: { numerator: 1, denominator: 1 }, orientation: 'front', showHidden: false },
            { id: 'sec-1', kind: 'section', parentViewId: 'base-1', sectionLine: { p0: { x: 0, y: 50 }, p1: { x: 200, y: 50 } }, arrowDirection: 1, label: 'A', positionMm: { x: 10, y: 130 }, scale: { numerator: 1, denominator: 1 }, showHidden: false, hatchSegments: [], fingerprint: 'abc' },
          ],
          dimensions: [], annotations: [], titleBlock: {},
        }],
        activeSheetId: 's1',
      },
    };
    const out = migrateManifest(v17) as { formatVersion: number; document: { sheets: Array<{ views: Array<{ kind: string; mode?: string; cutSide?: unknown; splitPlane?: unknown }> }> } };
    expect(out.formatVersion).toBe(25);
    const sv = out.document.sheets[0]!.views.find(v => v.kind === 'section')!;
    expect(sv.mode).toBe('full');
    expect(sv.cutSide).toBeUndefined();
    expect(sv.splitPlane).toBeUndefined();
  });

  it('v17 with multiple SectionViews → all back-filled with mode: full', () => {
    const v17 = {
      formatVersion: 17, kind: 'drawing',
      document: {
        id: 'draw-2', name: 'Test', units: 'mm',
        source: { partPath: 'p.zipt', sourceKind: 'part' }, properties: {},
        sheets: [{
          id: 's1', name: 'Sheet 1', size: { kind: 'iso', size: 'A4' }, orientation: 'landscape',
          views: [
            { id: 'b1', kind: 'base', positionMm: { x: 10, y: 10 }, scale: { numerator: 1, denominator: 1 }, orientation: 'front', showHidden: false },
            { id: 'sec-a', kind: 'section', parentViewId: 'b1', sectionLine: { p0: { x: 0, y: 30 }, p1: { x: 100, y: 30 } }, arrowDirection: 1, label: 'A', positionMm: { x: 10, y: 120 }, scale: { numerator: 1, denominator: 1 }, showHidden: false, hatchSegments: [], fingerprint: 'fp1' },
            { id: 'sec-b', kind: 'section', parentViewId: 'b1', sectionLine: { p0: { x: 0, y: 60 }, p1: { x: 100, y: 60 } }, arrowDirection: -1, label: 'B', positionMm: { x: 10, y: 220 }, scale: { numerator: 1, denominator: 1 }, showHidden: false, hatchSegments: [], fingerprint: 'fp2' },
          ],
          dimensions: [], annotations: [], titleBlock: {},
        }],
        activeSheetId: 's1',
      },
    };
    const out = migrateManifest(v17) as { formatVersion: number; document: { sheets: Array<{ views: Array<{ kind: string; mode?: string }> }> } };
    const svs = out.document.sheets[0]!.views.filter(v => v.kind === 'section');
    expect(svs).toHaveLength(2);
    expect(svs.every(v => v.mode === 'full')).toBe(true);
  });

  it('v17 non-drawing passes through to v18 unchanged', () => {
    const v17 = { formatVersion: 17, kind: 'part', document: { id: 'p1', name: 'Panel', units: 'mm', parameters: {}, featureTree: [], properties: {}, materials: [], hardware: [] } };
    const out = migrateManifest(v17) as { formatVersion: number; kind: string };
    expect(out.formatVersion).toBe(25);
    expect(out.kind).toBe('part');
  });

  it('v18 drawing with mode: half round-trips intact', () => {
    const v18 = {
      formatVersion: 18, kind: 'drawing',
      document: {
        id: 'draw-3', name: 'Half Test', units: 'mm',
        source: { partPath: 'b.zipt', sourceKind: 'part' }, properties: {},
        sheets: [{
          id: 's1', name: 'Sheet 1', size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
          views: [
            { id: 'base-1', kind: 'base', positionMm: { x: 10, y: 10 }, scale: { numerator: 1, denominator: 1 }, orientation: 'front', showHidden: false },
            { id: 'hs-1', kind: 'section', parentViewId: 'base-1', sectionLine: { p0: { x: 0, y: 50 }, p1: { x: 200, y: 50 } }, arrowDirection: 1, label: 'A', positionMm: { x: 10, y: 180 }, scale: { numerator: 1, denominator: 1 }, showHidden: false, mode: 'half', cutSide: 1, splitPlane: { origin: { x: 100, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } }, hatchSegments: [], fingerprint: 'fp-half' },
          ],
          dimensions: [], annotations: [], titleBlock: {},
        }],
        activeSheetId: 's1',
      },
    };
    const out = migrateManifest(JSON.parse(JSON.stringify(v18))) as { formatVersion: number; document: { sheets: Array<{ views: Array<{ kind: string; mode?: string; cutSide?: number; splitPlane?: { origin: { x: number }; normal: { y: number } } }> }> } };
    expect(out.formatVersion).toBe(25);
    const hsv = out.document.sheets[0]!.views.find(v => v.kind === 'section')!;
    expect(hsv.mode).toBe('half');
    expect(hsv.cutSide).toBe(1);
    expect(hsv.splitPlane).toBeDefined();
    expect(hsv.splitPlane!.origin.x).toBe(100);
    expect(hsv.splitPlane!.normal.y).toBe(1);
  });

  it('v18 manifest passes through without re-migration', () => {
    const v18 = { formatVersion: 18, kind: 'part', document: { id: 'p2', name: 'Shelf', units: 'mm', parameters: {}, featureTree: [], properties: {}, materials: [], hardware: [] } };
    const out = migrateManifest(v18) as { formatVersion: number };
    expect(out.formatVersion).toBe(25);
  });

  // SS-MIG-1: v18 drawing with mode: 'stepped' + valid stepSegments round-trips intact
  // (manifest stays at v18; stepSegments? is additive per spec §4.6 / §9.1)
  it('SS-MIG-1: v18 drawing with mode: stepped + valid stepSegments round-trips intact', () => {
    const v18 = {
      formatVersion: 18, kind: 'drawing',
      document: {
        id: 'draw-step', name: 'Stepped Test', units: 'mm',
        source: { partPath: 'b.zipt', sourceKind: 'part' }, properties: {},
        sheets: [{
          id: 's1', name: 'Sheet 1', size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
          views: [
            { id: 'base-1', kind: 'base', positionMm: { x: 10, y: 10 }, scale: { numerator: 1, denominator: 1 }, orientation: 'front', showHidden: false },
            {
              id: 'ss-1', kind: 'section', parentViewId: 'base-1',
              sectionLine: { p0: { x: 0, y: 0 }, p1: { x: 120, y: 30 } },
              arrowDirection: 1, label: 'A',
              positionMm: { x: 80, y: 180 },
              scale: { numerator: 1, denominator: 1 }, showHidden: false,
              mode: 'stepped',
              stepSegments: [
                { startSheet: { x:  0, y:  0 }, endSheet: { x: 60, y:  0 } },
                { startSheet: { x: 60, y:  0 }, endSheet: { x: 60, y: 30 } },
                { startSheet: { x: 60, y: 30 }, endSheet: { x: 120, y: 30 } },
              ],
              hatchSegments: [], fingerprint: 'fp-stepped',
            },
          ],
          dimensions: [], annotations: [], titleBlock: {},
        }],
        activeSheetId: 's1',
      },
    };
    const out = migrateManifest(JSON.parse(JSON.stringify(v18))) as {
      formatVersion: number;
      document: {
        sheets: Array<{
          views: Array<{
            kind: string;
            mode?: string;
            stepSegments?: ReadonlyArray<{ startSheet: { x: number; y: number }; endSheet: { x: number; y: number } }>;
            cutSide?: unknown;
            splitPlane?: unknown;
          }>;
        }>;
      };
    };
    expect(out.formatVersion).toBe(25);
    const ss = out.document.sheets[0]!.views.find(v => v.kind === 'section')!;
    expect(ss.mode).toBe('stepped');
    expect(ss.stepSegments).toBeDefined();
    expect(ss.stepSegments!).toHaveLength(3);
    expect(ss.stepSegments![0]!.startSheet).toEqual({ x: 0, y: 0 });
    expect(ss.stepSegments![0]!.endSheet).toEqual({ x: 60, y: 0 });
    expect(ss.stepSegments![2]!.endSheet).toEqual({ x: 120, y: 30 });
    expect(ss.cutSide).toBeUndefined();
    expect(ss.splitPlane).toBeUndefined();
  });
});
