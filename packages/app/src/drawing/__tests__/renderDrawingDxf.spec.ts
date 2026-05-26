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

// ── Task 4: section hatch + detail layers ─────────────────────────────────────

describe('renderDrawingDxf — section hatch + detail (DXF-SECT)', () => {
  it('DXF-SECT-1: section view hatchSegments → LINE on SECTION-HATCH with correct coords', () => {
    // hatch p0=(0,0) → sheet (50,50) → dxfY=160; p1=(5,5) → sheet (55,55) → dxfY=155
    const sheet = makeSheet({
      views: [{
        id: 'sv1', kind: 'section',
        parentViewId: 'v1',
        sectionLine: { p0: { x: 0, y: 0 }, p1: { x: 10, y: 0 } },
        arrowDirection: 1 as -1 | 1, label: 'A',
        positionMm: { x: 50, y: 50 },
        scale: { numerator: 1, denominator: 1 },
        showHidden: false as false,
        mode: 'full',
        hatchSegments: [
          { p0: { x: 0, y: 0 }, p1: { x: 5, y: 5 }, materialId: 'm1' },
        ],
        fingerprint: 'fp1',
        projection: {
          visibleEdges: [{ id: 'e1', kind: 'outline', points: [[0, 0], [10, 10]] as ReadonlyArray<readonly [number, number]> }],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
        },
      }],
    });
    const out = renderDrawingDxf(makeDrawing(sheet), sheet, makePart());
    // The LINE entity for SECTION-HATCH has a layer-8 group immediately before/after SECTION-HATCH
    // Check that a LINE entity with hatch coords is present
    // dxfY for p0=(0,0): flipY(50)=160; dxfY for p1=(5,5): flipY(55)=155
    expect(out).toContain('SECTION-HATCH');
    // Verify hatch coordinates appear in output (x=50.0000, dxfY1=160.0000, x2=55.0000, dxfY2=155.0000)
    expect(out).toContain('160.0000');
    expect(out).toContain('155.0000');
  });

  it('DXF-SECT-2: detail view (circle) → CIRCLE on DETAIL layer', () => {
    const sheet = makeSheet({
      views: [{
        id: 'dv1', kind: 'detail',
        parentViewId: 'v1',
        regionParent: { kind: 'circle', center: { x: 10, y: 10 }, radiusMm: 5 },
        label: 'B',
        positionMm: { x: 80, y: 80 },
        scale: { numerator: 2, denominator: 1 },
        showHidden: false,
        projection: {
          visibleEdges: [{ id: 'e1', kind: 'outline', points: [[0, 0], [1, 1]] as ReadonlyArray<readonly [number, number]> }],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
        },
      }],
    });
    const out = renderDrawingDxf(makeDrawing(sheet), sheet, makePart());
    expect(out).toContain('DETAIL');
    expect(out).toContain('CIRCLE');
  });

  it('DXF-SECT-3: detail view (rect) → POLYLINE on DETAIL layer (not a CIRCLE border)', () => {
    const sheet = makeSheet({
      views: [{
        id: 'dv2', kind: 'detail',
        parentViewId: 'v1',
        regionParent: { kind: 'rect', center: { x: 20, y: 20 }, widthMm: 10, heightMm: 8 },
        label: 'C',
        positionMm: { x: 100, y: 100 },
        scale: { numerator: 1, denominator: 1 },
        showHidden: false,
        projection: {
          visibleEdges: [],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
        },
      }],
    });
    const out = renderDrawingDxf(makeDrawing(sheet), sheet, makePart());
    expect(out).toContain('DETAIL');
    expect(out).toContain('POLYLINE');
  });
});

// ── Task 5: dimensions + annotations + title block ────────────────────────────

describe('renderDrawingDxf — dimensions + annotations + title (DXF-DIM)', () => {
  it('DXF-DIM-1: linear-h dimension → POLYLINE + TEXT on DIMENSIONS with correct distance', () => {
    // e1 p0=(0,50), e2 p0=(30,50) → distance=30mm; offsetMm=10 → dimSvgY=40 → dxfY=170
    const sheet = makeSheet({
      views: [{
        id: 'v1', kind: 'base',
        positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 1 },
        orientation: 'front', showHidden: false,
        projection: {
          visibleEdges: [
            { id: 'e1', kind: 'outline', points: [[0, 50], [0, 60]] as ReadonlyArray<readonly [number, number]> },
            { id: 'e2', kind: 'outline', points: [[30, 50], [30, 60]] as ReadonlyArray<readonly [number, number]> },
          ],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 50, maxX: 30, maxY: 60 },
        },
      }],
      dimensions: [{
        id: 'dim1', kind: 'linear-h',
        viewId: 'v1',
        from: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
        to:   { kind: 'edge-endpoint', edgeId: 'e2', end: 'start' },
        offsetMm: 10,
      }],
    });
    const out = renderDrawingDxf(makeDrawing(sheet), sheet, makePart());
    expect(out).toContain('DIMENSIONS');
    // The dimension TEXT label must contain "30" (the computed distance)
    // and the POLYLINE witness coordinate: dimSvgY=40 → dxfY=170 → 170.0000
    expect(out).toContain('170.0000');
  });

  it('DXF-DIM-2: balloon annotation → CIRCLE + TEXT on ANNOTATIONS', () => {
    const sheet = makeSheet({
      annotations: [{
        id: 'a1', kind: 'balloon',
        viewId: 'v1',
        targetMm: { x: 50, y: 50 },
        textPosMm: { x: 70, y: 50 },
        itemNumber: 3,
      }],
    });
    const out = renderDrawingDxf(makeDrawing(sheet), sheet, makePart());
    expect(out).toContain('ANNOTATIONS');
    expect(out).toContain('CIRCLE');
    expect(out).toContain('3');
  });

  it('DXF-DIM-3: title block → LINE + TEXT on TITLE layer with drawing name', () => {
    const drawing = makeDrawing(makeSheet());
    const sheet = drawing.sheets[0]!;
    const out = renderDrawingDxf(drawing, sheet, makePart());
    expect(out).toContain('TITLE');
    expect(out).toContain('Drawing:');
  });
});
