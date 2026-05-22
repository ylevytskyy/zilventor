// packages/app/src/drawing/__tests__/renderAngularDim.spec.ts
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

/**
 * Two edges meeting at origin: edge1 along +X, edge2 along +Y.
 * Expected apex = (0,0), inside angle = 90°.
 */
function makeAngularSheet(arcSide: 'inside' | 'outside' = 'inside'): DrawingSheet {
  const edge1: import('@zilventor/shared').Edge2D = { id: 'ea1', kind: 'outline', points: [[0, 0], [30, 0]] };
  const edge2: import('@zilventor/shared').Edge2D = { id: 'ea2', kind: 'outline', points: [[0, 0], [0, 30]] };
  return {
    id: 's1', name: 'S1',
    size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
    views: [{
      id: 'v1', kind: 'base',
      positionMm: { x: 50, y: 50 },
      scale: { numerator: 1, denominator: 1 },
      orientation: 'front', showHidden: false,
      projection: {
        visibleEdges: [edge1, edge2],
        hiddenEdges: [],
        bbox: { minX: 0, minY: 0, maxX: 30, maxY: 30 },
      },
    }],
    dimensions: [{
      kind: 'angular',
      id: 'd-ang-1',
      viewId: 'v1',
      ref: { kind: 'two-edges', edge1: { viewId: 'v1', edgeId: 'ea1' }, edge2: { viewId: 'v1', edgeId: 'ea2' } },
      arcSide,
      offsetMm: 15,
    }],
    annotations: [],
    titleBlock: {},
    dimensionGroups: [],
  };
}

describe('renderAngularDim — HS-REND-7: data-dim-kind="angular"', () => {
  it('emits data-dim-kind="angular" for two-edges angular dim', () => {
    const sheet = makeAngularSheet();
    const svg = renderDrawingSvg(makeBaseDrawing([sheet]), sheet, makeMinimalSource());
    expect(svg).toContain('data-dim-kind="angular"');
  });
});

describe('renderAngularDim — HS-REND-8: SVG arc path contains "A"', () => {
  it('dim arc path d attribute contains the SVG arc instruction "A"', () => {
    const sheet = makeAngularSheet();
    const svg = renderDrawingSvg(makeBaseDrawing([sheet]), sheet, makeMinimalSource());
    // The arc path must use the SVG arc instruction (uppercase A = absolute arc)
    const pathMatch = svg.match(/data-dim-kind="angular"[\s\S]*?<path[^>]*d="([^"]*)"/);
    expect(pathMatch).not.toBeNull();
    expect(pathMatch![1]).toContain('A');
  });
});

describe('renderAngularDim — HS-REND-9: data-arc-side attribute', () => {
  it('emits data-arc-side="inside" when arcSide=inside', () => {
    const sheet = makeAngularSheet('inside');
    const svg = renderDrawingSvg(makeBaseDrawing([sheet]), sheet, makeMinimalSource());
    expect(svg).toContain('data-arc-side="inside"');
  });

  it('emits data-arc-side="outside" when arcSide=outside', () => {
    const sheet = makeAngularSheet('outside');
    const svg = renderDrawingSvg(makeBaseDrawing([sheet]), sheet, makeMinimalSource());
    expect(svg).toContain('data-arc-side="outside"');
  });
});

describe('renderAngularDim — HS-REND-10: parallel edges fallback', () => {
  it('returns non-empty output (fallback text) for parallel edges', () => {
    // Two horizontal edges — parallel, no intersection → fallback
    const edge1: import('@zilventor/shared').Edge2D = { id: 'ep1', kind: 'outline', points: [[0, 0], [30, 0]] };
    const edge2: import('@zilventor/shared').Edge2D = { id: 'ep2', kind: 'outline', points: [[0, 10], [30, 10]] };
    const sheet: DrawingSheet = {
      id: 's1', name: 'S1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [{
        id: 'v1', kind: 'base',
        positionMm: { x: 50, y: 50 },
        scale: { numerator: 1, denominator: 1 },
        orientation: 'front', showHidden: false,
        projection: {
          visibleEdges: [edge1, edge2], hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 30, maxY: 10 },
        },
      }],
      dimensions: [{
        kind: 'angular', id: 'd-par', viewId: 'v1',
        ref: { kind: 'two-edges', edge1: { viewId: 'v1', edgeId: 'ep1' }, edge2: { viewId: 'v1', edgeId: 'ep2' } },
        arcSide: 'inside', offsetMm: 10,
      }],
      annotations: [], titleBlock: {}, dimensionGroups: [],
    };
    const svg = renderDrawingSvg(makeBaseDrawing([sheet]), sheet, makeMinimalSource());
    // Fallback renders a text element with "—" (em dash) per spec
    expect(svg).toContain('data-dim-kind="angular"');
    expect(svg).toContain('—');
  });
});
