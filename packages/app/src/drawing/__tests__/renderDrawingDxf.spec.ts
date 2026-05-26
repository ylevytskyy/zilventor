// packages/app/src/drawing/__tests__/renderDrawingDxf.spec.ts
import { describe, it, expect } from 'vitest';
import { renderDrawingDxf } from '../renderDrawingDxf';
import type { DrawingDocument, DrawingSheet } from '@zilventor/shared';
import type { PartDocument } from '@zilventor/shared';

// Minimal fixture factory
function makeSheet(overrides?: Partial<DrawingSheet>): DrawingSheet {
  return {
    id: 's1', name: 'Sheet 1',
    size: { kind: 'iso', size: 'A4' },
    orientation: 'landscape',
    views: [], dimensions: [], annotations: [], dimensionGroups: [],
    titleBlock: {},
    ...overrides,
  };
}

function makePart(): PartDocument {
  return {
    id: 'p1', name: 'Part', units: 'mm',
    parameters: {}, featureTree: [], properties: {},
    materials: [], hardware: [],
  } as unknown as PartDocument;
}

function makeDrawing(sheet: DrawingSheet): DrawingDocument {
  return {
    id: 'd1', name: 'MyDrawing', units: 'mm',
    source: { partPath: 'parts/p1.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [sheet],
    activeSheetId: sheet.id,
  };
}

// A4 landscape: w=297, h=210
const SHEET_H = 210;

describe('renderDrawingDxf — base view edges (DXF-EDGES)', () => {
  it('DXF-EDGES-1: empty sheet produces valid DXF string with sections', () => {
    const sheet = makeSheet();
    const out = renderDrawingDxf(makeDrawing(sheet), sheet, makePart());
    expect(out).toContain('AC1009');
    expect(out).toContain('ENTITIES');
    expect(out).toContain('EOF');
  });

  it('DXF-EDGES-2: view without projection is skipped (no POLYLINE)', () => {
    const sheet = makeSheet({
      views: [{ id: 'v1', kind: 'base', positionMm: { x: 50, y: 50 },
        scale: { numerator: 1, denominator: 1 }, orientation: 'front',
        showHidden: false }],
    });
    const out = renderDrawingDxf(makeDrawing(sheet), sheet, makePart());
    expect(out).not.toContain('POLYLINE');
  });

  it('DXF-EDGES-3: visible edge → POLYLINE on VISIBLE layer', () => {
    const sheet = makeSheet({
      views: [{
        id: 'v1', kind: 'base',
        positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 1 },
        orientation: 'front', showHidden: false,
        projection: {
          visibleEdges: [{ id: 'e1', kind: 'outline', points: [[0, 0], [10, 0]] as ReadonlyArray<readonly [number, number]> }],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 10, maxY: 0 },
        },
      }],
    });
    const out = renderDrawingDxf(makeDrawing(sheet), sheet, makePart());
    expect(out).toContain('VISIBLE');
    expect(out).toContain('POLYLINE');
    // VERTEX coords at x=0: group code 10 → 0.0000
    expect(out).toContain('0.0000');
  });

  it('DXF-EDGES-4: hidden edge → POLYLINE on HIDDEN layer', () => {
    const sheet = makeSheet({
      views: [{
        id: 'v1', kind: 'base',
        positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 1 },
        orientation: 'front', showHidden: true,
        projection: {
          visibleEdges: [],
          hiddenEdges: [{ id: 'h1', kind: 'feature', points: [[5, 5], [15, 5]] as ReadonlyArray<readonly [number, number]> }],
          bbox: { minX: 5, minY: 5, maxX: 15, maxY: 5 },
        },
      }],
    });
    const out = renderDrawingDxf(makeDrawing(sheet), sheet, makePart());
    expect(out).toContain('HIDDEN');
  });

  it('DXF-EDGES-5: Y-flip applied — point (x=10, svgY=100) → dxfY = 210 - 100 = 110', () => {
    const sheet = makeSheet({
      views: [{
        id: 'v1', kind: 'base',
        positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 1 },
        orientation: 'front', showHidden: false,
        projection: {
          visibleEdges: [{ id: 'e1', kind: 'outline', points: [[10, 100], [20, 100]] as ReadonlyArray<readonly [number, number]> }],
          hiddenEdges: [],
          bbox: { minX: 10, minY: 100, maxX: 20, maxY: 100 },
        },
      }],
    });
    const out = renderDrawingDxf(makeDrawing(sheet), sheet, makePart());
    // svgY=100, sheetH=210 → dxfY = 110.0000
    expect(out).toContain('110.0000');
  });

  it('DXF-EDGES-6: ViewScale applied — edge point (5,5) with scale 2:1 at pos (10,20) → sheet (20,30), dxfY = 210-30=180', () => {
    const sheet = makeSheet({
      views: [{
        id: 'v1', kind: 'base',
        positionMm: { x: 10, y: 20 },
        scale: { numerator: 2, denominator: 1 },
        orientation: 'front', showHidden: false,
        projection: {
          visibleEdges: [{ id: 'e1', kind: 'outline', points: [[5, 5], [5, 5]] as ReadonlyArray<readonly [number, number]> }],
          hiddenEdges: [],
          bbox: { minX: 5, minY: 5, maxX: 5, maxY: 5 },
        },
      }],
    });
    const out = renderDrawingDxf(makeDrawing(sheet), sheet, makePart());
    // svgX = 10 + 5*2 = 20; svgY = 20 + 5*2 = 30; dxfX=20, dxfY=180
    expect(out).toContain('20.0000');
    expect(out).toContain('180.0000');
  });
});
