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

describe('renderDrawingDxf — base view edges (DXF-EDGES)', () => {
  it('DXF-EDGES-1: empty sheet produces valid DXF string with sections', () => {
    const sheet = makeSheet();
    const out = renderDrawingDxf(makeDrawing(sheet), sheet, makePart());
    expect(out).toContain('AC1015');
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

  it('DXF-NDIM-LINEAR-1: linear-h dimension → DIMENSION entity + anonymous block on DIMENSIONS', () => {
    const sheet = makeSheet({
      views: [{
        id: 'v1', kind: 'base', positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 1 }, orientation: 'front', showHidden: false,
        projection: {
          visibleEdges: [
            { id: 'e1', kind: 'outline', points: [[0, 50], [0, 60]] as ReadonlyArray<readonly [number, number]> },
            { id: 'e2', kind: 'outline', points: [[30, 50], [30, 60]] as ReadonlyArray<readonly [number, number]> },
          ],
          hiddenEdges: [], bbox: { minX: 0, minY: 50, maxX: 30, maxY: 60 },
        },
      }],
      dimensions: [{
        id: 'dim1', kind: 'linear-h', viewId: 'v1',
        from: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
        to:   { kind: 'edge-endpoint', edgeId: 'e2', end: 'start' },
        offsetMm: 10,
      }],
    });
    const out = renderDrawingDxf(makeDrawing(sheet), sheet, makePart());
    expect(out).toMatch(/\n\s*0\nDIMENSION\n/);    // native entity (group-0 DIMENSION, NOT the 'DIMENSIONS' layer)
    expect(out).toMatch(/\*D\d+/);                 // references an anonymous block
    // The dim picture geometry is preserved (now inside the block): dimSvgY=40 → dxfY=170
    expect(out).toContain('170.0000');
  });

  it('DXF-NDIM-BASELINE-1: baseline dimension → DIMENSION entity + block', () => {
    const sheet = makeSheet({
      views: [{
        id: 'v1', kind: 'base', positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 1 }, orientation: 'front', showHidden: false,
        projection: {
          visibleEdges: [
            { id: 'd0', kind: 'outline', points: [[0, 50], [0, 60]] as ReadonlyArray<readonly [number, number]> },
            { id: 't1', kind: 'outline', points: [[40, 50], [40, 60]] as ReadonlyArray<readonly [number, number]> },
          ],
          hiddenEdges: [], bbox: { minX: 0, minY: 50, maxX: 40, maxY: 60 },
        },
      }],
      dimensionGroups: [{
        kind: 'baseline', id: 'g1', viewId: 'v1',
        datum: { kind: 'edge-endpoint', edgeId: 'd0', end: 'start' },
        direction: 'h', baseOffsetMm: 8, spacingMm: 6,
      }],
      dimensions: [{
        kind: 'baseline', id: 'b1', viewId: 'v1', groupId: 'g1', slot: 0,
        to: { kind: 'edge-endpoint', edgeId: 't1', end: 'start' },
      }],
    });
    const out = renderDrawingDxf(makeDrawing(sheet), sheet, makePart());
    expect(out).toMatch(/\n\s*0\nDIMENSION\n/);
    expect(out).toMatch(/\*D\d+/);
    expect(out).toContain('40');   // measured distance label
  });

  it('DXF-NDIM-ORDINATE-1: ordinate dimension → DIMENSION entity (type 6) + block', () => {
    const sheet = makeSheet({
      views: [{
        id: 'v1', kind: 'base', positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 1 }, orientation: 'front', showHidden: false,
        projection: {
          visibleEdges: [
            { id: 'o0', kind: 'outline', points: [[0, 0], [0, 10]] as ReadonlyArray<readonly [number, number]> },
            { id: 'f1', kind: 'outline', points: [[25, 0], [25, 10]] as ReadonlyArray<readonly [number, number]> },
          ],
          hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 25, maxY: 10 },
        },
      }],
      dimensionGroups: [{
        kind: 'ordinate', id: 'og1', viewId: 'v1',
        origin: { kind: 'edge-endpoint', edgeId: 'o0', end: 'start' },
        xColumnOffsetMm: -10, yColumnOffsetMm: 10,
      }],
      dimensions: [{
        kind: 'ordinate', id: 'od1', viewId: 'v1', groupId: 'og1', axis: 'x',
        to: { kind: 'edge-endpoint', edgeId: 'f1', end: 'start' },
      }],
    });
    const out = renderDrawingDxf(makeDrawing(sheet), sheet, makePart());
    expect(out).toMatch(/\n\s*0\nDIMENSION\n/);
    expect(out).toMatch(/\*D\d+/);
    // group-70 value for X-ordinate = 6 | 64 = 70
    const lines = out.split('\n');
    const dimIdx = lines.findIndex((l) => l.trim() === 'DIMENSION');
    const block = lines.slice(dimIdx, dimIdx + 30).join('\n');
    expect(block).toMatch(/ 70\n\s*70/);
  });

  it('DXF-NDIM-ANGULAR-1: angular (two-edges) dimension → DIMENSION entity (type 2) + block with native ARC', () => {
    // Geometry: edge g1 = [[0,0],[20,0]] (X-axis), edge g2 = [[0,0],[0,20]] (Y-axis).
    // apex = (0,0). d1 = (1,0), d2 = (0,1). cross = 1 > 0. arcSide='inside' → sweepSign=1.
    // insideRad = π/2 = 90°. startAngle2 = atan2(0,1) = 0.
    // a2Start=0, a2End=π/2. thetaA2=toDeg(-0)=0°. thetaB2=toDeg(-π/2)=270°.
    // sweepSign≥0 → ARC startDeg=thetaB2=270°, endDeg=thetaA2=0°.
    // CCW DXF sweep from 270→0 = 90° = labeled angle. Radius = offsetMm * scale = 8.
    // center (DXF): apexSvgX=0, cyDxf=flipY(0)=sheetH-0=210 (A4 landscape sheetH=210).
    const sheet = makeSheet({
      views: [{
        id: 'v1', kind: 'base', positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 1 }, orientation: 'front', showHidden: false,
        projection: {
          visibleEdges: [
            { id: 'g1', kind: 'outline', points: [[0, 0], [20, 0]] as ReadonlyArray<readonly [number, number]> },
            { id: 'g2', kind: 'outline', points: [[0, 0], [0, 20]] as ReadonlyArray<readonly [number, number]> },
          ],
          hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
        },
      }],
      dimensions: [{
        kind: 'angular', id: 'an1', viewId: 'v1',
        ref: { kind: 'two-edges',
          edge1: { viewId: 'v1', edgeId: 'g1' },
          edge2: { viewId: 'v1', edgeId: 'g2' } },
        arcSide: 'inside', offsetMm: 8,
      }],
    });
    const out = renderDrawingDxf(makeDrawing(sheet), sheet, makePart());

    // Native DIMENSION entity emitted with angular type 2
    expect(out).toMatch(/\n\s*0\nDIMENSION\n/);
    expect(out).toMatch(/\*D\d+/);
    const lines = out.split('\n');
    const dimIdx = lines.findIndex((l) => l.trim() === 'DIMENSION');
    const dimBlock = lines.slice(dimIdx, dimIdx + 30).join('\n');
    expect(dimBlock).toMatch(/ 70\n\s*2/);   // angular type 2

    // The anonymous block picture must contain a native ARC (not a POLYLINE).
    // ARC structure: entity 'ARC', on DIMENSIONS layer, with center/radius/angles.
    expect(out).toContain('\n  0\nARC\n');     // native ARC entity present
    expect(out).not.toMatch(/POLYLINE[\s\S]{0,100}DIMENSIONS[\s\S]{0,200}ARC/);  // ARC in block, not POLYLINE
    const arcIdx = lines.findIndex((l) => l.trim() === 'ARC');
    expect(arcIdx).toBeGreaterThan(-1);
    // ARC entity block (wider window for AC1015 handle/owner/subclass markers)
    const arcBlock = lines.slice(arcIdx, arcIdx + 30).join('\n');
    expect(arcBlock).toContain('DIMENSIONS');  // on DIMENSIONS layer
    // Radius = offsetMm * scale = 8 * 1 = 8
    expect(arcBlock).toContain('8.0000');      // group 40 = radius

    // Angle assertions:
    // startDeg = 270°, endDeg = 0°. CCW sweep = (0 - 270 + 360) % 360 = 90° = labeled angle.
    // Verify start (group 50) and end (group 51) are 270 and 0 respectively.
    const g50Idx = lines.findIndex((l, i) => i > arcIdx && l.trim() === '50');
    const g51Idx = lines.findIndex((l, i) => i > arcIdx && l.trim() === '51');
    expect(g50Idx).toBeGreaterThan(-1);
    expect(g51Idx).toBeGreaterThan(-1);
    const startDeg = parseFloat(lines[g50Idx + 1]!.trim());
    const endDeg   = parseFloat(lines[g51Idx + 1]!.trim());
    // CCW sweep from startDeg to endDeg must equal the labeled angle (90°), NOT 270° (its complement).
    const ccwSweep = ((endDeg - startDeg) % 360 + 360) % 360;
    expect(ccwSweep).toBeCloseTo(90, 2);  // 90° = inside angle between the two perpendicular edges
  });
});

// ── Radial + diametric dimensions ─────────────────────────────────────────────

/** 8 equally-spaced points on circle r=10 centered (50,50) in part-mm. */
function makeCircleEdge8(): ReadonlyArray<readonly [number, number]> {
  const n = 8;
  return Array.from({ length: n }, (_, i) => {
    const θ = (2 * Math.PI * i) / n;
    return [50 + 10 * Math.cos(θ), 50 + 10 * Math.sin(θ)] as readonly [number, number];
  });
}

describe('renderDrawingDxf — radial dimension (DXF-RAD)', () => {
  it('DXF-RAD-1: radial dim → DIMENSIONS layer + TEXT containing R10', () => {
    const sheet = makeSheet({
      views: [{
        id: 'v1', kind: 'base',
        positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 1 },
        orientation: 'front', showHidden: false,
        projection: {
          visibleEdges: [{ id: 'circ1', kind: 'outline', points: makeCircleEdge8() }],
          hiddenEdges: [],
          bbox: { minX: 40, minY: 40, maxX: 60, maxY: 60 },
        },
      }],
      dimensions: [{
        kind: 'radial', id: 'r1', viewId: 'v1', edgeId: 'circ1',
        offsetMm: 5, angleDeg: 0,
      }],
    });
    const out = renderDrawingDxf(makeDrawing(sheet), sheet, makePart());
    expect(out).toContain('DIMENSIONS');
    // TEXT entity must contain the label R10
    expect(out).toMatch(/R10/);
  });

  it('DXF-RAD-2: radial dim → native DIMENSION entity emitted', () => {
    const sheet = makeSheet({
      views: [{
        id: 'v1', kind: 'base',
        positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 1 },
        orientation: 'front', showHidden: false,
        projection: {
          visibleEdges: [{ id: 'circ1', kind: 'outline', points: makeCircleEdge8() }],
          hiddenEdges: [],
          bbox: { minX: 40, minY: 40, maxX: 60, maxY: 60 },
        },
      }],
      dimensions: [{
        kind: 'radial', id: 'r2', viewId: 'v1', edgeId: 'circ1',
        offsetMm: 5, angleDeg: 0,
      }],
    });
    const out = renderDrawingDxf(makeDrawing(sheet), sheet, makePart());
    expect(out).toMatch(/\n\s*0\nDIMENSION\n/);
    expect(out).toMatch(/\*D\d+/);
  });
});

describe('renderDrawingDxf — diametric dimension (DXF-DIA)', () => {
  it('DXF-DIA-1: diametric dim → DIMENSIONS layer + TEXT containing %%c20', () => {
    const sheet = makeSheet({
      views: [{
        id: 'v1', kind: 'base',
        positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 1 },
        orientation: 'front', showHidden: false,
        projection: {
          visibleEdges: [{ id: 'circ1', kind: 'outline', points: makeCircleEdge8() }],
          hiddenEdges: [],
          bbox: { minX: 40, minY: 40, maxX: 60, maxY: 60 },
        },
      }],
      dimensions: [{
        kind: 'diametric', id: 'd1', viewId: 'v1', edgeId: 'circ1',
        offsetMm: 5, angleDeg: 0,
      }],
    });
    const out = renderDrawingDxf(makeDrawing(sheet), sheet, makePart());
    expect(out).toContain('DIMENSIONS');
    // DXF R12 diameter symbol = %%c, value = 2*r = 20
    expect(out).toMatch(/%%c20/);
  });

  it('DXF-DIA-2: diametric dim → native DIMENSION entity emitted', () => {
    const sheet = makeSheet({
      views: [{
        id: 'v1', kind: 'base',
        positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 1 },
        orientation: 'front', showHidden: false,
        projection: {
          visibleEdges: [{ id: 'circ1', kind: 'outline', points: makeCircleEdge8() }],
          hiddenEdges: [],
          bbox: { minX: 40, minY: 40, maxX: 60, maxY: 60 },
        },
      }],
      dimensions: [{
        kind: 'diametric', id: 'd2', viewId: 'v1', edgeId: 'circ1',
        offsetMm: 5, angleDeg: 0,
      }],
    });
    const out = renderDrawingDxf(makeDrawing(sheet), sheet, makePart());
    expect(out).toMatch(/\n\s*0\nDIMENSION\n/);
    expect(out).toMatch(/\*D\d+/);
  });
});

// ── CHUNK D: title-block approvedBy + notes ───────────────────────────────────

describe('renderDrawingDxf — title-block approvedBy + notes (CHUNK-D)', () => {
  function makeDrawingWithTitleBlockOverrides() {
    const sheet = makeSheet({ titleBlock: { approvedBy: 'J. Smith', notes: 'Rev A initial release' } });
    return { drawing: makeDrawing(sheet), sheet };
  }

  it('DXF-D-1: title block emits "Approved by:" label as TEXT entity on TITLE', () => {
    const { drawing, sheet } = makeDrawingWithTitleBlockOverrides();
    const dxf = renderDrawingDxf(drawing, sheet, makePart());
    expect(dxf).toContain('Approved by:');
  });

  it('DXF-D-2: title block emits the approvedBy value "J. Smith"', () => {
    const { drawing, sheet } = makeDrawingWithTitleBlockOverrides();
    const dxf = renderDrawingDxf(drawing, sheet, makePart());
    expect(dxf).toContain('J. Smith');
  });

  it('DXF-D-3: title block emits "Notes:" label as TEXT entity on TITLE', () => {
    const { drawing, sheet } = makeDrawingWithTitleBlockOverrides();
    const dxf = renderDrawingDxf(drawing, sheet, makePart());
    expect(dxf).toContain('Notes:');
  });

  it('DXF-D-4: the notes value appears in a TEXT entity on TITLE layer', () => {
    const { drawing, sheet } = makeDrawingWithTitleBlockOverrides();
    const dxf = renderDrawingDxf(drawing, sheet, makePart());
    // Verify a TEXT entity on TITLE contains the notes value
    // The TEXT entity should appear after a TITLE layer reference
    const lines = dxf.split('\n');
    // AC1015 TEXT entity has handle/owner/subclass markers — use a wider window (30 lines)
    const textEntityBodies = lines.reduce<string[]>((acc, line, i) => {
      if (line.trim() === 'TEXT') {
        acc.push(lines.slice(i, i + 30).join('\n'));
      }
      return acc;
    }, []);
    const titleTextWithNotes = textEntityBodies.find(
      (body) => body.includes('TITLE') && body.includes('Rev A initial release')
    );
    expect(titleTextWithNotes).toBeDefined();
  });
});

// ── CHUNK C: view labels + scale, section headings ────────────────────────────

describe('renderDrawingDxf — view labels + section headings (CHUNK-C)', () => {
  it('DXF-C-1: base view emits a TEXT entity on VISIBLE layer containing "SCALE 1:1"', () => {
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
    const dxf = renderDrawingDxf(makeDrawing(sheet), sheet, makePart());
    expect(dxf).toMatch(/SCALE\s*1:1/);
  });

  it('DXF-C-2: section view emits a TEXT entity containing "SECTION A-A"', () => {
    const sheet = makeSheet({
      views: [{
        id: 'sv1', kind: 'section',
        parentViewId: 'v1',
        sectionLine: { p0: { x: 0, y: 50 }, p1: { x: 100, y: 50 } },
        arrowDirection: 1 as -1 | 1,
        label: 'A',
        positionMm: { x: 50, y: 150 },
        scale: { numerator: 1, denominator: 1 },
        showHidden: false,
        mode: 'full',
        hatchSegments: [],
        fingerprint: 'fp-c2',
        projection: {
          visibleEdges: [{ id: 'sv1-e1', kind: 'outline', points: [[0, 0], [100, 0]] as ReadonlyArray<readonly [number, number]> }],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 100, maxY: 0 },
        },
      }],
    });
    const dxf = renderDrawingDxf(makeDrawing(sheet), sheet, makePart());
    expect(dxf).toContain('SECTION A-A');
  });
});

// ── CHUNK B2: first-angle ISO projection symbol ───────────────────────────────

describe('renderDrawingDxf — first-angle projection symbol (CHUNK-B2)', () => {
  it('DXF-B2-1: title block emits a CIRCLE entity on TITLE layer for the projection symbol', () => {
    const sheet = makeSheet();
    const dxf = renderDrawingDxf(makeDrawing(sheet), sheet, makePart());
    // Should contain a CIRCLE entity in the TITLE layer area
    const lines = dxf.split('\n');
    const circleEntityBodies = lines.reduce<string[]>((acc, line, i) => {
      if (line.trim() === 'CIRCLE') {
        acc.push(lines.slice(i, i + 12).join('\n'));
      }
      return acc;
    }, []);
    const titleCircle = circleEntityBodies.find((body) => body.includes('TITLE'));
    expect(titleCircle).toBeDefined();
  });

  it('DXF-B2-2: correct first-angle orientation — circle center X is to the right of the trapezoid', () => {
    // ISO 128-30 first-angle: trapezoid on LEFT (narrow left, wide right), circles on RIGHT.
    // For A4 landscape (sheetW=297): x=10, w=277, symTrapX = 10+277-18 = 269, trapW=6.
    // Circle: symCx = 269 + 6 + 1 + 3 = 279. Trapezoid right edge: 269+6=275.
    // Assert: circleCx (279) > trapezoid right edge (275) — i.e., circleCx > symTrapX + trapW.
    // With old (backwards) code: circle was at symCx=269 < trap right edge 269+6+1+3-1=278 (approx).
    const sheet = makeSheet(); // A4 landscape
    const dxf = renderDrawingDxf(makeDrawing(sheet), sheet, makePart());
    const lines = dxf.split('\n');

    // Find the TITLE CIRCLE entity center X
    let titleCircleCx: number | null = null;
    // AC1015 CIRCLE has handle/owner/subclass markers; use 20-line window to reach group 10
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.trim() === 'CIRCLE') {
        const body = lines.slice(i, i + 20);
        const isTitleCircle = body.some((l, j) => j > 0 && body[j - 1]?.trim() === '8' && l.trim() === 'TITLE');
        if (!isTitleCircle) continue;
        const g10ValIdx = body.findIndex((_l, j) => j > 0 && body[j - 1]?.trim() === '10');
        if (g10ValIdx !== -1) { titleCircleCx = parseFloat(body[g10ValIdx]!.trim()); break; }
      }
    }
    expect(titleCircleCx, 'TITLE CIRCLE center X not found').not.toBeNull();

    // For A4 landscape fixture: trapezoid right edge = symTrapX + 6 = (10 + 277 - 18) + 6 = 275.
    // Circle must be to the RIGHT: cx > 275.
    // (Old backwards code had circle at 269, which is < 275 — test would have failed.)
    const sheetW = 297; // A4 landscape
    const x = 10; const w = sheetW - 20;
    const symTrapX = x + w - 18;
    const trapW = 6;
    const trapRightEdge = symTrapX + trapW;
    expect(titleCircleCx!).toBeGreaterThan(trapRightEdge);
  });
});

describe('renderDrawingDxf — null source (source-optional export)', () => {
  const sheetWithHoleTable: DrawingSheet = {
    id: 'sh1',
    name: 'Sheet 1',
    size: { kind: 'iso', size: 'A3' },
    orientation: 'landscape',
    views: [],
    dimensions: [],
    annotations: [
      {
        kind: 'holeTable',
        id: 'ht1',
        viewId: 'v1',
        datum: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
        positionMm: { x: 100, y: 50 },
        entries: [],
      },
    ],
    titleBlock: {},
    dimensionGroups: [],
  };
  const drawingWithHoleTable: DrawingDocument = {
    id: 'dw1',
    name: 'Null-Source Drawing',
    units: 'mm',
    source: { partPath: 'parts/dummy.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [sheetWithHoleTable],
    activeSheetId: 'sh1',
  };

  it('renders a complete DXF without throwing when source is null', () => {
    expect(() => renderDrawingDxf(drawingWithHoleTable, sheetWithHoleTable, null)).not.toThrow();
    const dxf = renderDrawingDxf(drawingWithHoleTable, sheetWithHoleTable, null);
    expect(dxf).toContain('EOF');
    // Title block emitted with blank part name.
    expect(dxf).toContain('Part: ');
  });
});

describe('renderDrawingDxf — partsList annotation', () => {
  const plSheet: DrawingSheet = {
    id: 'pl-sh1',
    name: 'Sheet 1',
    size: { kind: 'iso', size: 'A3' },
    orientation: 'landscape',
    views: [],
    dimensions: [],
    annotations: [
      {
        kind: 'partsList',
        id: 'pl-dxf-1',
        positionMm: { x: 10, y: 20 },
        rows: [
          {
            item: 1,
            qty: 2,
            partName: 'Top Shelf',
            material: 'Birch',
            dimensions: '800×300×18',
            edgeBands: 'T',
          },
          {
            item: 2,
            qty: 8,
            partName: 'Corner Bracket',
            material: '',
            dimensions: '',
            edgeBands: '',
          },
        ],
      },
    ],
    titleBlock: {},
    dimensionGroups: [],
  };
  const plDrawing: DrawingDocument = {
    id: 'pl-dw1',
    name: 'Parts List Drawing',
    units: 'mm',
    source: { partPath: 'parts/pl.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [plSheet],
    activeSheetId: 'pl-sh1',
  };

  it('renders without throwing', () => {
    expect(() => renderDrawingDxf(plDrawing, plSheet, null)).not.toThrow();
  });

  it('emits TEXT entities on PARTS-LIST layer', () => {
    const dxf = renderDrawingDxf(plDrawing, plSheet, null);
    expect(dxf).toContain('PARTS-LIST');
  });

  it('emits ITEM header text', () => {
    const dxf = renderDrawingDxf(plDrawing, plSheet, null);
    expect(dxf).toContain('ITEM');
  });

  it('emits PART NAME header text', () => {
    const dxf = renderDrawingDxf(plDrawing, plSheet, null);
    expect(dxf).toContain('PART NAME');
  });

  it('emits part name from data row', () => {
    const dxf = renderDrawingDxf(plDrawing, plSheet, null);
    expect(dxf).toContain('Top Shelf');
  });

  it('emits hardware row part name', () => {
    const dxf = renderDrawingDxf(plDrawing, plSheet, null);
    expect(dxf).toContain('Corner Bracket');
  });
});

// ---------------------------------------------------------------------------
// Slice 7b: center-mark annotation → two LINE entities on ANNOTATIONS layer
// ---------------------------------------------------------------------------

describe('renderDrawingDxf — center-mark annotation draws a cross (Slice-7b)', () => {
  /** 8 equally-spaced points on circle r=10 centered (50,50). */
  function makeArcEdge8Cm(): ReadonlyArray<readonly [number, number]> {
    const n = 8;
    return Array.from({ length: n }, (_, i) => {
      const θ = (2 * Math.PI * i) / n;
      return [50 + 10 * Math.cos(θ), 50 + 10 * Math.sin(θ)] as readonly [number, number];
    });
  }

  function makeSheetWithCenterMark(): DrawingSheet {
    return makeSheet({
      views: [{
        id: 'v-cm', kind: 'base',
        positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 1 },
        orientation: 'front', showHidden: false,
        projection: {
          visibleEdges: [{ id: 'arc-cm', kind: 'outline', points: makeArcEdge8Cm() }],
          hiddenEdges: [],
          bbox: { minX: 40, minY: 40, maxX: 60, maxY: 60 },
        },
      }],
      annotations: [{ id: 'cm-dxf-1', kind: 'center-mark', viewId: 'v-cm', edgeId: 'arc-cm' }],
    });
  }

  it('DXF-7b-1: does not throw when a center-mark annotation is present', () => {
    const sheet = makeSheetWithCenterMark();
    expect(() => renderDrawingDxf(makeDrawing(sheet), sheet, makePart())).not.toThrow();
  });

  it('DXF-7b-2: center-mark produces at least 2 LINE entities on the ANNOTATIONS layer', () => {
    const sheet = makeSheetWithCenterMark();
    const out = renderDrawingDxf(makeDrawing(sheet), sheet, makePart());

    // Count LINE entities whose body contains "ANNOTATIONS" as the layer
    const lines = out.split('\n');
    let annotationsLineCount = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.trim() === 'LINE') {
        // AC1015: layer (group 8) is at offset ~8 from entity start due to handle/owner/subclass markers.
        // Search in a wider window (15 lines) for the layer name.
        const body = lines.slice(i, i + 15).join('\n');
        if (body.includes('ANNOTATIONS')) {
          annotationsLineCount++;
        }
      }
    }
    expect(annotationsLineCount).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// DXF underlay exclusion: underlay entities must NOT be re-exported to DXF
// ---------------------------------------------------------------------------
import type { DxfUnderlay } from '@zilventor/shared';

describe('renderDrawingDxf — underlay NOT re-exported', () => {
  it('sheet with underlay: DXF output does not contain data-underlay marker or underlay entity text', () => {
    const underlay: DxfUnderlay = {
      name: 'test.dxf',
      entities: [
        { kind: 'line', x1: 0, y1: 0, x2: 100, y2: 0 },
        { kind: 'text', x: 5, y: 5, height: 4, value: 'UNDERLAY_MARKER_UNIQUE_XYZ', rotation: 0 },
      ],
    };
    const sheet = makeSheet({ underlay });
    const dxf = renderDrawingDxf(makeDrawing(sheet), sheet, makePart());
    // The unique marker from the text entity must not appear in DXF output
    expect(dxf).not.toContain('UNDERLAY_MARKER_UNIQUE_XYZ');
    // No data-underlay (SVG concept only)
    expect(dxf).not.toContain('data-underlay');
  });
});
