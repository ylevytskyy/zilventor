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
    expect(out).toContain('AC1009');
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
