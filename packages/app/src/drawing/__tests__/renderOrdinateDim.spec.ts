// packages/app/src/drawing/__tests__/renderOrdinateDim.spec.ts
import { describe, it, expect } from 'vitest';
import { renderDrawingSvg } from '../renderDrawingSvg';
import type { DrawingDocument, DrawingSheet } from '@zilventor/shared';
import type { PartDocument } from '@zilventor/shared';

function makeMinimalSource(): PartDocument {
  return { id: 'p1', name: 'Part', featureTree: [], parameters: {}, properties: {}, materials: [] } as unknown as PartDocument;
}

function makeBaseDrawing(sheets: DrawingSheet[]): DrawingDocument {
  return { id: 'drw1', name: 'D', units: 'mm', source: { partPath: 'p.zipt', sourceKind: 'part' }, properties: {}, sheets, activeSheetId: sheets[0]!.id };
}

function makeOrdinateSheet(axis: 'x' | 'y'): DrawingSheet {
  const originEdge: import('@zilventor/shared').Edge2D = { id: 'e-origin', kind: 'outline', points: [[0, 0], [0, 1]] };
  const toEdge:     import('@zilventor/shared').Edge2D = { id: 'e-to',     kind: 'outline', points: [[40, 20], [40, 21]] };
  return {
    id: 's1', name: 'S1',
    size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
    views: [{
      id: 'v1', kind: 'base',
      positionMm: { x: 20, y: 20 },
      scale: { numerator: 1, denominator: 1 },
      orientation: 'front', showHidden: false,
      projection: {
        visibleEdges: [originEdge, toEdge],
        hiddenEdges: [],
        bbox: { minX: 0, minY: 0, maxX: 50, maxY: 40 },
      },
    }],
    dimensions: [{
      kind: 'ordinate',
      id: 'd-ord-1',
      viewId: 'v1',
      groupId: 'og1',
      to: { kind: 'edge-endpoint', edgeId: 'e-to', end: 'start' },
      axis,
    }],
    annotations: [],
    titleBlock: {},
    dimensionGroups: [{
      kind: 'ordinate',
      id: 'og1',
      viewId: 'v1',
      origin: { kind: 'edge-endpoint', edgeId: 'e-origin', end: 'start' },
      xColumnOffsetMm: 25,
      yColumnOffsetMm: 25,
    }],
  };
}

describe('renderOrdinateDim — HS-REND-4: data-dim-kind="ordinate"', () => {
  it('emits data-dim-kind="ordinate" for axis=x member', () => {
    const sheet = makeOrdinateSheet('x');
    const svg = renderDrawingSvg(makeBaseDrawing([sheet]), sheet, makeMinimalSource());
    expect(svg).toContain('data-dim-kind="ordinate"');
  });
});

describe('renderOrdinateDim — HS-REND-5: data-axis attribute', () => {
  it('emits data-axis="x" for axis=x member', () => {
    const sheet = makeOrdinateSheet('x');
    const svg = renderDrawingSvg(makeBaseDrawing([sheet]), sheet, makeMinimalSource());
    expect(svg).toContain('data-axis="x"');
  });

  it('emits data-axis="y" for axis=y member', () => {
    const sheet = makeOrdinateSheet('y');
    const svg = renderDrawingSvg(makeBaseDrawing([sheet]), sheet, makeMinimalSource());
    expect(svg).toContain('data-axis="y"');
  });
});

describe('renderOrdinateDim — HS-REND-6: L-leader path has two segments', () => {
  it('SVG output contains two <line> elements inside the ordinate group', () => {
    const sheet = makeOrdinateSheet('x');
    const svg = renderDrawingSvg(makeBaseDrawing([sheet]), sheet, makeMinimalSource());
    // Ordinate L-leader = vertical leg + horizontal leg = 2 <line> elements
    const groupMatch = svg.match(/<g [^>]*data-dim-kind="ordinate"[^>]*>([\s\S]*?)<\/g>/);
    expect(groupMatch).not.toBeNull();
    const groupContent = groupMatch![1];
    const lineCount = (groupContent.match(/<line /g) ?? []).length;
    expect(lineCount).toBeGreaterThanOrEqual(2);
  });
});
