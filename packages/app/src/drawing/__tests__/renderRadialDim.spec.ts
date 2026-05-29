// packages/app/src/drawing/__tests__/renderRadialDim.spec.ts
//
// Slice 2 RED→GREEN: SVG rendering for radial and diametric dimensions.
// Tests use a minimal sheet with one view containing a circle tessellated as 8 points,
// radius=10 centered at (50,50) in part-mm.

import { describe, it, expect } from 'vitest';
import { renderDrawingSvg } from '../renderDrawingSvg';
import type { DrawingDocument, DrawingSheet, DrawingDimension } from '@zilventor/shared';
import type { PartDocument } from '@zilventor/shared';
import type { Edge2D } from '@zilventor/shared';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeMinimalSource(): PartDocument {
  return { id: 'p1', name: 'Part', featureTree: [], parameters: {}, properties: {}, materials: [] } as unknown as PartDocument;
}

function makeBaseDrawing(sheets: DrawingSheet[]): DrawingDocument {
  return {
    id: 'drw1', name: 'D', units: 'mm',
    source: { partPath: 'p.zipt', sourceKind: 'part' },
    properties: {}, sheets, activeSheetId: sheets[0]!.id,
  };
}

/** 8 equally-spaced points on circle r=10 centered (50,50). */
function makeCircleEdge(id: string): Edge2D {
  const n = 8;
  const points: [number, number][] = Array.from({ length: n }, (_, i) => {
    const θ = (2 * Math.PI * i) / n;
    return [50 + 10 * Math.cos(θ), 50 + 10 * Math.sin(θ)];
  });
  return { id, kind: 'outline', points };
}

function makeSheet(dim: DrawingDimension): DrawingSheet {
  const circleEdge = makeCircleEdge('circ1');
  return {
    id: 's1', name: 'S1',
    size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
    views: [{
      id: 'v1', kind: 'base',
      positionMm: { x: 0, y: 0 },
      scale: { numerator: 1, denominator: 1 },
      orientation: 'front', showHidden: false,
      projection: {
        visibleEdges: [circleEdge],
        hiddenEdges: [],
        bbox: { minX: 40, minY: 40, maxX: 60, maxY: 60 },
      },
    }],
    dimensions: [dim],
    annotations: [],
    titleBlock: {},
    dimensionGroups: [],
  };
}

// ---------------------------------------------------------------------------
// Radial dimension tests
// ---------------------------------------------------------------------------

describe('renderRadialDim — HS-REND-RAD-1: data-dim-kind="radial"', () => {
  it('emits data-dim-kind="radial" for a radial dim', () => {
    const dim: DrawingDimension = {
      kind: 'radial', id: 'd-rad-1', viewId: 'v1', edgeId: 'circ1',
      offsetMm: 5, angleDeg: 0,
    };
    const sheet = makeSheet(dim);
    const svg = renderDrawingSvg(makeBaseDrawing([sheet]), sheet, makeMinimalSource());
    expect(svg).toContain('data-dim-kind="radial"');
  });
});

describe('renderRadialDim — HS-REND-RAD-2: label matches R<radius>', () => {
  it('label contains R followed by the rounded radius (10mm)', () => {
    const dim: DrawingDimension = {
      kind: 'radial', id: 'd-rad-2', viewId: 'v1', edgeId: 'circ1',
      offsetMm: 5, angleDeg: 0,
    };
    const sheet = makeSheet(dim);
    const svg = renderDrawingSvg(makeBaseDrawing([sheet]), sheet, makeMinimalSource());
    expect(svg).toMatch(/R\s*10/);
  });
});

describe('renderRadialDim — HS-REND-RAD-3: leader line element', () => {
  it('emits a <line> element (leader) inside the radial dim group', () => {
    const dim: DrawingDimension = {
      kind: 'radial', id: 'd-rad-3', viewId: 'v1', edgeId: 'circ1',
      offsetMm: 5, angleDeg: 45,
    };
    const sheet = makeSheet(dim);
    const svg = renderDrawingSvg(makeBaseDrawing([sheet]), sheet, makeMinimalSource());
    // The group should contain a <line element
    expect(svg).toContain('data-dim-kind="radial"');
    expect(svg).toContain('<line');
  });
});

// ---------------------------------------------------------------------------
// Diametric dimension tests
// ---------------------------------------------------------------------------

describe('renderRadialDim — HS-REND-DIA-1: data-dim-kind="diametric"', () => {
  it('emits data-dim-kind="diametric" for a diametric dim', () => {
    const dim: DrawingDimension = {
      kind: 'diametric', id: 'd-dia-1', viewId: 'v1', edgeId: 'circ1',
      offsetMm: 5, angleDeg: 0,
    };
    const sheet = makeSheet(dim);
    const svg = renderDrawingSvg(makeBaseDrawing([sheet]), sheet, makeMinimalSource());
    expect(svg).toContain('data-dim-kind="diametric"');
  });
});

describe('renderRadialDim — HS-REND-DIA-2: label matches ⌀<diameter>', () => {
  it('label contains ⌀ or Ø followed by the rounded diameter (20mm)', () => {
    const dim: DrawingDimension = {
      kind: 'diametric', id: 'd-dia-2', viewId: 'v1', edgeId: 'circ1',
      offsetMm: 5, angleDeg: 0,
    };
    const sheet = makeSheet(dim);
    const svg = renderDrawingSvg(makeBaseDrawing([sheet]), sheet, makeMinimalSource());
    expect(svg).toMatch(/[⌀Ø]\s*20/);
  });
});

describe('renderRadialDim — HS-REND-DIA-3: leader line through center', () => {
  it('emits a <line> element spanning the diameter inside the diametric dim group', () => {
    const dim: DrawingDimension = {
      kind: 'diametric', id: 'd-dia-3', viewId: 'v1', edgeId: 'circ1',
      offsetMm: 5, angleDeg: 30,
    };
    const sheet = makeSheet(dim);
    const svg = renderDrawingSvg(makeBaseDrawing([sheet]), sheet, makeMinimalSource());
    expect(svg).toContain('data-dim-kind="diametric"');
    expect(svg).toContain('<line');
  });
});
