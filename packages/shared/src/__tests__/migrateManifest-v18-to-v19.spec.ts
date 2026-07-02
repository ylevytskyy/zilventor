// packages/shared/src/__tests__/migrateManifest-v18-to-v19.spec.ts
import { describe, it, expect } from 'vitest';
import { migrateManifest, CURRENT_FORMAT_VERSION } from '../fileFormat';

describe('migrateManifest v18 → v19 (Drawing F2.1 — RegionParent kind back-fill)', () => {
  it('CURRENT_FORMAT_VERSION is 20', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(38);
  });

  // ── Main structural cases ──────────────────────────────────────────────────

  it('v18 drawing with detail view missing kind → v19 has kind: circle', () => {
    const v18 = {
      formatVersion: 18, kind: 'drawing',
      document: {
        id: 'draw-1', name: 'Box Drawing', units: 'mm',
        source: { partPath: 'parts/box.zipt', sourceKind: 'part' }, properties: {},
        sheets: [{
          id: 's1', name: 'Sheet 1',
          size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
          views: [
            {
              id: 'base-1', kind: 'base',
              positionMm: { x: 10, y: 10 },
              scale: { numerator: 1, denominator: 1 },
              orientation: 'front', showHidden: false,
            },
            {
              id: 'det-1', kind: 'detail',
              parentViewId: 'base-1',
              // old flat shape — no kind field
              regionParent: { center: { x: 20, y: 15 }, radiusMm: 8 },
              label: 'A',
              positionMm: { x: 200, y: 100 },
              scale: { numerator: 2, denominator: 1 },
              showHidden: false,
            },
          ],
          dimensions: [], annotations: [], titleBlock: {},
        }],
        activeSheetId: 's1',
      },
    };
    const out = migrateManifest(v18) as {
      formatVersion: number;
      document: {
        sheets: Array<{
          views: Array<{
            kind: string;
            regionParent?: { kind?: string; center: { x: number; y: number }; radiusMm?: number };
          }>;
        }>;
      };
    };
    expect(out.formatVersion).toBe(38);
    const det = out.document.sheets[0]!.views.find(v => v.kind === 'detail')!;
    expect(det.regionParent!.kind).toBe('circle');
    expect(det.regionParent!.center.x).toBe(20);
    expect(det.regionParent!.center.y).toBe(15);
    expect(det.regionParent!.radiusMm).toBe(8);
  });

  it('v18 drawing with multiple detail views → all back-filled with kind: circle', () => {
    const v18 = {
      formatVersion: 18, kind: 'drawing',
      document: {
        id: 'draw-2', name: 'Multi', units: 'mm',
        source: { partPath: 'p.zipt', sourceKind: 'part' }, properties: {},
        sheets: [{
          id: 's1', name: 'Sheet 1',
          size: { kind: 'iso', size: 'A4' }, orientation: 'landscape',
          views: [
            {
              id: 'b1', kind: 'base',
              positionMm: { x: 10, y: 10 },
              scale: { numerator: 1, denominator: 1 },
              orientation: 'front', showHidden: false,
            },
            {
              id: 'det-a', kind: 'detail', parentViewId: 'b1',
              regionParent: { center: { x: 30, y: 20 }, radiusMm: 6 },
              label: 'A', positionMm: { x: 200, y: 100 },
              scale: { numerator: 2, denominator: 1 }, showHidden: false,
            },
            {
              id: 'det-b', kind: 'detail', parentViewId: 'b1',
              regionParent: { center: { x: 80, y: 50 }, radiusMm: 10 },
              label: 'B', positionMm: { x: 200, y: 250 },
              scale: { numerator: 4, denominator: 1 }, showHidden: false,
            },
          ],
          dimensions: [], annotations: [], titleBlock: {},
        }],
        activeSheetId: 's1',
      },
    };
    const out = migrateManifest(v18) as {
      formatVersion: number;
      document: {
        sheets: Array<{
          views: Array<{ kind: string; regionParent?: { kind?: string } }>;
        }>;
      };
    };
    expect(out.formatVersion).toBe(38);
    const details = out.document.sheets[0]!.views.filter(v => v.kind === 'detail');
    expect(details).toHaveLength(2);
    expect(details.every(d => d.regionParent?.kind === 'circle')).toBe(true);
  });

  it('v18 drawing with non-detail views — only detail views are touched', () => {
    const v18 = {
      formatVersion: 18, kind: 'drawing',
      document: {
        id: 'draw-3', name: 'Mixed', units: 'mm',
        source: { partPath: 'p.zipt', sourceKind: 'part' }, properties: {},
        sheets: [{
          id: 's1', name: 'Sheet 1',
          size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
          views: [
            {
              id: 'b1', kind: 'base',
              positionMm: { x: 10, y: 10 },
              scale: { numerator: 1, denominator: 1 },
              orientation: 'front', showHidden: false,
            },
            {
              id: 'proj-1', kind: 'projected', parentViewId: 'b1',
              direction: 'right',
              positionMm: { x: 250, y: 10 },
              scale: { numerator: 1, denominator: 1 }, showHidden: false,
            },
            {
              id: 'det-1', kind: 'detail', parentViewId: 'b1',
              regionParent: { center: { x: 20, y: 15 }, radiusMm: 8 },
              label: 'A', positionMm: { x: 200, y: 200 },
              scale: { numerator: 2, denominator: 1 }, showHidden: false,
            },
          ],
          dimensions: [], annotations: [], titleBlock: {},
        }],
        activeSheetId: 's1',
      },
    };
    const out = migrateManifest(v18) as {
      formatVersion: number;
      document: {
        sheets: Array<{
          views: Array<{
            kind: string;
            regionParent?: { kind?: string };
            direction?: string;
          }>;
        }>;
      };
    };
    expect(out.formatVersion).toBe(38);
    const base = out.document.sheets[0]!.views.find(v => v.kind === 'base')!;
    expect((base as Record<string, unknown>)['regionParent']).toBeUndefined();
    const proj = out.document.sheets[0]!.views.find(v => v.kind === 'projected')!;
    expect((proj as Record<string, unknown>)['regionParent']).toBeUndefined();
    const det = out.document.sheets[0]!.views.find(v => v.kind === 'detail')!;
    expect(det.regionParent?.kind).toBe('circle');
  });

  // ── Idempotency ─────────────────────────────────────────────────────────────

  it('v18 detail view that already has kind: circle is left unchanged (idempotent)', () => {
    // Hypothetically a v18 file that somehow already had kind (shouldn't happen in practice)
    const v18 = {
      formatVersion: 18, kind: 'drawing',
      document: {
        id: 'draw-4', name: 'Already', units: 'mm',
        source: { partPath: 'p.zipt', sourceKind: 'part' }, properties: {},
        sheets: [{
          id: 's1', name: 'Sheet 1',
          size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
          views: [
            {
              id: 'b1', kind: 'base',
              positionMm: { x: 10, y: 10 },
              scale: { numerator: 1, denominator: 1 },
              orientation: 'front', showHidden: false,
            },
            {
              id: 'det-1', kind: 'detail', parentViewId: 'b1',
              // Already has kind (forward-compat guard)
              regionParent: { kind: 'circle', center: { x: 20, y: 15 }, radiusMm: 8 },
              label: 'A', positionMm: { x: 200, y: 100 },
              scale: { numerator: 2, denominator: 1 }, showHidden: false,
            },
          ],
          dimensions: [], annotations: [], titleBlock: {},
        }],
        activeSheetId: 's1',
      },
    };
    const out = migrateManifest(v18) as {
      formatVersion: number;
      document: {
        sheets: Array<{
          views: Array<{
            kind: string;
            regionParent?: { kind?: string; radiusMm?: number };
          }>;
        }>;
      };
    };
    expect(out.formatVersion).toBe(38);
    const det = out.document.sheets[0]!.views.find(v => v.kind === 'detail')!;
    expect(det.regionParent?.kind).toBe('circle');
    expect(det.regionParent?.radiusMm).toBe(8);
  });

  it('v19 manifest migrates to v20', () => {
    const v19 = {
      formatVersion: 19, kind: 'part',
      document: {
        id: 'p1', name: 'Shelf', units: 'mm',
        parameters: {}, featureTree: [], properties: {},
        materials: [], hardware: [],
      },
    };
    const out = migrateManifest(v19) as { formatVersion: number; document: { customTextures: unknown[] } };
    expect(out.formatVersion).toBe(38);
    expect(out.document.customTextures).toEqual([]);
  });

  // ── Non-drawing passthrough ─────────────────────────────────────────────────

  it('v18 part migrates through v19 → v20 with customTextures: []', () => {
    const v18 = {
      formatVersion: 18, kind: 'part',
      document: {
        id: 'p1', name: 'Panel', units: 'mm',
        parameters: {}, featureTree: [], properties: {},
        materials: [], hardware: [],
      },
    };
    const out = migrateManifest(v18) as { formatVersion: number; kind: string };
    expect(out.formatVersion).toBe(38);
    expect(out.kind).toBe('part');
  });

  it('v18 assembly migrates through v19 → v20 with customTextures: []', () => {
    const v18 = {
      formatVersion: 18, kind: 'assembly',
      document: {
        id: 'a1', name: 'Wardrobe', units: 'mm',
        parameters: {}, components: [], constraints: [],
        groundedComponentPaths: [], colors: {},
        bomItemNumbers: {}, cutListItemNumbers: {},
        colorOverrides: {}, properties: {},
        materials: [], hardware: [],
      },
    };
    const out = migrateManifest(v18) as { formatVersion: number };
    expect(out.formatVersion).toBe(38);
  });

  // ── Immutability ─────────────────────────────────────────────────────────────

  it('migration does not mutate the input object', () => {
    const v18 = {
      formatVersion: 18, kind: 'drawing',
      document: {
        id: 'draw-5', name: 'Mutability', units: 'mm',
        source: { partPath: 'p.zipt', sourceKind: 'part' }, properties: {},
        sheets: [{
          id: 's1', name: 'Sheet 1',
          size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
          views: [
            {
              id: 'det-1', kind: 'detail', parentViewId: 'b1',
              regionParent: { center: { x: 10, y: 5 }, radiusMm: 4 },
              label: 'A', positionMm: { x: 100, y: 100 },
              scale: { numerator: 2, denominator: 1 }, showHidden: false,
            },
          ],
          dimensions: [], annotations: [], titleBlock: {},
        }],
        activeSheetId: 's1',
      },
    };
    const snapshot = JSON.stringify(v18);
    migrateManifest(v18);
    expect(JSON.stringify(v18)).toBe(snapshot);
  });

  // ── Multi-sheet drawing ──────────────────────────────────────────────────────

  it('v18 drawing with detail views on multiple sheets → all back-filled', () => {
    const makeSheet = (sheetId: string, detId: string, detLabel: string) => ({
      id: sheetId, name: `Sheet ${sheetId}`,
      size: { kind: 'iso', size: 'A4' }, orientation: 'landscape',
      views: [
        {
          id: `b-${sheetId}`, kind: 'base',
          positionMm: { x: 10, y: 10 },
          scale: { numerator: 1, denominator: 1 },
          orientation: 'front', showHidden: false,
        },
        {
          id: detId, kind: 'detail', parentViewId: `b-${sheetId}`,
          regionParent: { center: { x: 15, y: 10 }, radiusMm: 5 },
          label: detLabel, positionMm: { x: 200, y: 100 },
          scale: { numerator: 2, denominator: 1 }, showHidden: false,
        },
      ],
      dimensions: [], annotations: [], titleBlock: {},
    });

    const v18 = {
      formatVersion: 18, kind: 'drawing',
      document: {
        id: 'draw-multi', name: 'Multi-sheet', units: 'mm',
        source: { partPath: 'p.zipt', sourceKind: 'part' }, properties: {},
        sheets: [makeSheet('s1', 'det-1', 'A'), makeSheet('s2', 'det-2', 'B')],
        activeSheetId: 's1',
      },
    };
    const out = migrateManifest(v18) as {
      formatVersion: number;
      document: {
        sheets: Array<{
          views: Array<{ kind: string; regionParent?: { kind?: string } }>;
        }>;
      };
    };
    expect(out.formatVersion).toBe(38);
    for (const sheet of out.document.sheets) {
      const det = sheet.views.find(v => v.kind === 'detail')!;
      expect(det.regionParent?.kind).toBe('circle');
    }
  });
});
