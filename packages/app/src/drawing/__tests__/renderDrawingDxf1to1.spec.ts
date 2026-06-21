// packages/app/src/drawing/__tests__/renderDrawingDxf1to1.spec.ts
import { describe, it, expect } from 'vitest';
import { renderDrawingDxf1to1 } from '../renderDrawingDxf1to1';
import type { DrawingDocument, DrawingSheet, DrawingView } from '@zilventor/shared';

// ── Fixtures (mirror renderDrawingDxf.spec.ts) ──────────────────────────────
function makeSheet(views: DrawingView[]): DrawingSheet {
  return {
    id: 's1', name: 'Sheet 1',
    size: { kind: 'iso', size: 'A4' },
    orientation: 'landscape',
    views, dimensions: [], annotations: [], dimensionGroups: [],
    titleBlock: {},
  };
}
function makeDrawing(sheet: DrawingSheet): DrawingDocument {
  return {
    id: 'd1', name: 'MyDrawing', units: 'mm',
    source: { partPath: 'parts/p1.zipt', sourceKind: 'part' },
    properties: {}, sheets: [sheet], activeSheetId: sheet.id,
  };
}
function pts(p: ReadonlyArray<readonly [number, number]>): ReadonlyArray<readonly [number, number]> { return p; }

// A 100×50 box outline as one closed polyline, stored at scale 1:2.
function box100x50At1to2(posY = 10): DrawingView {
  return {
    id: 'vA', kind: 'base', positionMm: { x: 50, y: posY },
    scale: { numerator: 1, denominator: 2 }, orientation: 'front', showHidden: false,
    projection: {
      visibleEdges: [{ id: 'e1', kind: 'outline',
        points: pts([[0, 0], [100, 0], [100, 50], [0, 50], [0, 0]]) }],
      hiddenEdges: [],
      bbox: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
    },
  } as DrawingView;
}

// ── Parse helpers ────────────────────────────────────────────────────────────
function vertices(dxf: string): Array<[number, number]> {
  const lines = dxf.split('\n');
  const out: Array<[number, number]> = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() !== 'VERTEX') continue;
    let x = NaN, y = NaN;
    for (let j = i + 1; j + 1 < lines.length && lines[j]!.trim() !== 'VERTEX' && lines[j]!.trim() !== 'SEQEND'; j++) {
      if (lines[j] === ' 10') x = parseFloat(lines[j + 1]!);
      if (lines[j] === ' 20') y = parseFloat(lines[j + 1]!);
    }
    if (!Number.isNaN(x) && !Number.isNaN(y)) out.push([x, y]);
  }
  return out;
}
function polylineLayers(dxf: string): string[] {
  const lines = dxf.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() !== 'POLYLINE') continue;
    for (let j = i + 1; j + 1 < lines.length && lines[j]!.trim() !== 'VERTEX'; j++) {
      if (lines[j] === '  8') { out.push(lines[j + 1]!); break; }
    }
  }
  return out;
}

describe('renderDrawingDxf1to1 — per-view true size', () => {
  it('DXF1-1: true machining size ignores view.scale (100×50 box at 1:2 → extent 100×50)', () => {
    const sheet = makeSheet([box100x50At1to2()]);
    const out = renderDrawingDxf1to1(makeDrawing(sheet), sheet);
    const vs = vertices(out);
    const xs = vs.map((v) => v[0]); const ys = vs.map((v) => v[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(100, 3); // NOT 50
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(50, 3);  // NOT 25
  });

  it('DXF1-2: Y-up — model top (py=bbox.minY) maps to max Y', () => {
    const sheet = makeSheet([box100x50At1to2()]);
    const out = renderDrawingDxf1to1(makeDrawing(sheet), sheet);
    const ys = vertices(out).map((v) => v[1]);
    // py=0 (model top) → ty = bbox.maxY - 0 = 50 (the maximum). py=50 → 0.
    expect(Math.max(...ys)).toBeCloseTo(50, 3);
    expect(Math.min(...ys)).toBeCloseTo(0, 3);
  });

  it('DXF1-3: hidden edges land on HIDDEN layer, visible on VISIBLE', () => {
    const v: DrawingView = {
      id: 'vH', kind: 'base', positionMm: { x: 0, y: 0 },
      scale: { numerator: 1, denominator: 1 }, orientation: 'front', showHidden: true,
      projection: {
        visibleEdges: [{ id: 'e1', kind: 'outline', points: pts([[0, 0], [10, 0]]) }],
        hiddenEdges: [{ id: 'h1', kind: 'feature', points: pts([[2, 2], [8, 2]]) }],
        bbox: { minX: 0, minY: 0, maxX: 10, maxY: 2 },
      },
    } as DrawingView;
    const layers = polylineLayers(renderDrawingDxf1to1(makeDrawing(makeSheet([v])), makeSheet([v])));
    expect(layers).toContain('VISIBLE');
    expect(layers).toContain('HIDDEN');
  });

  it('DXF1-4: views without a projection are skipped (no POLYLINE)', () => {
    const v: DrawingView = {
      id: 'vN', kind: 'base', positionMm: { x: 0, y: 0 },
      scale: { numerator: 1, denominator: 1 }, orientation: 'front', showHidden: false,
    } as DrawingView;
    const out = renderDrawingDxf1to1(makeDrawing(makeSheet([v])), makeSheet([v]));
    expect(out).not.toContain('POLYLINE');
  });

  it('DXF1-5: empty sheet → valid DXF with sections', () => {
    const sheet = makeSheet([]);
    const out = renderDrawingDxf1to1(makeDrawing(sheet), sheet);
    expect(out).toContain('AC1015');
    expect(out).toContain('ENTITIES');
    expect(out).toContain('EOF');
  });

  it('DXF1-6: degenerate edge (<2 points) emits no POLYLINE', () => {
    const v: DrawingView = {
      id: 'vD', kind: 'base', positionMm: { x: 0, y: 0 },
      scale: { numerator: 1, denominator: 1 }, orientation: 'front', showHidden: false,
      projection: {
        visibleEdges: [{ id: 'e1', kind: 'outline', points: pts([[5, 5]]) }],
        hiddenEdges: [],
        bbox: { minX: 5, minY: 5, maxX: 5, maxY: 5 },
      },
    } as DrawingView;
    const out = renderDrawingDxf1to1(makeDrawing(makeSheet([v])), makeSheet([v]));
    expect(out).not.toContain('POLYLINE');
  });
});

describe('renderDrawingDxf1to1 — multi-view layout', () => {
  function pts2(p: ReadonlyArray<readonly [number, number]>): ReadonlyArray<readonly [number, number]> { return p; }
  function makeSheet2(views: DrawingView[]): DrawingSheet {
    return {
      id: 's1', name: 'Sheet 1', size: { kind: 'iso', size: 'A4' }, orientation: 'landscape',
      views, dimensions: [], annotations: [], dimensionGroups: [], titleBlock: {},
    };
  }
  function makeDrawing2(sheet: DrawingSheet): DrawingDocument {
    return { id: 'd1', name: 'MyDrawing', units: 'mm',
      source: { partPath: 'p.zipt', sourceKind: 'part' }, properties: {},
      sheets: [sheet], activeSheetId: sheet.id };
  }
  function vertices2(dxf: string): Array<[number, number]> {
    const lines = dxf.split('\n'); const out: Array<[number, number]> = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.trim() !== 'VERTEX') continue;
      let x = NaN, y = NaN;
      for (let j = i + 1; j + 1 < lines.length && lines[j]!.trim() !== 'VERTEX' && lines[j]!.trim() !== 'SEQEND'; j++) {
        if (lines[j] === ' 10') x = parseFloat(lines[j + 1]!);
        if (lines[j] === ' 20') y = parseFloat(lines[j + 1]!);
      }
      if (!Number.isNaN(x) && !Number.isNaN(y)) out.push([x, y]);
    }
    return out;
  }
  // 100-wide box view at a given sheet position (used to check ordering + spacing).
  function boxView(id: string, posX: number, posY: number): DrawingView {
    return { id, kind: 'base', positionMm: { x: posX, y: posY },
      scale: { numerator: 1, denominator: 1 }, orientation: 'front', showHidden: false,
      projection: {
        visibleEdges: [{ id: `${id}-e`, kind: 'outline', points: pts2([[0, 0], [100, 0]]) }],
        hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 100, maxY: 0 },
      } } as DrawingView;
  }

  it('DXF1-7: two views do not overlap — 2nd view min-X ≥ 1st width + GAP(20)', () => {
    // A at y=10 (sorts first), B at y=200.
    const sheet = makeSheet2([boxView('B', 0, 200), boxView('A', 0, 10)]);
    const xs = vertices2(renderDrawingDxf1to1(makeDrawing2(sheet), sheet)).map((v) => v[0]).sort((a, b) => a - b);
    // First view occupies [0,100]; second must start at ≥ 120.
    expect(Math.min(...xs)).toBeCloseTo(0, 3);
    expect(Math.max(...xs)).toBeCloseTo(220, 3); // 120 + 100
    // The gap [100,120] must contain no vertices.
    expect(xs.some((x) => x > 100.001 && x < 119.999)).toBe(false);
  });

  it('DXF1-8: reading order — view with smaller original positionMm.y is placed first (lower X)', () => {
    // TEETH: two views have DIFFERENT widths so the sort is distinguishable.
    // View A: posY=10 (sorts FIRST), width=40 — edge [[0,0],[40,0]].
    // View B: posY=200 (sorts SECOND), width=100 — edge [[0,0],[100,0]].
    //
    // CORRECT sort (A first at lx=0 → x∈{0,40}; B at lx=60 → x∈{60,160}):
    //   sorted unique xs = {0, 40, 60, 160} → sx[1] === 40
    // BROKEN/removed sort (B first at lx=0 → x∈{0,100}; A at lx=120 → x∈{120,160}):
    //   sorted unique xs = {0, 100, 120, 160} → sx[1] === 100
    // So sx[1]===40 IFF sort is present and correct (40 correct vs 100 broken).
    function boxViewW(id: string, posY: number, width: number): DrawingView {
      return {
        id, kind: 'base', positionMm: { x: 0, y: posY },
        scale: { numerator: 1, denominator: 1 }, orientation: 'front', showHidden: false,
        projection: {
          visibleEdges: [{ id: `${id}-e`, kind: 'outline', points: pts2([[0, 0], [width, 0]]) }],
          hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: width, maxY: 0 },
        },
      } as DrawingView;
    }
    const sheet = makeSheet2([boxViewW('B', 200, 100), boxViewW('A', 10, 40)]);
    const xs = vertices2(renderDrawingDxf1to1(makeDrawing2(sheet), sheet)).map((v) => v[0]);
    const sx = [...new Set(xs.map(Math.round))].sort((a, b) => a - b);
    // The SECOND-smallest x is 40 (A's far edge) only when A is placed first.
    expect(sx[1]).toBe(40);
  });
});
